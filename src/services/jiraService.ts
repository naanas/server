import axios, { AxiosInstance } from 'axios';
import dayjs from 'dayjs';
import { getJiraConfig, isJiraConfigured } from '../config/jira';

/** Atlassian Document Format — plain text paragraph */
export const textToAdf = (text: string) => ({
    type: 'doc',
    version: 1,
    content: [
        {
            type: 'paragraph',
            content: [{ type: 'text', text: text || ' ' }],
        },
    ],
});

let client: AxiosInstance | null = null;

const getClient = (): AxiosInstance => {
    if (!isJiraConfigured()) {
        throw new Error('Jira belum dikonfigurasi. Isi JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN di .env');
    }
    if (!client) {
        const { site, email, token } = getJiraConfig();
        const auth = Buffer.from(`${email}:${token}`).toString('base64');
        client = axios.create({
            baseURL: `${site}/rest/api/3`,
            headers: {
                Authorization: `Basic ${auth}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });
    }
    return client;
};

export const testJiraConnection = async () => {
    const api = getClient();
    const { data } = await api.get('/myself');
    return {
        ok: true,
        accountId: data.accountId,
        displayName: data.displayName,
        emailAddress: data.emailAddress,
    };
};

export const getCreateMeta = async (projectKey?: string) => {
    const api = getClient();
    const key = projectKey || getJiraConfig().projectKey;
    const { data } = await api.get('/issue/createmeta', {
        params: {
            projectKeys: key,
            expand: 'projects.issuetypes.fields',
        },
    });
    return data;
};

/** Cari field createmeta by nama (case-insensitive, partial match) */
export const findFieldsByLabel = (
    createMeta: any,
    labels: string[],
    projectKey?: string
): Record<string, { fieldId: string; name: string; schema?: any; allowedValues?: any[] }> => {
    const key = projectKey || getJiraConfig().projectKey;
    const project = createMeta?.projects?.find((p: any) => p.key === key);
    const issueType = project?.issuetypes?.find(
        (it: any) => it.name?.toLowerCase() === getJiraConfig().issueType.toLowerCase()
    );
    const fields = issueType?.fields || {};
    const result: Record<string, { fieldId: string; name: string; schema?: any; allowedValues?: any[] }> = {};

    for (const label of labels) {
        const lower = label.toLowerCase();
        for (const [fieldId, meta] of Object.entries(fields) as [string, any][]) {
            const name = (meta.name || '').toLowerCase();
            if (name.includes(lower) || lower.includes(name)) {
                result[label] = {
                    fieldId,
                    name: meta.name,
                    schema: meta.schema,
                    allowedValues: meta.allowedValues,
                };
                break;
            }
        }
    }
    return result;
};

export interface CreateBatbIssueInput {
    summary: string;
    description: string;
    taskBAValue: string;
    startDate: string; // YYYY-MM-DD
    durationMinutes: number;
    teamValue?: string;
    priorityName?: string;
}

export const createBatbIssue = async (input: CreateBatbIssueInput) => {
    const cfg = getJiraConfig();
    const cf = cfg.customFields;

    if (!cf.taskBA || !cf.startDate || !cf.durationMinutes) {
        throw new Error(
            'Custom field Jira belum lengkap. Jalankan: npm run jira:discover lalu isi JIRA_CF_* di .env'
        );
    }

    const fields: Record<string, unknown> = {
        project: { key: cfg.projectKey },
        issuetype: { name: cfg.issueType },
        summary: input.summary,
        description: textToAdf(input.description),
        priority: { name: input.priorityName || 'Low' },
        [cf.taskBA]: { value: input.taskBAValue },
        [cf.startDate]: input.startDate,
        [cf.durationMinutes]: input.durationMinutes,
    };

    if (cf.team && input.teamValue) {
        fields[cf.team] = input.teamValue;
    }

    const api = getClient();
    const { data } = await api.post('/issue', { fields });
    return {
        key: data.key as string,
        id: data.id as string,
        self: data.self as string,
        link: `${cfg.browseBase}/${data.key}`,
    };
};

const mapJiraStatusName = (name: string): 'backlog' | 'in_progress' | 'done' | 'cancel' => {
    const n = name.toLowerCase();
    if (n.includes('progress')) return 'in_progress';
    if (n.includes('done')) return 'done';
    if (n.includes('cancel')) return 'cancel';
    return 'backlog';
};

/** Ambil ringkasan issue dari Jira (untuk /link, /task tanpa DB) */
export const getJiraIssue = async (issueKey: string) => {
    const cfg = getJiraConfig();
    const api = getClient();
    const fields = [
        'summary',
        'status',
        'assignee',
        'reporter',
        cfg.customFields.startDate,
        cfg.customFields.durationMinutes,
    ].filter(Boolean);

    const { data } = await api.get(`/issue/${issueKey}`, {
        params: { fields: fields.join(',') },
    });

    const f = data.fields || {};
    const startCf = cfg.customFields.startDate;
    const durCf = cfg.customFields.durationMinutes;

    return {
        key: data.key as string,
        summary: f.summary as string,
        statusName: f.status?.name as string,
        botStatus: mapJiraStatusName(f.status?.name || 'Backlog'),
        startDate: startCf ? (f[startCf] as string | null) : null,
        durationMinutes: durCf ? (f[durCf] as number | null) : null,
        link: `${cfg.browseBase}/${data.key}`,
    };
};

export type JiraTransition = {
    id: string;
    name: string;
    to: { name: string; id?: string };
    fields?: Record<string, { name?: string; required?: boolean; schema?: { type?: string } }>;
};

export const getIssueTransitions = async (issueKey: string, expandFields = false) => {
    const api = getClient();
    const { data } = await api.get(`/issue/${issueKey}/transitions`, {
        params: expandFields ? { expand: 'transitions.fields' } : undefined,
    });
    return data.transitions as JiraTransition[];
};

const todayIsoDate = () => dayjs().format('YYYY-MM-DD');

/** Field tambahan saat transisi (mis. End Date wajib saat Done) */
const buildTransitionFields = (
    target: 'toInProgress' | 'toDone' | 'toCancel',
    transition?: JiraTransition
): Record<string, unknown> => {
    const cfg = getJiraConfig();
    const fields: Record<string, unknown> = {};

    if (target === 'toDone' && cfg.customFields.endDate) {
        fields[cfg.customFields.endDate] = todayIsoDate();
    }

    if (transition?.fields) {
        for (const [fieldId, meta] of Object.entries(transition.fields)) {
            if (!meta.required || fields[fieldId] !== undefined) continue;
            const schemaType = meta.schema?.type || '';
            if (schemaType === 'date') {
                fields[fieldId] = todayIsoDate();
            }
        }
    }

    return fields;
};

const pickTransition = (transitions: JiraTransition[], target: 'toInProgress' | 'toDone' | 'toCancel') => {
    const match = (t: JiraTransition) => {
        const to = t.to.name.toLowerCase();
        if (target === 'toInProgress') return to.includes('progress');
        if (target === 'toDone') return to.includes('done');
        return to.includes('cancel');
    };
    return transitions.find(match);
};

export const transitionIssue = async (
    issueKey: string,
    transitionId: string,
    extraFields?: Record<string, unknown>
) => {
    const api = getClient();
    const body: { transition: { id: string }; fields?: Record<string, unknown> } = {
        transition: { id: transitionId },
    };
    if (extraFields && Object.keys(extraFields).length > 0) {
        body.fields = extraFields;
    }
    await api.post(`/issue/${issueKey}/transitions`, body);
};

/** Pilih transisi dari status Jira saat ini + isi field wajib (End Date, dll.) */
export const transitionIssueSmart = async (
    issueKey: string,
    target: 'toInProgress' | 'toDone' | 'toCancel'
) => {
    const transitions = await getIssueTransitions(issueKey, true);
    let tr = pickTransition(transitions, target);

    if (!tr) {
        const cfg = getJiraConfig();
        const fallbackId = cfg.transitions[target];
        if (!fallbackId) {
            const available = transitions.map((t) => `${t.id}:${t.name}->${t.to.name}`).join(', ');
            throw new Error(
                `Transisi ${target} tidak tersedia untuk ${issueKey}. Tersedia: ${available || 'tidak ada'}`
            );
        }
        const extraFields = buildTransitionFields(target);
        await transitionIssue(issueKey, fallbackId, extraFields);
        return;
    }

    const extraFields = buildTransitionFields(target, tr);
    await transitionIssue(issueKey, tr.id, extraFields);
};

export const formatJiraError = (e: any): string => {
    const data = e?.response?.data;
    if (data?.errorMessages?.length) return data.errorMessages.join('; ');
    if (data?.errors && Object.keys(data.errors).length) {
        return Object.entries(data.errors)
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ');
    }
    return e?.message || 'Error Jira';
};

/** Hapus issue permanen di Jira (butuh permission Delete issues) */
export const deleteJiraIssue = async (issueKey: string, deleteSubtasks = true) => {
    const api = getClient();
    await api.delete(`/issue/${issueKey}`, {
        params: { deleteSubtasks: deleteSubtasks ? 'true' : 'false' },
    });
};

export const transitionByEnv = async (
    issueKey: string,
    which: 'toInProgress' | 'toDone' | 'toCancel'
) => {
    await transitionIssueSmart(issueKey, which);
};

let cachedTaskBAOptions: string[] | null = null;

/** Opsi dropdown "Task Business Analyst" dari Jira */
export const getTaskBAOptions = async (): Promise<string[]> => {
    if (cachedTaskBAOptions?.length) return cachedTaskBAOptions;

    const meta = await getCreateMeta();
    const found = findFieldsByLabel(meta, ['Task Business Analyst']);
    const field = found['Task Business Analyst'];
    if (!field?.allowedValues?.length) {
        throw new Error('Opsi Task Business Analyst tidak ditemukan di Jira createmeta');
    }

    cachedTaskBAOptions = field.allowedValues
        .map((v: { value?: string; name?: string }) => v.value || v.name)
        .filter((x): x is string => !!x);

    return cachedTaskBAOptions;
};
