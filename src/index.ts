import express, { Request, Response } from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import { fetchTasksFromSheet } from './sheetService';
import { generateHtmlPreview } from './htmlGenerator';
import { generateTimesheet } from './excelGenerator';
import { generateProfessionalDescription } from './aiService';

const app = express();

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// --- SETUP SUPABASE (SAFE MODE) ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase: any;

// Kita cek dulu, kalau kosong kita kasih dummy client biar server GAK CRASH
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ CRITICAL ERROR: SUPABASE_URL atau SUPABASE_KEY kosong di .env server!");
  console.error("   Fitur Login/Register tidak akan berfungsi.");
  
  // Dummy client biar app gak crash saat startup
  supabase = {
    auth: {
        signUp: async () => ({ error: { message: "Server Misconfiguration: No Supabase Key" } }),
        signInWithPassword: async () => ({ error: { message: "Server Misconfiguration: No Supabase Key" } }),
        getUser: async () => ({ error: { message: "Server Misconfiguration: No Supabase Key" } }),
        signOut: async () => ({})
    }
  };
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

app.options(/(.*)/, cors());
app.use(express.json());

// --- ROUTES AUTHENTICATION ---

app.post('/api/auth/register', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        res.json({ message: 'Registrasi sukses!', user: data.user, session: data.session });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        res.json({ session: data.session, user: data.user });
    } catch (err: any) {
        res.status(401).json({ error: 'Email atau Password salah' });
    }
});

app.get('/api/auth/me', async (req: Request, res: Response): Promise<any> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error) throw error;
        res.json({ user: data.user });
    } catch (err: any) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.post('/api/auth/logout', async (req: Request, res: Response): Promise<any> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token && supabaseUrl && supabaseKey) { 
        await supabase.auth.signOut(); 
    }
    res.json({ message: 'Logged out' });
});

// --- ROUTES TIMESHEET ---

app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
        }
    } catch (err) { console.warn("[Preview] Gagal baca sheet:", err); }

    const combinedRegularTasks = [...sheetTasks, ...(manualTasks || [])];
    const htmlString = generateHtmlPreview(employee, combinedRegularTasks, overtimeTasks || []);
    res.send(htmlString);
  } catch (error) { res.status(500).send('Server Error'); }
});

app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
        }
    } catch (err) { console.warn("[Excel] Gagal baca sheet:", err); }

    const combinedTasks = [...sheetTasks, ...(manualTasks || [])];
    const hasRegular = combinedTasks.length > 0;
    const hasOvertime = overtimeTasks && overtimeTasks.length > 0;

    if (!hasRegular && !hasOvertime) return res.status(404).send('Data kosong');

    const buffer = await generateTimesheet(employee, combinedTasks);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Timesheet-${employee.name}.xlsx"`);
    res.send(buffer);
  } catch (error) { res.status(500).send('Server Error'); }
});

app.post('/api/enhance-description', async (req: Request, res: Response): Promise<any> => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).send('Text is required');
      const enhancedText = await generateProfessionalDescription(text);
      res.json({ text: enhancedText });
    } catch (error) { res.status(500).send('Failed to enhance text'); }
});

app.get('/', (req, res) => { res.send('Backend Timesheet Running! 🚀'); });

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => { console.log(`🚀 Local Server running on http://localhost:${PORT}`); });
}

export default app;