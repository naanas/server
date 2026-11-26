import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getIssueTransitions, transitionIssue } from '../services/jiraService';

const key = process.argv[2] || 'BATB-30375';
const tid = process.argv[3] || '111';

async function main() {
    const tr = await getIssueTransitions(key);
    console.log('Available:', tr.map((t) => `${t.id} ${t.name} -> ${t.to.name}`).join('\n'));
    try {
        await transitionIssue(key, tid);
        console.log('Transition', tid, 'OK');
    } catch (e: any) {
        console.log('FAIL', e.response?.status, JSON.stringify(e.response?.data, null, 2));
    }
}

main();
