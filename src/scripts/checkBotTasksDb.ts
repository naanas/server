/**
 * Cek akses bot_tasks: npm run db:check-bot-tasks
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getBotSupabase } from '../dbconfig/supabase';

async function main() {
    const testKey = `BATB-TEST-${Date.now()}`;
    const client = getBotSupabase();
    const usingService = !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    console.log('\n🔍 Cek bot_tasks');
    console.log('   URL:', process.env.SUPABASE_URL);
    console.log('   Key:', usingService ? 'service_role ✅' : 'anon (bisa kena RLS)');

    const { error: selErr } = await client.from('bot_tasks').select('id').limit(1);
    if (selErr) {
        console.error('❌ SELECT gagal:', selErr.code, selErr.message);
        process.exit(1);
    }
    console.log('✅ SELECT ok');

    const { data, error: insErr } = await client
        .from('bot_tasks')
        .insert({
            issue_key: testKey,
            telegram_id: 1,
            summary: 'db check',
            status: 'backlog',
            timer_status: 'idle',
        })
        .select()
        .single();

    if (insErr) {
        console.error('❌ INSERT gagal:', insErr.code, insErr.message);
        if (insErr.code === '42501') {
            console.error('\n→ Jalankan server/supabase/bot_tasks_policies.sql di Supabase SQL Editor');
            console.error('→ ATAU tambah SUPABASE_SERVICE_ROLE_KEY di .env (Settings → API → service_role)\n');
        }
        process.exit(1);
    }

    console.log('✅ INSERT ok', data?.issue_key);

    await client.from('bot_tasks').delete().eq('issue_key', testKey);
    console.log('✅ DELETE ok\n');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
