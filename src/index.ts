import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// --- 1. IMPORT DB CONFIG ---
import { supabase } from './dbconfig/supabase'; 

// --- 2. IMPORT GENERATORS ---
import { generatePreview } from './htmlGenerator'; 
import { generateTimesheet } from './excelGenerator';

// --- 3. IMPORT SERVICES ---
import { generateProfessionalDescription } from './services/aiService';
import { syncCsvToSupabase } from './services/syncService';
import { getReportersFromDB, getTasksFromDB } from './services/dbService';
import { getIndonesianHolidays } from './services/holidayService'; // Service API Libur

// --- CONFIGURATION ---
const app = express();

if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
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
// 🔐 ROUTES AUTH
// ====================================================

app.post('/api/auth/register', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Success', user: data.user, session: data.session });
});

app.post('/api/auth/login', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ session: data.session, user: data.user });
});

app.get('/api/auth/me', async (req: Request, res: Response): Promise<any> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error) return res.status(401).json({ error: 'Invalid token' });
    res.json({ user: data.user });
});

app.post('/api/auth/logout', async (req: Request, res: Response): Promise<any> => {
    await supabase.auth.signOut();
    res.json({ message: 'Logged out' });
});


// ====================================================
// 🔄 ROUTES SYNC & DATA
// ====================================================

app.post('/api/sync', async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await syncCsvToSupabase();
        res.json(result);
    } catch (error: any) {
        console.error("Sync Error:", error);
        res.status(500).json({ error: error.message || 'Gagal Sync Data' });
    }
});

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
// 📄 ROUTES PREVIEW HTML (Logic Libur Disini)
// ====================================================

app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { type, employee, tasks: manualTasks, overtimeTasks } = req.body;
    
    let combinedRegularTasks = [...(manualTasks || [])];

    // Ambil Task dari DB jika ada nama
    if (employee.name) {
        try {
            const dbTasks = await getTasksFromDB(
                employee.name,
                employee.periodStart,
                employee.periodEnd
            );
            
            const mappedTasks = dbTasks.map((t: any) => ({
                date: t.date,
                description: t.description,
                ticketNumber: t.ticket_number,
                ticketLink: t.ticket_link
            }));

            combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
        } catch (err) {
            console.warn("[DB Preview] Failed:", err);
        }
    }

    // --- FETCH DATA LIBUR (API) ---
    let holidays: string[] = [];
    if (type === 'timesheet') {
        const targetYear = employee.periodEnd 
            ? new Date(employee.periodEnd).getFullYear() 
            : new Date().getFullYear();
            
        // Panggil Service API
        holidays = await getIndonesianHolidays(targetYear);
        console.log(`📅 Preview Timesheet: Mengirim ${holidays.length} hari libur ke template.`);
    }

    // --- GENERATE HTML ---
    // Kirim holidays sebagai parameter ke-5
    const htmlString = generatePreview(
        type || 'mandays', 
        employee, 
        combinedRegularTasks, 
        overtimeTasks || [],
        holidays 
    );
    
    res.send(htmlString);

  } catch (error) {
    console.error('Error Preview:', error);
    res.status(500).send('Server Error');
  }
});


// ====================================================
// 📎 ROUTES UTILS
// ====================================================

app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks } = req.body;
        const buffer = await generateTimesheet(employee, tasks);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Error Excel:', error);
        res.status(500).send('Error Generate Excel');
    }
});

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

app.get('/', (req, res) => {
    res.send('🚀 Backend Timesheet (With Holiday API) is Running!');
});

// --- SERVER LISTENER ---
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

export default app;