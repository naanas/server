import dotenv from 'dotenv';
import path from 'path';

// Muat .env dulu sebelum modul lain membaca process.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';

// Routes
import authRoutes from './routes/authRoutes';
import paymentRoutes from './routes/paymentRoutes';
import dataRoutes from './routes/dataRoutes';
import toolRoutes from './routes/toolRoutes';
import jiraRoutes from './routes/jiraRoutes';
import telegramRoutes from './routes/telegramRoutes';
import { startTelegramPolling } from './bot/telegramBot';

const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api', dataRoutes);
app.use('/api', toolRoutes);
app.use('/api/jira', jiraRoutes);
app.use('/api/telegram', telegramRoutes);

// Root
app.get('/', (req, res) => {
    res.send('🚀 Backend Timesheet (With Payment & Excel) is Running! (Refactored)');
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        if (process.env.TELEGRAM_MODE !== 'webhook') {
            void startTelegramPolling();
        } else {
            console.log('ℹ️ TELEGRAM_MODE=webhook — polling dimatikan. Set webhook ke /api/telegram/webhook');
        }
    });
}

export default app;