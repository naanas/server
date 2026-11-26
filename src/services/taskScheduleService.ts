import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getIssue, transitionIssueTo } from './jiraService';
import { sendTelegramMessage } from './telegramClient';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.JIRA_TIMEZONE || 'Asia/Jakarta';
const WORK_START_HOUR = Number(process.env.JIRA_WORK_START_HOUR || 8);

export type ScheduleAction = 'in progress' | 'done';

export type PendingSchedule = {
    id: string;
    issueKey: string;
    chatId: number;
    action: ScheduleAction;
    runAt: string; // ISO
};

const timers = new Map<string, NodeJS.Timeout>();
const storePath = path.resolve(__dirname, '../../data/scheduled-jira.json');

const loadStore = (): PendingSchedule[] => {
    try {
        if (!fs.existsSync(storePath)) return [];
        return JSON.parse(fs.readFileSync(storePath, 'utf8')) as PendingSchedule[];
    } catch {
        return [];
    }
};

const saveStore = (items: PendingSchedule[]) => {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(items, null, 2));
};

const persistAdd = (job: PendingSchedule) => {
    const all = loadStore().filter((j) => j.id !== job.id);
    all.push(job);
    saveStore(all);
};

const persistRemove = (id: string) => {
    saveStore(loadStore().filter((j) => j.id !== id));
};

const runJob = async (job: PendingSchedule) => {
    persistRemove(job.id);
    timers.delete(job.id);
    try {
        const result = await transitionIssueTo(job.issueKey, job.action);
        const when = dayjs(job.runAt).tz(TZ).format('DD/MM/YYYY HH:mm');
        await sendTelegramMessage(
            job.chatId,
            `⏱ Status otomatis (${when} WIB)\n${result.issue.key} → ${result.issue.status}\n(Aksi: ${result.transition.name})`
        );
    } catch (err: any) {
        await sendTelegramMessage(
            job.chatId,
            `❌ Gagal auto-${job.action} ${job.issueKey}: ${err.message}`
        );
    }
};

const armTimer = (job: PendingSchedule) => {
    const existing = timers.get(job.id);
    if (existing) clearTimeout(existing);

    const ms = new Date(job.runAt).getTime() - Date.now();
    if (ms <= 0) {
        runJob(job);
        return;
    }
    const t = setTimeout(() => runJob(job), ms);
    timers.set(job.id, t);
};

export const scheduleTransition = (
    issueKey: string,
    chatId: number,
    action: ScheduleAction,
    runAt: Date
) => {
    const id = `${issueKey}-${action}-${runAt.getTime()}`;
    const job: PendingSchedule = {
        id,
        issueKey,
        chatId,
        action,
        runAt: runAt.toISOString(),
    };
    persistAdd(job);
    armTimer(job);
    return job;
};

/** Hitung jadwal Backlog → In Progress → Done dari tanggal kerja + durasi (menit) */
export const buildAutoStatusPlan = (startDate: string, durationMinutes: number) => {
    const now = dayjs().tz(TZ);
    const workDay = dayjs.tz(startDate, TZ).hour(WORK_START_HOUR).minute(0).second(0);
    const doneAt = workDay.add(durationMinutes, 'minute');

    if (workDay.isBefore(now, 'day')) {
        // Tanggal lampau: langsung selesai (log retroaktif)
        const t = now.add(2, 'second');
        return {
            progressAt: t.toDate(),
            doneAt: t.add(3, 'second').toDate(),
            mode: 'retroactive' as const,
        };
    }

    if (workDay.isSame(now, 'day')) {
        // Hari ini: mulai sekarang, Done setelah durasi
        const progressAt = now.add(2, 'second');
        return {
            progressAt: progressAt.toDate(),
            doneAt: progressAt.add(durationMinutes, 'minute').toDate(),
            mode: 'today' as const,
        };
    }

    // Tanggal mendatang: mulai jam kerja di hari itu
    return {
        progressAt: workDay.toDate(),
        doneAt: doneAt.toDate(),
        mode: 'future' as const,
    };
};

export const applyAutoStatusSchedule = async (
    issueKey: string,
    chatId: number,
    startDate: string,
    durationMinutes: number
) => {
    const plan = buildAutoStatusPlan(startDate, durationMinutes);
    scheduleTransition(issueKey, chatId, 'in progress', plan.progressAt);
    scheduleTransition(issueKey, chatId, 'done', plan.doneAt);

    const fmt = (d: Date) => dayjs(d).tz(TZ).format('DD/MM/YYYY HH:mm');
    const lines = [
        `📅 Jadwal status otomatis (${TZ}):`,
        `• In Progress: ${fmt(plan.progressAt)}`,
        `• Done: ${fmt(plan.doneAt)} (durasi ${durationMinutes} menit)`,
    ];
    if (plan.mode === 'retroactive') {
        lines.push('_(tanggal lampau → status di-update segera)_');
    }
    return { plan, message: lines.join('\n') };
};

export const restoreScheduledJobs = () => {
    for (const job of loadStore()) {
        armTimer(job);
    }
    const n = loadStore().length;
    if (n > 0) console.log(`⏱ Restored ${n} scheduled Jira transition(s)`);
};
