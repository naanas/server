import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv'; // Import dotenv
import { fetchTasksFromSheet } from './sheetService';
import { generateHtmlPreview } from './htmlGenerator';
import { generateTimesheet } from './excelGenerator';

// 1. Load Environment Variables
dotenv.config();

const app = express();

// 2. Ambil PORT dari .env (Fallback ke 3000 jika tidak ada)
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

// --- ENDPOINT 1: PREVIEW HTML ---
app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    
    // Ambil Data Sheet
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
            console.log(`[Preview] Berhasil ambil ${sheetTasks.length} data dari Sheet.`);
        }
    } catch (err) {
        console.warn("[Preview] Gagal ambil data sheet:", err);
    }

    // Gabung Data
    const combinedRegularTasks = [...sheetTasks, ...(manualTasks || [])];

    // Generate HTML
    const htmlString = generateHtmlPreview(employee, combinedRegularTasks, overtimeTasks || []);

    res.send(htmlString);

  } catch (error) {
    console.error('Error generating preview:', error);
    res.status(500).send('<h2 style="color:red; text-align:center;">Gagal membuat preview. Cek console server.</h2>');
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
    const hasRegular = combinedTasks.length > 0;
    const hasOvertime = overtimeTasks && overtimeTasks.length > 0;

    if (!hasRegular && !hasOvertime) {
        return res.status(404).send('Data kosong (Sheet tidak ada, Manual tidak ada)');
    }

    // Generate Excel
    const buffer = await generateTimesheet(employee, combinedTasks);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Timesheet-${employee.name}.xlsx"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).send('Error generating excel');
  }
});

// Start Server dengan PORT dinamis
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});