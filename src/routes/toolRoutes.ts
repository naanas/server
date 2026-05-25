import express, { Request, Response } from 'express';
import { generatePreview } from '../htmlGenerator';
import { generateTimesheetExcel, generateMandaysExcel } from '../excelGenerator';
import { generateProfessionalDescription } from '../services/aiService';
import { getTasksFromDB } from '../services/dbService';
import { getIndonesianHolidays } from '../services/holidayService';

const router = express.Router();

// HTML Preview
router.post('/preview-html', async (req: Request, res: Response): Promise<any> => {
    try {
        const { type, employee, tasks: manualTasks, overtimeTasks } = req.body;
        let combinedRegularTasks = [...(manualTasks || [])];

        if (employee.name) {
            try {
                const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                const mappedTasks = dbTasks.map((t: any) => ({
                    date: t.date, description: t.description, ticketNumber: t.ticket_number, ticketLink: t.ticket_link
                }));
                combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            } catch (err) { console.warn("[DB Preview] Failed:", err); }
        }

        let holidays: string[] = [];
        if (type === 'timesheet' || type === 'mandays') {
            const endYear = employee.periodEnd ? new Date(employee.periodEnd).getFullYear() : new Date().getFullYear();
            const startYear = employee.periodStart
                ? new Date(employee.periodStart).getFullYear()
                : endYear;
            const years = new Set([startYear, endYear]);
            const lists = await Promise.all([...years].map((y) => getIndonesianHolidays(y)));
            holidays = [...new Set(lists.flat())];
        }

        const htmlString = generatePreview(type || 'mandays', employee, combinedRegularTasks, overtimeTasks || [], holidays);
        res.send(htmlString);

    } catch (error) {
        console.error('Error Preview:', error);
        res.status(500).send('Server Error');
    }
});

// Excel Generation
router.post('/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks: manualTasks, overtimeTasks } = req.body;
        let combinedRegularTasks = [...(manualTasks || [])];
        if (employee.name) {
            try {
                const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                const mappedTasks = dbTasks.map((t: any) => ({
                    date: t.date, description: t.description, ticketNumber: t.ticket_number, ticketLink: t.ticket_link
                }));
                combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            } catch (err) { console.warn("DB Fetch Error Excel:", err); }
        }
        const year = employee.periodEnd ? new Date(employee.periodEnd).getFullYear() : new Date().getFullYear();
        const holidays = await getIndonesianHolidays(year);
        const buffer = await generateTimesheetExcel(employee, combinedRegularTasks, overtimeTasks, holidays);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Timesheet_${employee.name || 'Export'}.xlsx`);
        res.send(buffer);
    } catch (error) { res.status(500).send('Error Generate Excel'); }
});

router.post('/generate-mandays', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks: manualTasks, overtimeTasks } = req.body;
        let combinedRegularTasks = [...(manualTasks || [])];
        if (employee.name) {
            try {
                const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                const mappedTasks = dbTasks.map((t: any) => ({
                    date: t.date, description: t.description, ticketNumber: t.ticket_number, ticketLink: t.ticket_link
                }));
                combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            } catch (err) { console.warn("DB Fetch Error Excel Mandays:", err); }
        }
        const endYear = employee.periodEnd ? new Date(employee.periodEnd).getFullYear() : new Date().getFullYear();
        const startYear = employee.periodStart
            ? new Date(employee.periodStart).getFullYear()
            : endYear;
        const years = new Set([startYear, endYear]);
        const lists = await Promise.all([...years].map((y) => getIndonesianHolidays(y)));
        const holidays = [...new Set(lists.flat())];
        const buffer = await generateMandaysExcel(employee, combinedRegularTasks, overtimeTasks, holidays);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Mandays_${employee.name || 'Export'}.xlsx`);
        res.send(buffer);
    } catch (error) { res.status(500).send('Error Generate Excel Mandays'); }
});

// AI Enhancement
router.post('/enhance-description', async (req: Request, res: Response): Promise<any> => {
    try {
        const { text } = req.body;
        const enhancedText = await generateProfessionalDescription(text);
        res.json({ text: enhancedText });
    } catch (error) { res.status(500).send('AI Error'); }
});

export default router;
