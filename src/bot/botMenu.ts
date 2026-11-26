import { Telegraf, Context, Markup } from 'telegraf';
import { isJiraConfigured } from '../config/jira';
import { testJiraConnection, formatJiraError } from '../services/jiraService';
import { startNewTaskWizard, clearWizard, hasWizard } from './newTaskWizard';
import { parseIssueKey } from './issueKey';
import {
    clearPendingIssueKey,
    setPendingIssueKey,
    takePendingIssueKey,
    type PendingMenuAction,
} from './botPending';
import {
    runDeletePrompt,
    runLinkIssue,
    runMyTasks,
    runTaskDetail,
} from './taskHandlers';

export { clearPendingIssueKey, getPendingIssueKey } from './botPending';
export type { PendingMenuAction } from './botPending';

export const mainMenuKeyboard = () =>
    Markup.inlineKeyboard([
        [
            Markup.button.callback('📝 Buat task', 'menu:newtask'),
            Markup.button.callback('📂 Task saya', 'menu:mytasks'),
        ],
        [
            Markup.button.callback('📋 Detail tiket', 'menu:task'),
            Markup.button.callback('🔗 Link tiket', 'menu:link'),
        ],
        [Markup.button.callback('🗑 Hapus tiket', 'menu:delete')],
        [
            Markup.button.callback('✅ Cek Jira', 'menu:jira_test'),
            Markup.button.callback('❌ Batal', 'menu:cancel'),
        ],
        [Markup.button.callback('❓ Bantuan', 'menu:help')],
    ]);

export const sendMainMenu = async (ctx: Context, text?: string) => {
    await ctx.reply(
        text ||
            'Halo! Bot Jira BATB.\n\nPilih menu di bawah (tanpa ketik command):',
        mainMenuKeyboard()
    );
};

const promptIssueKey = async (ctx: Context, action: PendingMenuAction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    clearWizard(chatId);
    setPendingIssueKey(chatId, action);

    const labels = {
        task: 'lihat detail',
        link: 'hubungkan ke bot',
        delete: 'hapus permanen di Jira',
    };

    await ctx.reply(
        `Ketik nomor tiket untuk ${labels[action]}.\n` +
            'Contoh: `BATB-30376` atau paste dari Jira.',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Menu utama', 'menu:home')]]),
        }
    );
};

export const registerBotMenu = (bot: Telegraf) => {
    bot.start(async (ctx) => sendMainMenu(ctx));

    bot.command('menu', async (ctx) => sendMainMenu(ctx));

    bot.command('help', async (ctx) => {
        await ctx.reply(
            'Bantuan — tap tombol atau ketik command:\n\n' +
                '• Buat task = wizard lengkap\n' +
                '• Task saya = Backlog & In Progress\n' +
                '• Detail / Link / Hapus = butuh nomor BATB-xxxxx\n' +
                '• Timesheet web = sync CSV (bukan langsung bot)',
            mainMenuKeyboard()
        );
    });

    bot.action('menu:home', async (ctx) => {
        await ctx.answerCbQuery();
        await sendMainMenu(ctx, '🏠 Menu utama');
    });

    bot.action('menu:help', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(
            'Bantuan Bot Jira BATB\n\n' +
                'Gunakan tombol menu. Untuk tiket tertentu, pilih Detail/Link/Hapus lalu ketik BATB-xxxxx.\n' +
                'Setelah buat task, ID muncul di pesan ✅.',
            mainMenuKeyboard()
        );
    });

    bot.action('menu:newtask', async (ctx) => {
        await ctx.answerCbQuery();
        if (!isJiraConfigured()) {
            return ctx.reply('❌ Jira belum dikonfigurasi (.env).', mainMenuKeyboard());
        }
        const chatId = ctx.chat?.id;
        if (chatId) clearPendingIssueKey(chatId);
        await startNewTaskWizard(ctx);
    });

    bot.action('menu:mytasks', async (ctx) => {
        await ctx.answerCbQuery();
        await runMyTasks(ctx);
    });

    bot.action('menu:task', async (ctx) => {
        await ctx.answerCbQuery();
        await promptIssueKey(ctx, 'task');
    });

    bot.action('menu:link', async (ctx) => {
        await ctx.answerCbQuery();
        await promptIssueKey(ctx, 'link');
    });

    bot.action('menu:delete', async (ctx) => {
        await ctx.answerCbQuery();
        await promptIssueKey(ctx, 'delete');
    });

    bot.action('menu:jira_test', async (ctx) => {
        await ctx.answerCbQuery();
        if (!isJiraConfigured()) {
            return ctx.reply('❌ Jira belum dikonfigurasi.', mainMenuKeyboard());
        }
        try {
            const me = await testJiraConnection();
            await ctx.reply(`✅ Jira OK\n👤 ${me.displayName}`, mainMenuKeyboard());
        } catch (e: any) {
            await ctx.reply(`❌ ${formatJiraError(e)}`, mainMenuKeyboard());
        }
    });

    bot.action('menu:cancel', async (ctx) => {
        const chatId = ctx.chat?.id;
        if (chatId) {
            clearPendingIssueKey(chatId);
            if (hasWizard(chatId)) clearWizard(chatId);
        }
        await ctx.answerCbQuery();
        await ctx.reply('Dibatalkan.', mainMenuKeyboard());
    });

    bot.on('text', async (ctx, next) => {
        const chatId = ctx.chat?.id;
        if (!chatId) return next();

        const pending = takePendingIssueKey(chatId);
        if (!pending) return next();

        const text = (ctx.message as { text?: string }).text?.trim() || '';
        if (text.startsWith('/')) return next();

        const key = parseIssueKey(text);
        if (!key) {
            setPendingIssueKey(chatId, pending);
            return ctx.reply(
                'Format tidak dikenali. Contoh: BATB-30376',
                Markup.inlineKeyboard([[Markup.button.callback('« Menu', 'menu:home')]])
            );
        }

        try {
            if (pending === 'task') await runTaskDetail(ctx, key);
            else if (pending === 'link') await runLinkIssue(ctx, key);
            else await runDeletePrompt(ctx, key);
        } catch (e: any) {
            await ctx.reply(`❌ ${formatJiraError(e)}`, mainMenuKeyboard());
        }
    });
};
