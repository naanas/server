import { Telegraf, Context } from 'telegraf';
import {
    deleteJiraIssue,
    formatJiraError,
    getJiraIssue,
    transitionByEnv,
} from '../services/jiraService';
import {
    deleteBotTask,
    getBotTaskByKey,
    updateBotTask,
} from '../services/botTaskService';
import { parseIssueKey } from './issueKey';
import {
    runDeletePrompt,
    runLinkIssue,
    runMyTasks,
    runTaskDetail,
} from './taskHandlers';

export {
    formatTaskList,
    runDeletePrompt,
    runLinkIssue,
    runMyTasks,
    runTaskDetail,
} from './taskHandlers';

const assertTaskOwner = (task: { telegram_id: number }, ctx: Context) => {
    const uid = ctx.from?.id;
    if (!uid || Number(task.telegram_id) !== uid) {
        throw new Error('Task ini bukan milik kamu.');
    }
};

const scheduleTimer = (startedAt: Date, durationMinutes: number) => {
    const fire = new Date(startedAt.getTime() + durationMinutes * 60_000);
    return fire.toISOString();
};

const extractKeyFromCommand = (ctx: Context): string | null => {
    const payload = (ctx as Context & { payload?: string }).payload?.trim();
    const text = (ctx.message as { text?: string })?.text || '';
    const arg = payload || text.split(/\s+/).slice(1).join(' ') || '';
    return parseIssueKey(arg);
};

export const registerTaskActions = (bot: Telegraf) => {
    bot.command('mytasks', runMyTasks);
    bot.command('mytask', runMyTasks);

    bot.command('link', async (ctx) => {
        const key = extractKeyFromCommand(ctx);
        if (!key) {
            return ctx.reply('Format: /link BATB-30375\n(harus sama persis seperti di Jira)');
        }
        try {
            await runLinkIssue(ctx, key);
        } catch (e: any) {
            const msg = e.response?.data?.errorMessages?.[0] || e.message;
            await ctx.reply(`❌ ${msg}`);
        }
    });

    bot.command('task', async (ctx) => {
        const key = extractKeyFromCommand(ctx);
        if (!key) {
            return ctx.reply('Format: /task BATB-30375');
        }
        await runTaskDetail(ctx, key);
    });

    bot.action(/^task_view:(.+)$/, async (ctx) => {
        const key = parseIssueKey(ctx.match[1]) || ctx.match[1];
        await ctx.answerCbQuery();
        await runTaskDetail(ctx, key);
    });

    bot.action(/^act_start:(.+)$/, async (ctx) => {
        const key = ctx.match[1];
        await ctx.answerCbQuery();
        await handleTransition(ctx, key, 'in_progress');
    });

    bot.action(/^act_done:(.+)$/, async (ctx) => {
        const key = ctx.match[1];
        await ctx.answerCbQuery();
        await handleTransition(ctx, key, 'done');
    });

    bot.action(/^act_cancel:(.+)$/, async (ctx) => {
        const key = ctx.match[1];
        await ctx.answerCbQuery();
        await handleTransition(ctx, key, 'cancel');
    });

    bot.action(/^act_link:(.+)$/, async (ctx) => {
        const key = ctx.match[1];
        await ctx.answerCbQuery();
        try {
            await runLinkIssue(ctx, key);
        } catch (e: any) {
            await ctx.reply(`❌ ${e.message}`);
        }
    });

    bot.command('delete', async (ctx) => {
        const key = extractKeyFromCommand(ctx);
        if (!key) {
            return ctx.reply(
                'Format: /delete BATB-30375\n\nHapus permanen di Jira. Untuk batalkan tanpa hapus: /task → Batal.'
            );
        }
        await runDeletePrompt(ctx, key);
    });

    bot.action(/^act_del_confirm:(.+)$/, async (ctx) => {
        const key = ctx.match[1];
        await ctx.answerCbQuery();
        await executeDelete(ctx, key);
    });

    bot.action('act_del_abort', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply('Penghapusan dibatalkan.');
    });

    bot.action(/^act_delete:(.+)$/, async (ctx) => {
        const key = ctx.match[1];
        await ctx.answerCbQuery();
        await runDeletePrompt(ctx, key);
    });
};

async function executeDelete(ctx: Context, issueKey: string) {
    const key = parseIssueKey(issueKey) || issueKey;

    try {
        const task = await getBotTaskByKey(key);
        if (task) assertTaskOwner(task, ctx);

        await deleteJiraIssue(key);
        await deleteBotTask(key).catch(() => {});

        await ctx.reply(`🗑 ${key} dihapus permanen dari Jira.`);
    } catch (e: any) {
        const status = e.response?.status;
        if (status === 403 || status === 401) {
            return ctx.reply(
                `❌ Tidak punya izin hapus issue di Jira.\n\n` +
                    `Alternatif: /task ${key} → Batal (status Cancel, tiket tetap ada).`
            );
        }
        if (status === 404) {
            await deleteBotTask(key).catch(() => {});
            return ctx.reply(`Issue sudah tidak ada di Jira. Data bot dibersihkan.`);
        }
        await ctx.reply(`❌ Gagal hapus: ${formatJiraError(e)}`);
    }
}

async function handleTransition(
    ctx: Context,
    issueKey: string,
    target: 'in_progress' | 'done' | 'cancel'
) {
    try {
        let task = await getBotTaskByKey(issueKey);
        if (!task) {
            await runLinkIssue(ctx, issueKey);
            task = await getBotTaskByKey(issueKey);
        }
        if (!task) {
            return ctx.reply(`Task ${issueKey} tidak ditemukan. Coba /link ${issueKey}`);
        }
        assertTaskOwner(task, ctx);

        if (target === 'in_progress') {
            await transitionByEnv(issueKey, 'toInProgress');
            const startedAt = new Date();
            const duration = task.duration_minutes || 60;
            await updateBotTask(issueKey, {
                status: 'in_progress',
                started_at: startedAt.toISOString(),
                timer_fire_at: scheduleTimer(startedAt, duration),
                timer_status: 'running',
            });
            await ctx.reply(
                `▶ ${issueKey} → In Progress\nTimer ${duration} menit. Auto Done saat habis.`
            );
        } else if (target === 'done') {
            await transitionByEnv(issueKey, 'toDone');
            await updateBotTask(issueKey, {
                status: 'done',
                timer_status: 'completed',
            });
            await ctx.reply(`✅ ${issueKey} → Done`);
        } else {
            await transitionByEnv(issueKey, 'toCancel');
            await updateBotTask(issueKey, {
                status: 'cancel',
                timer_status: 'completed',
            });
            await ctx.reply(`✕ ${issueKey} → Cancel`);
        }
    } catch (e: any) {
        await ctx.reply(`❌ ${formatJiraError(e)}`);
    }
}
