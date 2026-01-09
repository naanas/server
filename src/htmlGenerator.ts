import { Task, OvertimeTask } from './templates/htmlHelpers';
import { generateMandaysHtml } from './templates/htmlMandays';
import { generateTimesheetHtml } from './templates/htmlTimesheet';

export const generatePreview = (type: string, employee: any, tasks: Task[], overtimeTasks: OvertimeTask[]) => {
    if (type === 'timesheet') {
        return generateTimesheetHtml(employee, tasks, overtimeTasks);
    }
    // Default Mandays
    return generateMandaysHtml(employee, tasks, overtimeTasks);
};