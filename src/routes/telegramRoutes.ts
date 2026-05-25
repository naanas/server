import express, { Request, Response } from 'express';
import { createTelegramBot } from '../bot/telegramBot';

const router = express.Router();

/** Cek env + status webhook di Telegram (tanpa bocorkan token). */
router.get('/status', async (_req: Request, res: Response) => {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim() || '';
    const hasSecret = !!process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    const mode = process.env.TELEGRAM_MODE || '(not set)';

    if (!token) {
        return res.status(503).json({
            ok: false,
            error: 'TELEGRAM_BOT_TOKEN tidak ada di env Vercel',
            mode,
            webhookUrl,
            hasSecret,
        });
    }

    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
        const data = (await r.json()) as {
            ok: boolean;
            result?: {
                url?: string;
                pending_update_count?: number;
                last_error_message?: string;
                last_error_date?: number;
            };
        };

        const registered = data.result?.url || '';
        const urlMatch =
            !webhookUrl || !registered
                ? null
                : registered.replace(/\/$/, '') === webhookUrl.replace(/\/$/, '');

        return res.json({
            ok: data.ok,
            mode,
            envWebhookUrl: webhookUrl,
            telegramWebhookUrl: registered || '(kosong — belum setWebhook)',
            urlMatch,
            hasSecret,
            pendingUpdates: data.result?.pending_update_count ?? 0,
            lastError: data.result?.last_error_message || null,
            hint:
                registered === ''
                    ? 'Jalankan POST /api/telegram/set-webhook atau setWebhook manual ke Telegram API'
                    : urlMatch === false
                      ? 'URL di Telegram ≠ TELEGRAM_WEBHOOK_URL di env'
                      : 'OK — kirim /start ke bot lalu cek log Vercel POST /api/telegram/webhook',
        });
    } catch (e) {
        console.error('Telegram status error:', e);
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/** Daftarkan webhook dari TELEGRAM_WEBHOOK_URL + TELEGRAM_WEBHOOK_SECRET. */
router.post('/set-webhook', async (req: Request, res: Response) => {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const url = process.env.TELEGRAM_WEBHOOK_URL?.trim();
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

    if (!token) {
        return res.status(503).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN tidak di-set' });
    }
    if (!url) {
        return res.status(400).json({ ok: false, error: 'TELEGRAM_WEBHOOK_URL tidak di-set' });
    }

    const body: Record<string, unknown> = {
        url,
        drop_pending_updates: req.body?.drop_pending_updates !== false,
    };
    if (secret) body.secret_token = secret;

    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await r.json();
        console.log('📡 setWebhook:', data);
        return res.json(data);
    } catch (e) {
        console.error('setWebhook error:', e);
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.post('/webhook', async (req: Request, res: Response) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.header('x-telegram-bot-api-secret-token') !== secret) {
        console.warn('Telegram webhook rejected: secret token mismatch');
        return res.sendStatus(403);
    }

    const bot = createTelegramBot();
    if (!bot) {
        console.error('Telegram webhook: TELEGRAM_BOT_TOKEN not set');
        return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
    }

    try {
        const updateId = req.body?.update_id;
        console.log(`📩 Telegram update ${updateId ?? '?'}`);
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (e) {
        console.error('Telegram webhook error:', e);
        res.sendStatus(500);
    }
});

export default router;
