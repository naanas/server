import { Telegraf, Context } from 'telegraf';
import { isJiraConfigured } from '../config/jira';
import { testJiraConnection, formatJiraError } from '../services/jiraService';
import { registerNewTaskWizard, startNewTaskWizard } from './newTaskWizard';
import { registerTaskActions } from './taskActions';
import { registerBotMenu } from './botMenu';
import { startTaskTimerWorker } from '../services/taskTimerService';

let bot: Telegraf | null = null;

const getAllowedIds = (): Set<string> | null => {
    const raw = process.env.ALLOWED_TELEGRAM_IDS?.trim();
    if (!raw) return null;
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
};

const isAllowed = (ctx: Context): boolean => {
    const allowed = getAllowedIds();
    if (!allowed) return true;
    const id = ctx.from?.id?.toString();
    return !!id && allowed.has(id);
};

const guard = async (ctx: Context, next: () => Promise<void>) => {
    if (!isAllowed(ctx)) {
        const yourId = ctx.from?.id?.toString() || '?';
        await ctx.reply(
            '⛔ Bot ini dibatasi.\n\n' +
                `Telegram ID kamu: \`${yourId}\`\n\n` +
                'Minta admin tambahkan ke `ALLOWED_TELEGRAM_IDS` di server/.env, atau kosongkan variabel itu untuk allow semua user.',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    await next();
};

export const createTelegramBot = (): Telegraf | null => {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return null;

    const b = new Telegraf(token);
    b.use(guard);

    registerBotMenu(b);
    registerNewTaskWizard(b);
    registerTaskActions(b);

    b.command('jira_test', async (ctx) => {
        if (!isJiraConfigured()) {
            return ctx.reply('❌ Jira belum dikonfigurasi di server (.env).');
        }
        try {
            const me = await testJiraConnection();
            await ctx.reply(`✅ Jira OK\n👤 ${me.displayName}`);
        } catch (e: any) {
            await ctx.reply(`❌ ${formatJiraError(e)}`);
        }
    });

    b.command('newtask', async (ctx) => {
        if (!isJiraConfigured()) {
            return ctx.reply('❌ Jira belum dikonfigurasi (.env).');
        }
        await startNewTaskWizard(ctx);
    });

    bot = b;
    return b;
};

export const startTelegramPolling = async () => {
    const b = createTelegramBot();
    if (!b) {
        console.log('ℹ️ TELEGRAM_BOT_TOKEN kosong — bot Telegram tidak dijalankan.');
        return;
    }

    try {
        await b.telegram.deleteWebhook({ drop_pending_updates: true });
        const me = await b.telegram.getMe();
        console.log(`🤖 Telegram bot aktif — @${me.username} (polling)`);

        startTaskTimerWorker(b);

        void b.launch().catch((err: unknown) => {
            const e = err as { response?: { description?: string }; message?: string };
            const msg = e?.response?.description || e?.message || String(err);
            console.error('❌ Telegram polling error:', msg);
        });
    } catch (e: any) {
        const msg = e?.response?.description || e?.message || String(e);
        console.error('❌ Telegram bot gagal start:', msg);
        if (msg.includes('409')) {
            console.error('   → Bot sudah jalan di terminal/process lain. Tutup yang lain lalu restart.');
        }
        return;
    }

    process.once('SIGINT', () => b.stop('SIGINT'));
    process.once('SIGTERM', () => b.stop('SIGTERM'));
};

export const getTelegramBot = () => bot;
