import { Task, OvertimeTask } from './templates/htmlHelpers';
import { generateMandaysHtml } from './templates/htmlMandays';
import { generateTimesheetHtml } from './templates/htmlTimesheet';

// UPDATE: Parameter holidays ditambahkan disini
export const generatePreview = (
    type: string, 
    employee: any, 
    tasks: Task[], 
    overtimeTasks: OvertimeTask[],
    holidays: string[] = [] // Default array kosong
) => {
    if (type === 'timesheet') {
        // PENTING: Oper variabel 'holidays' ke fungsi generateTimesheetHtml
        // Urutan parameter harus sesuai dengan definisi di htmlTimesheet.ts
        return generateTimesheetHtml(employee, tasks, overtimeTasks, holidays);
    }
    
    return generateMandaysHtml(employee, tasks, overtimeTasks, holidays);
};