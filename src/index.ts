import express, { Request, Response } from 'express';
import cors from 'cors';
import { fetchTasksFromSheet } from './sheetService';
import { generateHtmlPreview } from './htmlGenerator';
import { generateTimesheet } from './excelGenerator';

// --- CONFIGURATION ---
const app = express();

// 1. Load Dotenv HANYA jika di Local (Laptop)
// Di Vercel (Production), ini akan diskip, jadi log "injecting env (0)" hilang.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// 2. Config CORS (Agar Frontend bisa akses)
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// Handle Preflight Request (Pakai Regex agar aman dari crash library)
app.options(/(.*)/, cors());

// Middleware Body Parser
app.use(express.json());

// --- ROUTES ---

// Endpoint 1: Preview HTML
app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    
    // Ambil Data Sheet (Non-Blocking)
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
        }
    } catch (err) {
        console.warn("[Preview] Gagal baca sheet (cek env/koneksi):", err);
    }

    // Gabung: Data Sheet di atas, Data Manual di bawah
    const combinedRegularTasks = [...sheetTasks, ...(manualTasks || [])];

    // Generate HTML
    const htmlString = generateHtmlPreview(employee, combinedRegularTasks, overtimeTasks || []);
    res.send(htmlString);

  } catch (error) {
    console.error('Error Preview:', error);
    res.status(500).send('Server Error');
  }
});

// Endpoint 2: Generate Excel
app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;

    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
        }
    } catch (err) {
        console.warn("[Excel] Gagal baca sheet:", err);
    }

    const combinedTasks = [...sheetTasks, ...(manualTasks || [])];
    const hasRegular = combinedTasks.length > 0;
    const hasOvertime = overtimeTasks && overtimeTasks.length > 0;

    if (!hasRegular && !hasOvertime) {
        return res.status(404).send('Data kosong');
    }

    const buffer = await generateTimesheet(employee, combinedTasks);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Timesheet-${employee.name}.xlsx"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error Excel:', error);
    res.status(500).send('Server Error');
  }
});
app.get('/', (req, res) => {
  res.send('Backend Timesheet is Running! 🚀');
});
// --- SERVER LISTENER ---

// Hanya jalankan app.listen di Local.
// Di Vercel, export app yang akan dipakai.
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Local Server running on http://localhost:${PORT}`);
    });
}

export default app;