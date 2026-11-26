import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { createTask, getTaskBaOptions, issueBrowseUrl } from './jiraService';
import { applyAutoStatusSchedule } from './taskScheduleService';
import { sendTelegramMessage } from './telegramClient';

dayjs.extend(customParseFormat);

export type WizardStep =
    | 'summary'
    | 'task_ba'
    | 'description'
    | 'start_date'
    | 'duration'
    | 'confirm';

export type WizardSession = {
    step: WizardStep;
    data: {
        summary?: string;
        taskBaId?: string;
        taskBaLabel?: string;
        description?: string;
        startDate?: string; // YYYY-MM-DD
        durationMinutes?: number;
    };
    baPage: number;
    baFilter: string;
};

const sessions = new Map<number, WizardSession>();

const BA_PAGE_SIZE = 8;
const todayIso = () => dayjs().format('YYYY-MM-DD');
const todayDisplay = () => dayjs().format('DD/MM/YYYY');

export const clearSession = (chatId: number) => sessions.delete(chatId);

export const hasActiveSession = (chatId: number) => sessions.has(chatId);

export const startWizard = async (chatId: number) => {
    sessions.set(chatId, { step: 'summary', data: {}, baPage: 0, baFilter: '' });
    await sendTelegramMessage(
        chatId,
        `📝 *Buat Task Jira (BATB)*\n\n1/6 — *Summary* (wajib)\nContoh: Validasi form login\n\n/batal untuk batalkan`
    );
};

const filteredBaOptions = async (session: WizardSession) => {
    const all = await getTaskBaOptions();
    const q = session.baFilter.toLowerCase().trim();
    if (!q) return all;
    return all.filter((o) => o.label.toLowerCase().includes(q));
};

const sendTaskBaList = async (chatId: number, session: WizardSession) => {
    const list = await filteredBaOptions(session);
    if (list.length === 0) {
        await sendTelegramMessage(
            chatId,
            '❌ Tidak ada opsi Task BA. Coba kata kunci lain atau ketik `reset` untuk tampilkan semua.'
        );
        return;
    }
    const start = session.baPage * BA_PAGE_SIZE;
    const slice = list.slice(start, start + BA_PAGE_SIZE);
    const lines = slice.map((o, i) => `${start + i + 1}. ${o.label.slice(0, 72)}`);
    const nav: string[] = [];
    if (start + BA_PAGE_SIZE < list.length) nav.push('`next` — halaman berikutnya');
    if (session.baPage > 0) nav.push('`prev` — halaman sebelumnya');
    nav.push('`cari <kata>` — filter opsi');

    await sendTelegramMessage(
        chatId,
        `2/6 — *Task Business Analyst* (wajib)\nKetik nomor (1-${list.length}) atau perintah di bawah:\n\n${lines.join('\n')}\n\n${nav.join('\n')}`
    );
};

const parseDateInput = (text: string): string | null => {
    const t = text.trim().toLowerCase();
    if (!t || t === '-' || t === 'hari ini' || t === 'today') return todayIso();

    const formats = ['DD/MM/YYYY', 'D/M/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY'];
    for (const f of formats) {
        const d = dayjs(text.trim(), f, true);
        if (d.isValid()) return d.format('YYYY-MM-DD');
    }
    return null;
};

const recap = (s: WizardSession) => {
    const d = s.data;
    return (
        `📋 *Konfirmasi task*\n\n` +
        `Summary: ${d.summary}\n` +
        `Task BA: ${d.taskBaLabel}\n` +
        `Description: ${(d.description || '').slice(0, 120)}${(d.description?.length || 0) > 120 ? '…' : ''}\n` +
        `Start Date (BATB): ${dayjs(d.startDate).format('DD/MM/YYYY')}\n` +
        `Duration: ${d.durationMinutes} menit\n\n` +
        `Status otomatis:\n` +
        `Backlog → In Progress → Done (sesuai tanggal & durasi)\n\n` +
        `Ketik *ya* untuk buat, *batal* untuk batalkan.`
    );
};

