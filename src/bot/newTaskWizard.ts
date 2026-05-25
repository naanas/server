import { Telegraf, Context, Markup } from 'telegraf';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { getJiraConfig } from '../config/jira';
import { createBatbIssue, getTaskBAOptions } from '../services/jiraService';
import { upsertBotTask } from '../services/botTaskService';
import { buildCalendarKeyboard, formatDisplayDate } from './calendarPicker';
import { clearPendingIssueKey, getPendingIssueKey } from './botPending';

dayjs.extend(customParseFormat);

const PAGE_SIZE = 5;
const MIN_SEARCH_LEN = 2;

type WizardStep =
    | 'summary'
    | 'task_ba_search'
    | 'task_ba'
    | 'description'
    | 'start_date'
    | 'duration'
    | 'confirm';

interface WizardState {
    step: WizardStep;
    summary?: string;
    taskBAValue?: string;
    description?: string;
    startDate?: string;
    durationMinutes?: number;
    baPage?: number;
    baOptionsCache?: string[];
    baFilteredIndices?: number[];
    baSearchQuery?: string;
    calendarMonth?: string;
    manualDate?: boolean;
}

const sessions = new Map<number, WizardState>();

const getChatId = (ctx: Context) => ctx.chat?.id;

export const clearWizard = (chatId: number) => sessions.delete(chatId);

export const hasWizard = (chatId: number) => sessions.has(chatId);

/** Label tombol: nomor + bagian akhir deskripsi (lebih beda antar opsi) */
const shortBaLabel = (full: string, displayNum: number) => {
    const parts = full.split(' - ');
    const tail = parts.length >= 2 ? parts.slice(-1)[0] : full;
    const text = tail.length > 48 ? tail.slice(0, 45) + '…' : tail;
    return `${displayNum}. ${text}`;
};

const filterBaOptions = (all: string[], query: string): number[] => {
    const q = query.toLowerCase().trim();
    if (!q) return all.map((_, i) => i);
    return all
        .map((label, i) => ({ label, i }))
        .filter(({ label }) => label.toLowerCase().includes(q))
        .map(({ i }) => i);
};

const getFiltered = (state: WizardState) => {
    const all = state.baOptionsCache || [];
    const indices = state.baFilteredIndices ?? all.map((_, i) => i);
    return { all, indices };
};

