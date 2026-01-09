import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import fs from 'fs';
import path from 'path';

dayjs.extend(customParseFormat);

export interface Task {
  date: string;
  description: string;
  ticketNumber?: string;
  ticketLink?: string;
}

export interface OvertimeTask {
  date: string;
  description: string;
  duration: number;
  ticketLink: string;
  remarks: string;
}

export const getBase64Image = (filename: string) => {
  try {
    const imagePath = path.join(process.cwd(), 'assets', filename);
    if (!fs.existsSync(imagePath)) return ''; 
    const bitmap = fs.readFileSync(imagePath);
    const ext = path.extname(filename).slice(1);
    return `data:image/${ext};base64,${bitmap.toString('base64')}`;
  } catch (err) { return ''; }
};

// Helper tanggal yang mensupport kebutuhan kedua file
export const parseDateKey = (rawDate: string) => {
    if (!rawDate) return { key: 'nodate', display: '-', valid: false, timestamp: 0, obj: dayjs() };
    const formats = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'M/D/YYYY', 'MM-DD-YYYY', 'DD-MM-YYYY', 'D-MMM-YY', 'D MMM YYYY'];
    let d = dayjs(rawDate);
    if (!d.isValid()) d = dayjs(rawDate, formats, true);

    if (d.isValid()) {
        return {
            key: d.format('YYYY-MM-DD'),
            display: d.format('DD/MM/YYYY'),
            valid: true,
            timestamp: d.valueOf(),
            obj: d
        };
    }
    return { key: `raw-${rawDate.trim()}`, display: rawDate, valid: false, timestamp: 0, obj: dayjs() };
};