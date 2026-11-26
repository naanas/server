import axios, { AxiosInstance } from 'axios';

const jiraSite = () => process.env.JIRA_SITE || 'https://pegadaian.atlassian.net';
const browseBase = () =>
    (process.env.JIRA_BASE_URL || `${jiraSite()}/browse/`).replace(/\/?$/, '/');

export type JiraTransition = {
    id: string;
    name: string;
    to?: { name?: string };
};

const client = (): AxiosInstance => {
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;
    if (!email || !token) {
        throw new Error('JIRA_EMAIL dan JIRA_API_TOKEN wajib di .env');
    }
    return axios.create({
        baseURL: `${jiraSite()}/rest/api/3`,
        auth: { username: email, password: token },
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
};

const adfParagraph = (text: string) => ({
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

export const issueBrowseUrl = (key: string) => `${browseBase()}${key}`;

export const parseIssueKey = (text: string): string | null => {
    const match = text.trim().toUpperCase().match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
    return match ? match[1] : null;
};

export const getIssue = async (issueKey: string) => {
    const { data } = await client().get(`/issue/${issueKey}`, {
        params: { fields: 'summary,status' },
    });
    return {
        key: data.key as string,
        summary: data.fields?.summary as string,
        status: data.fields?.status?.name as string,
    };
};

export const getTransitions = async (issueKey: string): Promise<JiraTransition[]> => {
    const { data } = await client().get(`/issue/${issueKey}/transitions`);
    return data.transitions || [];
};

/** Cocokkan transition ke status target (Backlog / In Progress / Done / Cancel) */
export const findTransitionForStatus = (
    transitions: JiraTransition[],
    target: 'in progress' | 'done' | 'cancel'
): JiraTransition | undefined => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

    const rules: Record<typeof target, { to: string[]; names: string[] }> = {
        'in progress': {
            to: ['in progress'],
            names: ['progress', 'start', 'in progress'],
        },
        done: {
            to: ['done'],
            names: ['done', 'complete', 'resolve', 'finish', 'closed'],
        },
        cancel: {
            to: ['cancel', 'cancelled', 'canceled'],
            names: ['cancel', 'submit', 'reject', 'withdraw'],
        },
    };

    const { to, names } = rules[target];

    return (
        transitions.find((t) => t.to?.name && to.includes(norm(t.to.name))) ||
        transitions.find((t) => names.some((n) => norm(t.name).includes(n)))
    );
};

export const applyTransition = async (issueKey: string, transitionId: string) => {
    await client().post(`/issue/${issueKey}/transitions`, {
        transition: { id: transitionId },
    });
};

export const transitionIssueTo = async (
    issueKey: string,
    target: 'in progress' | 'done' | 'cancel'
) => {
    const transitions = await getTransitions(issueKey);
    const match = findTransitionForStatus(transitions, target);
    if (!match) {
        const available = transitions
            .map((t) => `${t.name} → ${t.to?.name || '?'}`)
            .join(', ');
        throw new Error(
            `Tidak ada transition ke "${target}" dari status sekarang. Tersedia: ${available || '(kosong)'}`
        );
    }
    await applyTransition(issueKey, match.id);
    const updated = await getIssue(issueKey);
    return { transition: match, issue: updated };
};

export type TaskBaOption = { id: string; label: string };

let cachedTaskBaOptions: TaskBaOption[] | null = null;
let cacheTime = 0;
const CACHE_MS = 60 * 60 * 1000;

export const getTaskBaOptions = async (): Promise<TaskBaOption[]> => {
    if (cachedTaskBaOptions && Date.now() - cacheTime < CACHE_MS) {
        return cachedTaskBaOptions;
    }
    const project = process.env.JIRA_DEFAULT_PROJECT || 'BATB';
    const issueType = process.env.JIRA_DEFAULT_ISSUE_TYPE || 'Task';
    const { data } = await client().get('/issue/createmeta', {
        params: {
            projectKeys: project,
            issuetypeNames: issueType,
            expand: 'projects.issuetypes.fields',
        },
    });
    const fields = data.projects?.[0]?.issuetypes?.[0]?.fields || {};
    const baField = fields.customfield_13149;
    const options: TaskBaOption[] = (baField?.allowedValues || []).map((v: any) => ({
        id: String(v.id),
        label: String(v.value || v.name),
    }));
    cachedTaskBaOptions = options;
    cacheTime = Date.now();
    return options;
};

export type CreateTaskInput = {
    summary: string;
    description?: string;
    startDate?: string; // YYYY-MM-DD
    durationMinutes?: number;
    taskBaOptionId?: string;
    priorityId?: string;
};

export const createTask = async (input: CreateTaskInput) => {
    const project = process.env.JIRA_DEFAULT_PROJECT || 'BATB';
    const issueType = process.env.JIRA_DEFAULT_ISSUE_TYPE || 'Task';
    const startDate = input.startDate || new Date().toISOString().slice(0, 10);
    const duration = input.durationMinutes ?? Number(process.env.JIRA_DEFAULT_DURATION_MINUTES || 60);
    const taskBaId = input.taskBaOptionId || process.env.JIRA_DEFAULT_TASK_BA_ID;
    const desc = input.description || input.summary;

    if (!taskBaId) {
        throw new Error('JIRA_DEFAULT_TASK_BA_ID belum di-set di .env');
    }

    const fields: Record<string, unknown> = {
        project: { key: project },
        issuetype: { name: issueType },
        summary: input.summary,
        description: adfParagraph(desc),
        priority: { id: input.priorityId || process.env.JIRA_DEFAULT_PRIORITY_ID || '4' },
        customfield_13444: startDate,
        customfield_13158: duration,
        customfield_13149: { id: taskBaId },
    };

    const { data } = await client().post('/issue', { fields });
    const key = data.key as string;
    return {
        key,
        url: issueBrowseUrl(key),
        issue: await getIssue(key),
    };
};