const buildBaSearchKeyboard = (state: WizardState, page: number) => {
    const { all, indices } = getFiltered(state);
    const totalPages = Math.max(1, Math.ceil(indices.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    state.baPage = safePage;

    const slice = indices.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    const rows = slice.map((globalIdx, localIdx) => [
        Markup.button.callback(
            shortBaLabel(all[globalIdx], safePage * PAGE_SIZE + localIdx + 1),
            `ba_pick:${globalIdx}`
        ),
    ]);

    const nav: ReturnType<typeof Markup.button.callback>[] = [];
    if (safePage > 0) nav.push(Markup.button.callback('◀ Prev', `ba_s:${safePage - 1}`));
    if (safePage < totalPages - 1) nav.push(Markup.button.callback('Next ▶', `ba_s:${safePage + 1}`));
    if (nav.length) rows.push(nav);

    rows.push([Markup.button.callback('🔍 Cari lagi', 'ba_search_restart')]);
    rows.push([Markup.button.callback('❌ Batal wizard', 'wiz_cancel')]);

    return { keyboard: Markup.inlineKeyboard(rows), totalPages, safePage, count: indices.length };
};

const promptBaSearch = async (ctx: Context, state: WizardState) => {
    state.step = 'task_ba_search';
    state.baPage = 0;
    if (!state.baOptionsCache) {
        state.baOptionsCache = await getTaskBAOptions();
    }
    await ctx.reply(
        '🔍 *Cari Task Business Analyst*\n\n' +
            'Ketik kata kunci (min 2 huruf), contoh:\n' +
            '`GROM` · `pentest` · `CRF` · `nota dinas`\n\n' +
            '_Telegram tidak punya search bar — ini penggantinya: ketik → bot filter → pilih dari hasil._',
        { parse_mode: 'Markdown' }
    );
};

const showBaResults = async (ctx: Context, state: WizardState, page = 0, asEdit = false) => {
    const { keyboard, totalPages, safePage, count } = buildBaSearchKeyboard(state, page);

    const header =
        `📋 ${count} hasil` +
        (state.baSearchQuery ? ` untuk "${state.baSearchQuery}"` : '') +
        ` · hal ${safePage + 1}/${totalPages}\n` +
        '_Tap nomor untuk pilih. Detail lengkap dikirim setelah tap._';

    if (count === 0) {
        return ctx.reply(
            `Tidak ada task yang cocok dengan "${state.baSearchQuery}".\nCoba kata kunci lain.`,
            Markup.inlineKeyboard([[Markup.button.callback('🔍 Cari lagi', 'ba_search_restart')]])
        );
    }

    if (count <= 3) {
        const { all, indices } = getFiltered(state);
        const list = indices
            .slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
            .map((gi, i) => `${i + 1}. ${all[gi]}`)
            .join('\n\n');
        const body = `${header}\n\n${list}`;
        if (asEdit) {
            try {
                await ctx.editMessageText(body, keyboard);
                return;
            } catch {
                /* fallback send */
            }
        }
        await ctx.reply(body, keyboard);
        return;
    }

    if (asEdit) {
        try {
            await ctx.editMessageText(header, keyboard);
            return;
        } catch {
            /* */
        }
    }
    await ctx.reply(header, keyboard);
};

const promptDatePicker = async (ctx: Context, state: WizardState) => {
    state.step = 'start_date';
    state.manualDate = false;
    state.calendarMonth = dayjs().format('YYYY-MM');
    await ctx.reply(
        '📅 *Start Date (BATB)*\nPilih tanggal di kalender (boleh lampau):',
        { parse_mode: 'Markdown', ...buildCalendarKeyboard(state.calendarMonth) }
    );
};

export const startNewTaskWizard = async (ctx: Context) => {
    const chatId = getChatId(ctx);
    if (!chatId) return;

    clearPendingIssueKey(chatId);
    sessions.set(chatId, { step: 'summary', baPage: 0 });
    await ctx.reply(
        '📝 *Buat task BATB*\n\nKetik *Summary* task (judul singkat):',
        { parse_mode: 'Markdown' }
    );
};

const parseDateInput = (raw: string): string | null => {
    const t = raw.trim();
    const formats = ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'D-M-YYYY', 'D/M/YYYY'];
    for (const f of formats) {
        const d = dayjs(t, f, true);
        if (d.isValid()) return d.format('YYYY-MM-DD');
    }
    return null;
};

const validateAndSetDate = async (ctx: Context, state: WizardState, iso: string) => {
    const cfg = getJiraConfig();
    const min = dayjs().subtract(cfg.maxBackdateDays, 'day');
    if (dayjs(iso).isAfter(dayjs(), 'day')) {
        await ctx.reply('Tanggal tidak boleh di masa depan.');
        return false;
    }
    if (dayjs(iso).isBefore(min, 'day')) {
        await ctx.reply(`Tanggal terlalu lama (max ${cfg.maxBackdateDays} hari ke belakang).`);
        return false;
    }
    state.startDate = iso;
    state.step = 'duration';
    await ctx.reply(
        `✅ Tanggal: ${formatDisplayDate(iso)}\n\n⏱️ *Duration* (menit)? Contoh: 60`,
        { parse_mode: 'Markdown' }
    );
    return true;
};

export const registerNewTaskWizard = (bot: Telegraf) => {
    bot.command('cancel', async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId || !sessions.has(chatId)) {
            return ctx.reply('Tidak ada wizard aktif.');
        }
        clearWizard(chatId);
        await ctx.reply('Wizard dibatalkan.');
    });

    bot.action('ba_search_restart', async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId) return;
        const state = sessions.get(chatId);
        if (!state) return ctx.answerCbQuery();
        await ctx.answerCbQuery();
        await promptBaSearch(ctx, state);
    });

    bot.action(/^ba_s:(\d+)$/, async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId) return;
        const state = sessions.get(chatId);
        if (!state || state.step !== 'task_ba') return ctx.answerCbQuery();

        const page = parseInt(ctx.match[1], 10);
        await ctx.answerCbQuery();
        await showBaResults(ctx, state, page, true);
    });

    bot.action(/^ba_pick:(\d+)$/, async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId) return;
        const state = sessions.get(chatId);
        if (!state || state.step !== 'task_ba') return ctx.answerCbQuery();

        const globalIdx = parseInt(ctx.match[1], 10);
        const all = state.baOptionsCache || [];
        const value = all[globalIdx];
        if (!value) return ctx.answerCbQuery('Opsi tidak valid');

        state.taskBAValue = value;
        state.step = 'description';
        await ctx.answerCbQuery();
        await ctx.reply(`✅ Task BA:\n${value}\n\nKetik *Description*:`, { parse_mode: 'Markdown' });
    });

    bot.action('cal_nop', async (ctx) => ctx.answerCbQuery());

    bot.action('cal_manual', async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId) return;
        const state = sessions.get(chatId);
        if (!state) return ctx.answerCbQuery();
        state.manualDate = true;
        await ctx.answerCbQuery();
        await ctx.reply('Ketik tanggal format DD-MM-YYYY (contoh: 20-05-2026):');
    });

    bot.action(/^cal_m:(\d{4}-\d{2})$/, async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId) return;
        const state = sessions.get(chatId);
        if (!state || state.step !== 'start_date') return ctx.answerCbQuery();

        state.calendarMonth = ctx.match[1];
        await ctx.answerCbQuery();
        try {
            await ctx.editMessageReplyMarkup(buildCalendarKeyboard(state.calendarMonth).reply_markup);
        } catch {
            await ctx.reply('📅', buildCalendarKeyboard(state.calendarMonth));
        }
    });

    bot.action(/^cal_d:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId) return;
        const state = sessions.get(chatId);
        if (!state || state.step !== 'start_date') return ctx.answerCbQuery();

        await ctx.answerCbQuery();
        await validateAndSetDate(ctx, state, ctx.match[1]);
    });

    bot.action('wiz_cancel', async (ctx) => {
        const chatId = getChatId(ctx);
        if (chatId) clearWizard(chatId);
        await ctx.answerCbQuery();
        await ctx.reply('Wizard dibatalkan.');
    });

    bot.action('wiz_confirm', async (ctx) => {
        const chatId = getChatId(ctx);
        if (!chatId) return;
        const state = sessions.get(chatId);
        if (!state || state.step !== 'confirm') return ctx.answerCbQuery();

        await ctx.answerCbQuery('Membuat task...');

        try {
            const issue = await createBatbIssue({
                summary: state.summary!,
                description: state.description!,
                taskBAValue: state.taskBAValue!,
                startDate: state.startDate!,
                durationMinutes: state.durationMinutes!,
            });

            const telegramId = ctx.from?.id;
            if (telegramId) {
                try {
                    await upsertBotTask({
                        issue_key: issue.key,
                        telegram_id: telegramId,
                        summary: state.summary!,
                        status: 'backlog',
                        start_date: state.startDate,
                        duration_minutes: state.durationMinutes,
                        timer_status: 'idle',
                        jira_payload: {
                            taskBA: state.taskBAValue,
                            description: state.description,
                        },
                    });
                } catch (dbErr: any) {
                    await ctx.reply(
                        `⚠️ Jira OK: ${issue.key}\n${issue.link}\n\n` +
                            `Gagal simpan ke bot_tasks:\n${dbErr.message}\n\n` +
                            `/link ${issue.key}`
                    );
                    clearWizard(chatId);
                    return;
                }
            }

            clearWizard(chatId);

            await ctx.reply(
                `✅ Task dibuat\n\nID Jira: ${issue.key}\n${issue.link}\n\n/mytasks untuk kelola.`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('▶ Mulai kerja', `act_start:${issue.key}`)],
                ])
            );
        } catch (e: any) {
            const msg =
                e.response?.data?.errors
                    ? JSON.stringify(e.response.data.errors)
                    : e.response?.data?.errorMessages?.[0] || e.message;
            await ctx.reply(`❌ Gagal create Jira:\n${msg}`);
        }
    });

    bot.action('wiz_abort', async (ctx) => {
        const chatId = getChatId(ctx);
        if (chatId) clearWizard(chatId);
        await ctx.answerCbQuery();
        await ctx.reply('Pembuatan task dibatalkan.');
    });

    bot.on('text', async (ctx, next) => {
        const chatId = getChatId(ctx);
        if (!chatId || !sessions.has(chatId)) return next();

        const text = (ctx.message as { text?: string }).text?.trim() || '';
        if (text.startsWith('/')) return next();

        if (getPendingIssueKey(chatId)) return next();

        const state = sessions.get(chatId)!;

        try {
            switch (state.step) {
                case 'summary':
                    if (text.length < 3) {
                        return ctx.reply('Summary terlalu pendek. Coba lagi:');
                    }
                    state.summary = text;
                    await promptBaSearch(ctx, state);
                    break;

                case 'task_ba_search':
                    if (text.length < MIN_SEARCH_LEN) {
                        return ctx.reply(`Ketik minimal ${MIN_SEARCH_LEN} huruf untuk pencarian.`);
                    }
                    state.baSearchQuery = text;
                    state.baFilteredIndices = filterBaOptions(state.baOptionsCache || [], text);
                    state.step = 'task_ba';
                    state.baPage = 0;
                    await showBaResults(ctx, state, 0);
                    break;

                case 'description':
                    if (text.length < 3) {
                        return ctx.reply('Description terlalu pendek. Coba lagi:');
                    }
                    state.description = text;
                    await promptDatePicker(ctx, state);
                    break;

                case 'start_date':
                    if (!state.manualDate) {
                        return ctx.reply('Gunakan kalender di atas, atau tap ⌨️ Ketik manual.');
                    }
                    {
                        const iso = parseDateInput(text);
                        if (!iso) {
                            return ctx.reply('Format tidak valid. Contoh: 25-05-2026');
                        }
                        await validateAndSetDate(ctx, state, iso);
                    }
                    break;

                case 'duration': {
                    const mins = parseInt(text, 10);
                    if (!mins || mins < 1 || mins > 480) {
                        return ctx.reply('Masukkan angka 1–480 (menit).');
                    }
                    state.durationMinutes = mins;
                    state.step = 'confirm';
                    await ctx.reply(
                        `📋 Konfirmasi\n\n` +
                            `Summary: ${state.summary}\n` +
                            `Task BA: ${state.taskBAValue?.slice(0, 120)}…\n` +
                            `Description: ${state.description?.slice(0, 100)}…\n` +
                            `Start: ${formatDisplayDate(state.startDate!)}\n` +
                            `Duration: ${mins} menit`,
                        Markup.inlineKeyboard([
                            [
                                Markup.button.callback('✅ Buat Task', 'wiz_confirm'),
                                Markup.button.callback('❌ Batal', 'wiz_abort'),
                            ],
                        ])
                    );
                    break;
                }

                default:
                    break;
            }
        } catch (e: any) {
            await ctx.reply(`❌ Error: ${e.message}`);
        }
    });
};
