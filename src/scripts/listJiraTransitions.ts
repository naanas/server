import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const main = async () => {
    const site = process.env.JIRA_SITE?.replace(/\/$/, '');
    const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    const api = axios.create({
        baseURL: `${site}/rest/api/3`,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });

    const jqls = [
        'project = BATB AND status = Backlog',
        'project = BATB AND status = "IN PROGRESS"',
        'project = BATB ORDER BY updated DESC',
    ];

    const seen = new Set<string>();
    const issues: any[] = [];
    for (const jql of jqls) {
        const { data } = await api.get('/search/jql', {
            params: { jql, maxResults: 5, fields: 'summary,status' },
        });
        for (const i of data.issues || []) {
            if (!seen.has(i.key)) {
                seen.add(i.key);
                issues.push(i);
            }
        }
    }

    for (const issue of issues) {
        const { data: tr } = await api.get(`/issue/${issue.key}/transitions`);
        const names = (tr.transitions || [])
            .map((t: any) => `${t.id}:${t.name}->${t.to.name}`)
            .join(' | ');
        console.log(`${issue.key} [${issue.fields.status.name}] ${names || '(no transitions)'}`);
    }
};

main().catch((e) => console.error(e.response?.data || e.message));
