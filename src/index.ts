import express, { Request, Response } from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// --- IMPORT SERVICES ---
// Service Lama (Helper Generator)
import { generateHtmlPreview } from './htmlGenerator';
import { generateTimesheet } from './excelGenerator';
import { generateProfessionalDescription } from './aiService';

// Service Baru (Database & Sync)
import { syncCsvToSupabase } from './syncService';
import { getReportersFromDB, getTasksFromDB } from './dbService';

// --- CONFIGURATION ---
const app = express();

// Load Env
if (process.env.NODE_ENV !== 'production') {
    // Pastikan path .env benar
    const envPath = path.resolve(__dirname, '../.env');
    dotenv.config({ path: envPath });
}

// --- SETUP SUPABASE FOR AUTH ---
// Note: Instance ini khusus untuk handling Auth user (Login/Regis)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabaseAuth: any;

if (!supabaseUrl || !supabaseKey) {
  console.warn("⚠️ SUPABASE CONFIG MISSING: Auth features will be disabled.");
  supabaseAuth = {
    auth: {
        signUp: async () => ({ error: { message: "No Supabase Config" } }),
        signInWithPassword: async () => ({ error: { message: "No Supabase Config" } }),
        getUser: async () => ({ error: { message: "No Supabase Config" } }),
        signOut: async () => ({})
    }
  };
} else {
  supabaseAuth = createClient(supabaseUrl, supabaseKey);
}

// --- MIDDLEWARE ---
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

// ====================================================
// 🔐 1. ROUTES AUTHENTICATION
// ====================================================

// Register
app.post('/api/auth/register', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabaseAuth.auth.signUp({ email, password });
        if (error) throw error;
        res.json({ message: 'Success', user: data.user, session: data.session });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// Login
app.post('/api/auth/login', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
        if (error) throw error;
        res.json({ session: data.session, user: data.user });
    } catch (err: any) {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Get Profile (Me)
app.get('/api/auth/me', async (req: Request, res: Response): Promise<any> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        const { data, error } = await supabaseAuth.auth.getUser(token);
        if (error) throw error;
        res.json({ user: data.user });
    } catch (err: any) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Logout
app.post('/api/auth/logout', async (req: Request, res: Response): Promise<any> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token && supabaseUrl && supabaseKey) await supabaseAuth.auth.signOut();
    res.json({ message: 'Logged out' });
});


// ====================================================
// 🔄 2. ROUTES SYNC & DATA (BARU)
// ====================================================

// A. SYNC DATA (Download CSV Google -> Save ke DB Supabase)
app.post('/api/sync', async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await syncCsvToSupabase();
        // result = { status: 'updated' | 'up-to-date', count: number }
        res.json(result);
    } catch (error: any) {
        console.error("Sync Error:", error);
        res.status(500).json({ error: error.message || 'Gagal Sync Data' });
    }
});

// B. GET REPORTERS (Ambil List Nama dari DB untuk Dropdown)
app.get('/api/assignees', async (req: Request, res: Response): Promise<any> => {
    try {
        const list = await getReportersFromDB();
        res.json(list);
    } catch (error) {
        console.error("Fetch Reporters Error:", error);
        res.status(500).json({ error: 'Gagal ambil data reporter dari DB' });
    }
});


// ====================================================
// 📄 3. ROUTES TIMESHEET PREVIEW
// ====================================================

// Preview HTML (Baca dari DB + Manual Input)
app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    
    // Gabungkan task manual (jika ada)
    let combinedRegularTasks = [...(manualTasks || [])];

    // Jika user memilih nama, ambil task dari DB Supabase
    if (employee.name) {
        try {
            console.log(`🔍 Query DB untuk Reporter: "${employee.name}"`);
            
            const dbTasks = await getTasksFromDB(
                employee.name,
                employee.periodStart,
                employee.periodEnd
            );
            
            // Mapping format DB (snake_case) ke format App (camelCase)
            const mappedTasks = dbTasks.map((t: any) => ({
                date: t.date,               // Tetap string asli (misal: "3/3/2025")
                description: t.description,
                ticketNumber: t.ticket_number,
                ticketLink: t.ticket_link
            }));

            console.log(`✅ Ditemukan ${mappedTasks.length} task dari DB.`);
            
            // Gabungkan: Task DB + Task Manual
            combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            
        } catch (err) {
            console.warn("[DB Preview] Failed:", err);
            // Lanjut saja dengan task manual jika DB gagal
        }
    }

    // Generate HTML String
    const htmlString = generateHtmlPreview(employee, combinedRegularTasks, overtimeTasks || []);
    res.send(htmlString);

  } catch (error) {
    console.error('Error Preview:', error);
    res.status(500).send('Server Error');
  }
});


// ====================================================
// 📎 4. ROUTES UTILS (Excel & AI)
// ====================================================

// Generate Excel (Saat ini masih pakai data manual yang dikirim dari frontend)
// TODO: Bisa diupdate juga biar ngambil dari DB
app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks, overtimeTasks } = req.body;
        const buffer = await generateTimesheet(employee, tasks);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Error Excel:', error);
        res.status(500).send('Error Generate Excel');
    }
});

// AI Enhance Description
app.post('/api/enhance-description', async (req: Request, res: Response): Promise<any> => {
    try {
      const { text } = req.body;
      const enhancedText = await generateProfessionalDescription(text);
      res.json({ text: enhancedText });
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).send('AI Error');
    }
});

// Check Server Status
app.get('/', (req, res) => {
    res.send('🚀 Backend Timesheet (Supabase DB Version) is Running!');
});

// --- SERVER LISTENER ---
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

export default app;