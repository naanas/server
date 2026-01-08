import express, { Request, Response } from 'express';
import cors from 'cors';
import { fetchTasksFromSheet } from './sheetService'; // PASTIKAN INI ADA
import { generateHtmlPreview } from './htmlGenerator';
import { generateTimesheet } from './excelGenerator';
import { EmployeeData } from './types';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- ENDPOINT 1: PREVIEW HTML ---
app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    // 1. Tangkap Input dari Frontend
    // 'tasks' disini adalah inputan MANUAL dari form Regular (Tabel A)
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    
    // 2. Ambil Data dari SHEET (CSV) - INI YANG KEMARIN HILANG
    // Kita gunakan try-catch agar kalau sheet error, manual tetap jalan
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
            console.log(`Berhasil ambil ${sheetTasks.length} data dari Sheet.`);
        }
    } catch (err) {
        console.error("Gagal ambil data sheet:", err);
    }

    // 3. GABUNGKAN DATA (Sheet + Manual)
    // Data sheet duluan, baru data manual di bawahnya
    const combinedRegularTasks = [...sheetTasks, ...(manualTasks || [])];

    // 4. Generate HTML dengan data gabungan
    const htmlString = generateHtmlPreview(employee, combinedRegularTasks, overtimeTasks || []);

    res.send(htmlString);

  } catch (error) {
    console.error(error);
    res.status(500).send('<h2 style="color:red; text-align:center;">Gagal mengambil data preview.</h2>');
  }
});

// --- ENDPOINT 2: DOWNLOAD EXCEL ---
app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;

    // 1. Ambil Data Sheet
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
        }
    } catch (err) {
        console.error("Gagal ambil data sheet:", err);
    }

    // 2. Gabung Data
    const combinedTasks = [...sheetTasks, ...(manualTasks || [])];

    if (combinedTasks.length === 0 && (!overtimeTasks || overtimeTasks.length === 0)) {
        return res.status(404).send('Data kosong (Sheet tidak ada, Manual tidak ada)');
    }

    // 3. Generate Excel
    const buffer = await generateTimesheet(employee, combinedTasks);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Timesheet-${employee.name}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generating excel');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});