import express, { Request, Response } from 'express';
import { handleTelegramUpdate } from '../services/telegramService';

const router = express.Router();

router.post('/webhook', async (req: Request, res: Response) => {
    res.sendStatus(200);

    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
        console.warn('Telegram webhook: secret tidak cocok');
        return;
    }

    try {
        await handleTelegramUpdate(req.body);
    } catch (err) {
        console.error('Telegram webhook handler error:', err);
    }
});

export default router;
