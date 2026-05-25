import express, { Request, Response } from 'express';
import { createTelegramBot } from '../bot/telegramBot';

const router = express.Router();

router.post('/webhook', async (req: Request, res: Response) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.header('x-telegram-bot-api-secret-token') !== secret) {
        return res.sendStatus(403);
    }

    const bot = createTelegramBot();
    if (!bot) {
        return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
    }

    try {
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (e) {
        console.error('Telegram webhook error:', e);
        res.sendStatus(500);
    }
});

export default router;
