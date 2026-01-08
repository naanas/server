import express, { Request, Response } from 'express';
import cors from 'cors';
import { fetchTasksFromSheet } from './sheetService';
import { generateHtmlPreview } from './htmlGenerator';
import { generateTimesheet } from './excelGenerator';
import { generateProfessionalDescription } from './aiService'; // <--- IMPORT BARU

// --- CONFIGURATION ---
const app = express();

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

app.options(/(.*)/, cors());
app.use(express.json());

// --- ROUTES ---

// Endpoint 1: Preview HTML
app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { employee, tasks: manualTasks, overtimeTasks } = req.body;
    
    let sheetTasks: any[] = [];
    try {
        if (employee.periodStart && employee.periodEnd) {
            sheetTasks = await fetchTasksFromSheet(employee.periodStart, employee.periodEnd);
        }
    } catch (err) {
        console.warn("[Preview] Gagal baca sheet:", err);
    }

    const combinedRegularTasks = [...sheetTasks, ...(manualTasks || [])];
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

// Endpoint 3: AI Enhance Description (BARU)
app.post('/api/enhance-description', async (req: Request, res: Response): Promise<any> => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).send('Text is required');
  
      // Panggil AI Service
      const enhancedText = await generateProfessionalDescription(text);
      res.json({ text: enhancedText });
  
    } catch (error) {
      console.error('Error enhancing text:', error);
      res.status(500).send('Failed to enhance text');
    }
});

app.get('/', (req, res) => {
    res.send('Backend Timesheet is Running! 🚀');
});

// --- SERVER LISTENER ---
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Local Server running on http://localhost:${PORT}`);
    });
}

export default app;