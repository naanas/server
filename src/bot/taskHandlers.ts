import { Context, Markup } from 'telegraf';
import { getJiraConfig } from '../config/jira';
import { formatJiraError, getJiraIssue } from '../services/jiraService';
import {
    getActiveBotTasks,
    getBotTaskByKey,
    upsertBotTask,
} from '../services/botTaskService';
import { parseIssueKey } from './issueKey';

const assertTaskOwner = (task: { telegram_id: number }, ctx: Context) => {
    const uid = ctx.from?.id;
    if (!uid || Number(task.telegram_id) !== uid) {
        throw new Error('Task ini bukan milik kamu.');
    }
};

const emptyMyTasksHint =
    'Kosong = belum ada di database bot.\n\n' +
    '• Task baru lewat /newtask harus dapat pesan ✅ dengan kode BATB-xxxxx\n' +
    '• Kalau task sudah ada di Jira (mis. BATB-30375), daftarkan:\n' +
    '  /link BATB-30375\n\n' +
    'Perintah: /mytasks (bukan /mytask)';

export const formatTaskList = (tasks: any[]) => {
    if (!tasks.length) return emptyMyTasksHint;
    return tasks
        .map(
            (t, i) =>
                `${i + 1}. ${t.issue_key} — ${t.status}\n   ${t.summary?.slice(0, 50) || ''}`
        )
        .join('\n\n');
};

export async function runLinkIssue(ctx: Context, issueKey: string) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const jira = await getJiraIssue(issueKey);
    await upsertBotTask({
        issue_key: jira.key,
        telegram_id: telegramId,
        summary: jira.summary,
        status: jira.botStatus,
        start_date: jira.startDate || undefined,
        duration_minutes: jira.durationMinutes || undefined,
        timer_status: 'idle',
    });

    await ctx.reply(
        `🔗 Terhubung ke bot:\n` +
            `${jira.key} — ${jira.statusName}\n` +
            `${jira.summary}\n\n` +
            'Sekarang /mytasks dan /task akan mengenali tiket ini.',
        Markup.inlineKeyboard([
            [Markup.button.callback('Lihat detail', `task_view:${jira.key}`)],
        ])
    );
}

export const runMyTasks = async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
        const tasks = await getActiveBotTasks(telegramId);
        const lines = formatTaskList(tasks);
        const keyboard =
            tasks.length > 0
                ? tasks.slice(0, 5).map((t: { issue_key: string }) => [
                      Markup.button.callback(`📌 ${t.issue_key}`, `task_view:${t.issue_key}`),
                  ])
                : [];

        await ctx.reply(`📂 Task aktif kamu\n\n${lines}`, {
            ...(keyboard.length ? Markup.inlineKeyboard(keyboard) : {}),
        });
    } catch (e: any) {
        await ctx.reply(`❌ ${e.message}`);
    }
};

export async function runTaskDetail(ctx: Context, issueKey: string) {
    const key = parseIssueKey(issueKey) || issueKey;

    let task = await getBotTaskByKey(key).catch((e) => {
        ctx.reply(`❌ ${e.message}`);
        return null;
    });

    if (!task) {
        try {
            const jira = await getJiraIssue(key);
            return ctx.reply(
                `${jira.key} ada di Jira (${jira.statusName}) tapi belum terdaftar di bot.\n` +
                    `${jira.summary}\n${jira.link}\n\n` +
                    'Ketik /link ' +
                    jira.key +
                    ' untuk hubungkan ke /mytasks.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔗 Link ke bot', `act_link:${jira.key}`)],
                    [Markup.button.callback('🗑 Hapus di Jira', `act_delete:${jira.key}`)],
                ])
            );
        } catch (e: any) {
            const msg = e.response?.data?.errorMessages?.[0] || e.message;
            return ctx.reply(`❌ Issue ${key} tidak ditemukan di Jira: ${msg}`);
        }
    }

    const link = `${getJiraConfig().browseBase}/${key}`;
    let timerInfo = '';
    if (task.status === 'in_progress' && task.timer_fire_at) {
        timerInfo = `\nTimer Done: ${new Date(task.timer_fire_at).toLocaleString('id-ID')}`;
    }

    const buttons = [];
    if (task.status === 'backlog') {
        buttons.push([Markup.button.callback('▶ Mulai kerja', `act_start:${key}`)]);
    }
    if (task.status === 'in_progress') {
        buttons.push([Markup.button.callback('✅ Selesai', `act_done:${key}`)]);
    }
    if (task.status === 'backlog' || task.status === 'in_progress') {
        buttons.push([Markup.button.callback('✕ Batal (status)', `act_cancel:${key}`)]);
    }
    buttons.push([Markup.button.callback('🗑 Hapus permanen', `act_delete:${key}`)]);

    await ctx.reply(
        `${key}\n` +
            `Status bot: ${task.status}\n` +
            `Summary: ${task.summary}\n` +
            `Start: ${task.start_date || '-'}\n` +
            `Durasi: ${task.duration_minutes || '-'} menit${timerInfo}\n` +
            link,
        Markup.inlineKeyboard(buttons)
    );
}

export async function runDeletePrompt(ctx: Context, issueKey: string) {
    const key = parseIssueKey(issueKey) || issueKey;

    try {
        const task = await getBotTaskByKey(key);
        if (task) assertTaskOwner(task, ctx);
        else await getJiraIssue(key);

        await ctx.reply(
            `⚠️ Hapus permanen ${key}?\n\nIssue dihapus dari Jira (tidak bisa undo).\nUntuk batalkan tanpa hapus: tombol Batal / status Cancel.`,
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('🗑 Ya, hapus', `act_del_confirm:${key}`),
                    Markup.button.callback('Tidak', 'act_del_abort'),
                ],
            ])
        );
    } catch (e: any) {
        await ctx.reply(`❌ ${formatJiraError(e)}`);
    }
}
