import axios from 'axios';
import {
    getIssue,
    issueBrowseUrl,
    parseIssueKey,
    transitionIssueTo,
} from './jiraService';
import { sendTelegramMessage } from './telegramClient';
import {
    clearSession,
    handleWizardMessage,
    hasActiveSession,
    startWizard,
} from './telegramWizard';

export { sendTelegramMessage } from './telegramClient';

type TelegramUpdate = {
    message?: {
        chat: { id: number };
        text?: string;
    };
};

const botToken = () => process.env.TELEGRAM_BOT_TOKEN;
const allowedChatIds = (): Set<string> => {
    const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS || '';
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
};

const isAllowed = (chatId: number) => {
    const allowed = allowedChatIds();
    if (allowed.size === 0) return true;
    return allowed.has(String(chatId));
};

const helpText = `📋 Jira BATB Bot

Buat task (wizard seperti form Jira):
/task — mulai tanya jawab (summary, Task BA, deskripsi, tanggal, durasi)

Status otomatis setelah create:
Backlog → In Progress → Done
(jadwal sesuai Start Date + Duration menit)

Manual override:
/progress BATB-123
/done BATB-123
/cancel BATB-123
/status BATB-123

/batal — batalkan wizard
/help`;

const extractKeyFromArgs = (args: string): string | null => {
    const joined = args.trim();
    if (!joined) return null;
    return parseIssueKey(joined) || parseIssueKey(joined.split(/\s+/)[0]);
};

const formatError = (err: any) => {
    const detail =
        err.response?.data?.errorMessages?.join(', ') ||
        err.response?.data?.errors ||
        err.message ||
        'Unknown error';
    return typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
};

export const handleTelegramUpdate = async (update: TelegramUpdate) => {
    const msg = update.message;
    if (!msg?.text || !msg.chat) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (!isAllowed(chatId)) {
        await sendTelegramMessage(chatId, '⛔ Chat tidak diizinkan.');
        return;
    }

    const isCommand = text.startsWith('/');
    const command = isCommand
        ? (text.includes(' ') ? text.slice(0, text.indexOf(' ')) : text).toLowerCase()
        : '';
    const args = isCommand && text.includes(' ') ? text.slice(text.indexOf(' ') + 1).trim() : '';

    if (command === '/batal') {
        clearSession(chatId);
        await sendTelegramMessage(chatId, '❌ Wizard dibatalkan.');
        return;
    }

    if (!isCommand && hasActiveSession(chatId)) {
        try {
            await handleWizardMessage(chatId, text);
        } catch (err: any) {
            console.error('[Telegram/Wizard]', formatError(err));
            await sendTelegramMessage(chatId, `❌ Gagal: ${formatError(err)}`);
        }
        return;
    }

    if (!isCommand) return;

    try {
        switch (command) {
            case '/start':
            case '/help':
                await sendTelegramMessage(chatId, helpText);
                break;

            case '/task':
                if (hasActiveSession(chatId)) {
                    await sendTelegramMessage(chatId, '⚠️ Wizard masih aktif. Selesaikan atau /batal dulu.');
                    return;
                }
                await startWizard(chatId);
                break;

            case '/status': {
                const key = extractKeyFromArgs(args);
                if (!key) {
                    await sendTelegramMessage(chatId, '❌ Format: /status BATB-123');
                    return;
                }
                const issue = await getIssue(key);
                await sendTelegramMessage(
                    chatId,
                    `📋 ${issue.key}\n${issue.summary}\n📊 Status: ${issue.status}\n🔗 ${issueBrowseUrl(key)}`
                );
                break;
            }

            case '/progress':
            case '/inprogress':
            case '/startprogress': {
                const key = extractKeyFromArgs(args);
                if (!key) {
                    await sendTelegramMessage(chatId, '❌ Format: /progress BATB-123');
                    return;
                }
                const result = await transitionIssueTo(key, 'in progress');
                await sendTelegramMessage(
                    chatId,
                    `✅ ${result.issue.key} → ${result.issue.status}\n(Aksi: ${result.transition.name})\n🔗 ${issueBrowseUrl(key)}`
                );
                break;
            }

            case '/done': {
                const key = extractKeyFromArgs(args);
                if (!key) {
                    await sendTelegramMessage(chatId, '❌ Format: /done BATB-123');
                    return;
                }
                const result = await transitionIssueTo(key, 'done');
                await sendTelegramMessage(
                    chatId,
                    `✅ ${result.issue.key} → ${result.issue.status}\n(Aksi: ${result.transition.name})\n🔗 ${issueBrowseUrl(key)}`
                );
                break;
            }

            case '/cancel': {
                const key = extractKeyFromArgs(args);
                if (!key) {
                    await sendTelegramMessage(chatId, '❌ Format: /cancel BATB-123');
                    return;
                }
                const result = await transitionIssueTo(key, 'cancel');
                await sendTelegramMessage(
                    chatId,
                    `✅ ${result.issue.key} → ${result.issue.status}\n(Aksi: ${result.transition.name})\n🔗 ${issueBrowseUrl(key)}`
                );
                break;
            }

            default:
                await sendTelegramMessage(chatId, `Perintah tidak dikenal: ${command}\n/task atau /help`);
        }
    } catch (err: any) {
        console.error('[Telegram/Jira]', formatError(err));
        await sendTelegramMessage(chatId, `❌ Gagal: ${formatError(err)}`);
    }
};

export const startTelegramPolling = () => {
    const token = botToken();
    if (!token) {
        console.warn('⚠️ TELEGRAM_BOT_TOKEN kosong — polling tidak dijalankan');
        return;
    }

    let offset = 0;
    console.log('🤖 Telegram polling aktif (wizard + auto status)');

    const poll = async () => {
        try {
            const { data } = await axios.get(
                `https://api.telegram.org/bot${token}/getUpdates`,
                { params: { offset, timeout: 30 } }
            );
            for (const update of data.result || []) {
                offset = update.update_id + 1;
                await handleTelegramUpdate(update);
            }
        } catch (e) {
            console.error('Telegram poll error:', e);
        }
        setTimeout(poll, 500);
    };

    poll();
};
