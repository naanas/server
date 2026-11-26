import express, { Request, Response } from 'express';
import { isJiraConfigured } from '../config/jira';
import {
    createBatbIssue,
    getCreateMeta,
    getIssueTransitions,
    testJiraConnection,
} from '../services/jiraService';

const router = express.Router();

router.get('/health', async (_req: Request, res: Response) => {
    if (!isJiraConfigured()) {
        return res.status(503).json({
            ok: false,
            error: 'Jira env belum lengkap (JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN)',
        });
    }
    try {
        const me = await testJiraConnection();
        res.json({ ok: true, jira: me });
    } catch (e: any) {
        const msg = e.response?.data?.errorMessages?.[0] || e.message;
        res.status(502).json({ ok: false, error: msg });
    }
});

router.get('/createmeta', async (_req: Request, res: Response) => {
    try {
        const meta = await getCreateMeta();
        res.json(meta);
    } catch (e: any) {
        res.status(502).json({ error: e.response?.data || e.message });
    }
});

router.get('/transitions/:issueKey', async (req: Request, res: Response) => {
    try {
        const list = await getIssueTransitions(req.params.issueKey);
        res.json(list);
    } catch (e: any) {
        res.status(502).json({ error: e.response?.data || e.message });
    }
});

/** Debug create — hanya dev; body = CreateBatbIssueInput */
router.post('/issues', async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Disabled in production' });
    }
    try {
        const issue = await createBatbIssue(req.body);
        res.json(issue);
    } catch (e: any) {
        const err = e.response?.data || { message: e.message };
        res.status(400).json({ error: err });
    }
});

export default router;