export const handleWizardMessage = async (chatId: number, text: string): Promise<boolean> => {
    const session = sessions.get(chatId);
    if (!session) return false;

    const raw = text.trim();
    const lower = raw.toLowerCase();

    if (lower === '/batal' || lower === 'batal') {
        clearSession(chatId);
        await sendTelegramMessage(chatId, '❌ Pembuatan task dibatalkan.');
        return true;
    }

    try {
        switch (session.step) {
            case 'summary': {
                if (raw.length < 3) {
                    await sendTelegramMessage(chatId, '❌ Summary terlalu pendek. Ulangi:');
                    return true;
                }
                session.data.summary = raw;
                session.step = 'task_ba';
                session.baPage = 0;
                await sendTaskBaList(chatId, session);
                break;
            }

            case 'task_ba': {
                if (lower.startsWith('cari ')) {
                    session.baFilter = raw.slice(5).trim();
                    session.baPage = 0;
                    await sendTaskBaList(chatId, session);
                    return true;
                }
                if (lower === 'reset') {
                    session.baFilter = '';
                    session.baPage = 0;
                    await sendTaskBaList(chatId, session);
                    return true;
                }
                if (lower === 'next') {
                    session.baPage += 1;
                    await sendTaskBaList(chatId, session);
                    return true;
                }
                if (lower === 'prev') {
                    session.baPage = Math.max(0, session.baPage - 1);
                    await sendTaskBaList(chatId, session);
                    return true;
                }
                const list = await filteredBaOptions(session);
                const num = parseInt(raw, 10);
                if (isNaN(num) || num < 1 || num > list.length) {
                    await sendTelegramMessage(chatId, `❌ Pilih nomor 1-${list.length}, atau cari/next/prev.`);
                    return true;
                }
                const picked = list[num - 1];
                session.data.taskBaId = picked.id;
                session.data.taskBaLabel = picked.label;
                session.step = 'description';
                await sendTelegramMessage(
                    chatId,
                    `3/6 — *Description* (wajib)\nKetik deskripsi, atau *-* agar sama dengan summary.`
                );
                break;
            }

            case 'description': {
                session.data.description =
                    lower === '-' ? session.data.summary! : raw;
                session.step = 'start_date';
                await sendTelegramMessage(
                    chatId,
                    `4/6 — *Start Date (BATB)*\nTanggal task dikerjakan.\n\nDefault: *${todayDisplay()}*\nKetik *-* atau *hari ini*, atau format DD/MM/YYYY\nContoh: 20/05/2026`
                );
                break;
            }

            case 'start_date': {
                const iso = parseDateInput(raw);
                if (!iso) {
                    await sendTelegramMessage(
                        chatId,
                        '❌ Format tanggal tidak dikenali. Gunakan DD/MM/YYYY atau - untuk hari ini.'
                    );
                    return true;
                }
                session.data.startDate = iso;
                session.step = 'duration';
                await sendTelegramMessage(
                    chatId,
                    `5/6 — *Duration (Minutes)* (wajib)\nWaktu pengerjaan dalam menit.\n\nDefault: *60*\nKetik angka, atau *-* untuk default.\n\n_Status Done otomatis setelah durasi ini (hitung dari jam mulai kerja)._`
                );
                break;
            }

            case 'duration': {
                let minutes: number;
                if (lower === '-' || lower === '') {
                    minutes = Number(process.env.JIRA_DEFAULT_DURATION_MINUTES || 60);
                } else {
                    minutes = parseInt(raw, 10);
                    if (isNaN(minutes) || minutes < 1 || minutes > 24 * 60) {
                        await sendTelegramMessage(chatId, '❌ Durasi harus angka 1–1440 (menit).');
                        return true;
                    }
                }
                session.data.durationMinutes = minutes;
                session.step = 'confirm';
                await sendTelegramMessage(chatId, recap(session));
                break;
            }

            case 'confirm': {
                if (!['ya', 'yes', 'y', 'ok', '✅'].includes(lower)) {
                    await sendTelegramMessage(chatId, 'Ketik *ya* untuk buat task, atau *batal*.');
                    return true;
                }
                const d = session.data;
                const created = await createTask({
                    summary: d.summary!,
                    description: d.description,
                    startDate: d.startDate,
                    durationMinutes: d.durationMinutes,
                    taskBaOptionId: d.taskBaId,
                });
                const schedule = await applyAutoStatusSchedule(
                    created.key,
                    chatId,
                    d.startDate!,
                    d.durationMinutes!
                );
                clearSession(chatId);
                await sendTelegramMessage(
                    chatId,
                    `✅ Task dibuat: *${created.key}*\n📌 ${created.issue.summary}\n📊 Status sekarang: ${created.issue.status}\n🔗 ${created.url}\n\n${schedule.message}`
                );
                break;
            }
        }
    } catch (err: any) {
        clearSession(chatId);
        throw err;
    }

    return true;
};
