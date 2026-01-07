import express, { Request, Response } from 'express';
import cors from 'cors';
import { fetchTasksFromSheet } from './sheetService';
import { generateHtmlPreview } from './htmlGenerator'; // FILE BARU
import { generateTimesheet } from './excelGenerator'; // FILE UPDATE
import { EmployeeData } from './types';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- ENDPOINT 1: PREVIEW HTML (Response berupa String HTML) ---
app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee } = req.body as { employee: EmployeeData };
    
    // 1. Ambil Data
    const tasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
    
    // 2. Generate HTML String di Backend
    const htmlString = generateHtmlPreview(employee, tasks);

    // 3. Kirim HTML ke Frontend
    res.send(htmlString);

  } catch (error) {
    console.error(error);
    res.status(500).send('<h2 style="color:red; text-align:center;">Gagal mengambil data preview.</h2>');
  }
});

// --- ENDPOINT 2: DOWNLOAD EXCEL ---
app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee } = req.body as { employee: EmployeeData };
    const tasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);

    if (tasks.length === 0) return res.status(404).send('Data kosong');

    const buffer = await generateTimesheet(employee, tasks);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Timesheet-${employee.name}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).send('Error generating excel');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});