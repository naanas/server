import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fetchTasksFromSheet } from './sheetService';
import { generateHtmlPreview } from './htmlGenerator';
import { generateTimesheet } from './excelGenerator';

// 1. Load Environment Variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- 2. CONFIG CORS (PENTING UNTUK VERCEL) ---
// Mengizinkan akses dari mana saja agar tidak diblokir browser
app.use(cors({
    origin: '*', // Allow all
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// --- PERBAIKAN DI SINI (FIX CRASH) ---
// Syntax '*' bikin crash di versi baru.
// Kita ganti pakai Regex /(.*)/ agar aman, atau hapus saja baris ini karena app.use(cors()) di atas sudah cukup.
// Tapi untuk memastikan preflight aman di Vercel, kita pakai Regex:
app.options(/(.*)/, cors());

// Middleware JSON
app.use(express.json());

// --- ENDPOINT 1: PREVIEW HTML ---
app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    // Tangkap data dari Frontend
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    
    // Ambil Data dari Google Sheet (CSV)
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
            console.log(`[Preview] Berhasil ambil ${sheetTasks.length} data dari Sheet.`);
        }
    } catch (err) {
        console.warn("[Preview] Gagal ambil data sheet (cek .env atau koneksi):", err);
    }

    // GABUNGKAN DATA: Sheet (atas) + Manual (bawah)
    const combinedRegularTasks = [...sheetTasks, ...(manualTasks || [])];

    // Generate HTML
    const htmlString = generateHtmlPreview(employee, combinedRegularTasks, overtimeTasks || []);

    res.send(htmlString);

  } catch (error) {
    console.error('Error generating preview:', error);
    res.status(500).send('<h2 style="color:red; text-align:center;">Internal Server Error (Preview)</h2>');
  }
});

// --- ENDPOINT 2: DOWNLOAD EXCEL ---
app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;

    // Ambil Data Sheet
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
            console.log(`[Excel] Berhasil ambil ${sheetTasks.length} data dari Sheet.`);
        }
    } catch (err) {
        console.warn("[Excel] Gagal ambil data sheet:", err);
    }

    // Gabung Data
    const combinedTasks = [...sheetTasks, ...(manualTasks || [])];
    
    // Cek apakah data benar-benar kosong
    const hasRegular = combinedTasks.length > 0;
    const hasOvertime = overtimeTasks && overtimeTasks.length > 0;

    if (!hasRegular && !hasOvertime) {
        return res.status(404).send('Data kosong (Sheet tidak ada, Manual tidak ada)');
    }

    // Generate Excel Buffer
    const buffer = await generateTimesheet(employee, combinedTasks);

    // Set Header untuk Download File
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Timesheet-${employee.name}.xlsx"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).send('Internal Server Error (Excel)');
  }
});

// --- 3. EXPORT / LISTEN (PENTING UNTUK VERCEL) ---

// Cek apakah berjalan di local atau production (Vercel)
if (process.env.NODE_ENV !== 'production') {
    // Kalau Local, pakai app.listen
    app.listen(PORT, () => {
        console.log(`🚀 Server running locally on http://localhost:${PORT}`);
    });
}

// Untuk Vercel, kita WAJIB export app
export default app;