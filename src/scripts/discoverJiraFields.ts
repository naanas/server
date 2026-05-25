/**
 * Discovery script — jalankan: npm run jira:discover
 * Butuh JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN di server/.env
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { findFieldsByLabel, getCreateMeta, getIssueTransitions, testJiraConnection } from '../services/jiraService';
import { getJiraConfig } from '../config/jira';

const SEARCH_LABELS = [
    'Task Business Analyst',
    'Start Date (BATB)',
    'Start Date',
    'Duration (Minutes)',
    'Duration',
    'Team',
];

async function main() {
    console.log('\n🔍 Jira Discovery — BATB\n');

    const cfg = getJiraConfig();
    if (!cfg.site || !cfg.email || !cfg.token) {
        console.error('❌ Isi JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN di server/.env');
        process.exit(1);
    }

    const me = await testJiraConnection();
    console.log(`✅ Terhubung sebagai: ${me.displayName} (${me.emailAddress || me.accountId})\n`);

    const meta = await getCreateMeta();
    const found = findFieldsByLabel(meta, SEARCH_LABELS);

    console.log('--- Custom fields (copy ke .env) ---\n');
    const envMap: Record<string, string> = {
        'Task Business Analyst': 'JIRA_CF_TASK_BA',
        'Start Date (BATB)': 'JIRA_CF_START_DATE',
        'Start Date': 'JIRA_CF_START_DATE',
        'Duration (Minutes)': 'JIRA_CF_DURATION',
        Duration: 'JIRA_CF_DURATION',
        Team: 'JIRA_CF_TEAM',
    };

    for (const label of SEARCH_LABELS) {
        const f = found[label];
        if (!f) {
            console.log(`# ${label}: TIDAK DITEMUKAN — cek nama di Jira`);
            continue;
        }
        const envKey = envMap[label];
        if (envKey) {
            console.log(`${envKey}=${f.fieldId}`);
        }
        console.log(`#   ${label} → ${f.fieldId} (${f.name})`);
        if (f.allowedValues?.length) {
            const opts = f.allowedValues.slice(0, 8).map((v: any) => v.value || v.name).join(', ');
            console.log(`#   opsi: ${opts}${f.allowedValues.length > 8 ? '...' : ''}`);
        }
        console.log('');
    }

    // Sample issue untuk transitions (opsional)
    const sampleKey = process.argv[2];
    if (sampleKey) {
        console.log(`--- Transitions untuk ${sampleKey} ---\n`);
        const transitions = await getIssueTransitions(sampleKey);
        for (const t of transitions) {
            const hint =
                t.to.name.toLowerCase().includes('progress')
                    ? 'JIRA_TRANSITION_TO_IN_PROGRESS'
                    : t.to.name.toLowerCase().includes('done')
                      ? 'JIRA_TRANSITION_TO_DONE'
                      : t.to.name.toLowerCase().includes('cancel')
                        ? 'JIRA_TRANSITION_TO_CANCEL'
                        : '#';
            console.log(`${hint}=${t.id}  # ${t.name} → ${t.to.name}`);
        }
        console.log('\n');
    } else {
        console.log('💡 Untuk transition IDs, jalankan:');
        console.log('   npm run jira:discover -- BATB-12345\n');
    }

    console.log('Selesai. Paste nilai di atas ke server/.env lalu restart server.\n');
}

main().catch((e) => {
    console.error('❌', e.response?.data?.errorMessages?.join?.('\n') || e.message);
    process.exit(1);
});
