export const getJiraConfig = () => {
    const site = (process.env.JIRA_SITE || '').replace(/\/$/, '');
    const email = process.env.JIRA_EMAIL || '';
    const token = process.env.JIRA_API_TOKEN || '';
    const projectKey = process.env.JIRA_PROJECT_KEY || 'BATB';
    const issueType = process.env.JIRA_ISSUE_TYPE || 'Task';

    return {
        site,
        apiBase: site ? `${site}/rest/api/3` : '',
        email,
        token,
        projectKey,
        issueType,
        browseBase: process.env.JIRA_BASE_URL?.replace(/\/$/, '') || `${site}/browse`,
        customFields: {
            taskBA: process.env.JIRA_CF_TASK_BA || '',
            startDate: process.env.JIRA_CF_START_DATE || '',
            endDate: process.env.JIRA_CF_END_DATE || 'customfield_13430',
            durationMinutes: process.env.JIRA_CF_DURATION || '',
            team: process.env.JIRA_CF_TEAM || '',
        },
        transitions: {
            toInProgress: process.env.JIRA_TRANSITION_TO_IN_PROGRESS || '',
            toDone: process.env.JIRA_TRANSITION_TO_DONE || '',
            toCancel: process.env.JIRA_TRANSITION_TO_CANCEL || '',
        },
        maxBackdateDays: parseInt(process.env.TASK_MAX_BACKDATE_DAYS || '90', 10),
    };
};

export const isJiraConfigured = (): boolean => {
    const c = getJiraConfig();
    return !!(c.site && c.email && c.token);
};
