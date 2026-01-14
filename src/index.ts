import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Routes
import authRoutes from './routes/authRoutes';
import paymentRoutes from './routes/paymentRoutes';
import dataRoutes from './routes/dataRoutes';
import toolRoutes from './routes/toolRoutes';

const app = express();

if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

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

// Root
app.get('/', (req, res) => {
    res.send('🚀 Backend Timesheet (With Payment & Excel) is Running! (Refactored)');
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

export default app;