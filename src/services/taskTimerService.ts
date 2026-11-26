import { Telegraf } from 'telegraf';
import { getDueRunningTimers, updateBotTask } from './botTaskService';
import { getJiraIssue, transitionByEnv, formatJiraError } from './jiraService';
import { getJiraConfig } from '../config/jira';

let intervalId: ReturnType<typeof setInterval> | null = null;

export const startTaskTimerWorker = (bot: Telegraf) => {
    if (intervalId) return;

    const tick = async () => {
        try {
            const due = await getDueRunningTimers();
            for (const task of due) {
                try {
                    const jira = await getJiraIssue(task.issue_key);
                    if (jira.botStatus === 'done' || jira.botStatus === 'cancel') {
                        await updateBotTask(task.issue_key, {
                            status: jira.botStatus,
                            timer_status: 'completed',
                        });
                        continue;
                    }

                    await transitionByEnv(task.issue_key, 'toDone');
                    await updateBotTask(task.issue_key, {
                        status: 'done',
                        timer_status: 'completed',
                    });

                    const link = `${getJiraConfig().browseBase}/${task.issue_key}`;
                    await bot.telegram.sendMessage(
                        task.telegram_id,
                        `✅ ${task.issue_key} otomatis Done di Jira.\n${link}`
                    );
                } catch (e: any) {
                    const msg = formatJiraError(e);
                    console.error(`Timer error ${task.issue_key}:`, msg);
                    try {
                        await bot.telegram.sendMessage(
                            task.telegram_id,
                            `⚠️ Timer ${task.issue_key}: gagal Done di Jira.\n${msg}\nCoba manual: /task ${task.issue_key} → Selesai`
                        );
                    } catch {
                        /* ignore notify fail */
                    }
                }
            }
        } catch (e) {
            // Tabel belum ada — diamkan saja
        }
    };

    intervalId = setInterval(tick, 60_000);
    void tick();
    console.log('⏱️ Task timer worker aktif (cek setiap 60 detik)');
};
