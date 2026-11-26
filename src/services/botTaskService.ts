import { getBotSupabase } from '../dbconfig/supabase';

const db = () => getBotSupabase();

export type BotTaskStatus = 'backlog' | 'in_progress' | 'done' | 'cancel';

export interface BotTaskRow {
    id?: string;
    issue_key: string;
    telegram_id: number;
    summary: string;
    status: BotTaskStatus;
    start_date?: string;
    duration_minutes?: number;
    started_at?: string | null;
    timer_fire_at?: string | null;
    timer_status?: string;
    jira_payload?: Record<string, unknown>;
}

const tableMissingHint =
    'Tabel `bot_tasks` belum terlihat oleh API. Jalankan bot_tasks.sql lalu di SQL Editor: NOTIFY pgrst, \'reload schema\';';

const rlsHint =
    'Supabase RLS memblokir insert (tabel ada, akses ditolak).\n\n' +
    'Fix A — SQL Editor, paste & Run file:\nserver/supabase/bot_tasks_policies.sql\n\n' +
    'Fix B — tambah di .env:\nSUPABASE_SERVICE_ROLE_KEY=<service_role dari Supabase API settings>\n' +
    'Lalu restart npm run dev';

export const isBotTasksTableMissing = (error: { message?: string; code?: string }) => {
    const msg = error?.message || '';
    if (error?.code === '42501' || msg.includes('row-level security')) return false;
    return error?.code === 'PGRST205' || msg.includes('schema cache') || msg.includes('Could not find the table');
};

const formatDbError = (error: { message?: string; code?: string; details?: string; hint?: string }) => {
    const msg = error.message || '';
    if (error.code === '42501' || msg.includes('row-level security')) return rlsHint;
    if (isBotTasksTableMissing(error)) return tableMissingHint;
    return `[${error.code || 'DB'}] ${msg}${error.details ? ` — ${error.details}` : ''}`;
};

export const insertBotTask = async (row: BotTaskRow) => {
    const { data, error } = await db().from('bot_tasks').insert(row).select().single();
    if (error) {
        throw new Error(formatDbError(error));
    }
    return data;
};

/** Daftarkan / sinkronkan issue Jira ke bot_tasks (untuk task yang sudah ada di Jira) */
export const upsertBotTask = async (row: BotTaskRow) => {
    const { data, error } = await db()
        .from('bot_tasks')
        .upsert(
            { ...row, updated_at: new Date().toISOString() },
            { onConflict: 'issue_key' }
        )
        .select()
        .single();

    if (error) {
        throw new Error(formatDbError(error));
    }
    return data;
};

export const getActiveBotTasks = async (telegramId: number) => {
    const { data, error } = await db()
        .from('bot_tasks')
        .select('*')
        .eq('telegram_id', telegramId)
        .in('status', ['backlog', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) throw new Error(formatDbError(error));
    return data || [];
};

export const getBotTaskByKey = async (issueKey: string) => {
    const { data, error } = await db()
        .from('bot_tasks')
        .select('*')
        .eq('issue_key', issueKey)
        .maybeSingle();

    if (error) throw new Error(formatDbError(error));
    return data;
};

export const updateBotTask = async (
    issueKey: string,
    patch: Partial<BotTaskRow> & { updated_at?: string }
) => {
    const { data, error } = await db()
        .from('bot_tasks')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('issue_key', issueKey)
        .select()
        .single();

    if (error) throw new Error(formatDbError(error));
    return data;
};

export const deleteBotTask = async (issueKey: string) => {
    const { error } = await db().from('bot_tasks').delete().eq('issue_key', issueKey);
    if (error) throw new Error(formatDbError(error));
};

export const getDueRunningTimers = async () => {
    const now = new Date().toISOString();
    const { data, error } = await db()
        .from('bot_tasks')
        .select('*')
        .eq('timer_status', 'running')
        .lte('timer_fire_at', now);

    if (error) {
        if (isBotTasksTableMissing(error)) return [];
        throw error;
    }
    return data || [];
};
