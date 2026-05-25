import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import fs from 'fs';
import path from 'path';

dayjs.extend(customParseFormat);

// --- INTERFACES ---

export interface Task {
  date: string;
  description: string;
  ticketNumber?: string;
  ticketLink?: string;
  // UPDATE: Tambahkan status agar logic Cuti/Sakit terbaca
  status?: string;
}

export interface OvertimeTask {
  date: string;
  description?: string;
  // UPDATE: Support string | number agar tidak error saat perhitungan
  duration: number | string;
  ticketLink?: string;
  remarks?: string;
}

// --- HELPER FUNCTIONS ---

export const getBase64Image = (filename: string) => {
  try {
    // Menggunakan path yang lebih aman (sesuai struktur folder project Node.js umumnya)
    // Pastikan folder assets ada di public/assets atau root assets
    const imagePath = path.resolve(__dirname, '../../public/assets', filename);

    // Fallback jika tidak ketemu di public, coba cari di root assets
    if (!fs.existsSync(imagePath)) {
      const rootPath = path.join(process.cwd(), 'assets', filename);
      if (fs.existsSync(rootPath)) {
        const bitmap = fs.readFileSync(rootPath);
        const ext = path.extname(filename).slice(1);
        return `data:image/${ext};base64,${bitmap.toString('base64')}`;
      }
      return '';
    }

    const bitmap = fs.readFileSync(imagePath);
    const ext = path.extname(filename).slice(1);
    return `data:image/${ext};base64,${bitmap.toString('base64')}`;
  } catch (err) {
    console.error("Image load error:", err);
    return '';
  }
};

// Helper tanggal yang robust (Support banyak format)
export const parseDateKey = (rawDate: string) => {
  if (!rawDate) return { key: 'nodate', display: '-', valid: false, timestamp: 0, obj: dayjs() };

  const formats = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'M/D/YYYY', 'MM-DD-YYYY', 'DD-MM-YYYY', 'D-MMM-YY', 'D MMM YYYY'];
  let d = dayjs(rawDate);

  // Coba parse strict jika parse biasa gagal
  if (!d.isValid()) d = dayjs(rawDate, formats, true);

  if (d.isValid()) {
    return {
      key: d.format('YYYY-MM-DD'),
      display: d.format('DD/MM/YYYY'),
      valid: true,
      timestamp: d.valueOf(),
      obj: d,
      // Tambahan helper property
      day: d.date(),
      isWeekend: d.day() === 0 || d.day() === 6
    };
  }
  return { key: `raw-${rawDate.trim()}`, display: rawDate, valid: false, timestamp: 0, obj: dayjs() };
};

export const isHolidayTask = (task: Task): boolean => {
  const desc = (task.description || '').toUpperCase();
  const status = (task.status || '').toUpperCase();
  if (status === 'H') return true;
  if (desc.startsWith('[H]') || desc.includes('LIBUR') || desc.includes('HOLIDAY')) return true;
  return false;
};

export const isLeaveTask = (task: Task): boolean => {
  const desc = (task.description || '').toLowerCase();
  return desc.includes('cuti');
};

export const getTimesheetPeriodBounds = (employee: { periodEnd?: string }) => {
  let endDate = employee.periodEnd ? dayjs(employee.periodEnd) : dayjs().date(25);
  if (endDate.date() !== 25) endDate = endDate.date(25);
  const startDate = endDate.subtract(1, 'month').date(26);
  return { startDate, endDate };
};

export const resolveHolidayDates = (customHolidays: string[] = []): string[] => {
  if (customHolidays && customHolidays.length > 0) return customHolidays;
  return [
    '2024-12-25', '2024-12-26',
    '2025-01-01', '2025-01-27', '2025-01-29',
    '2025-03-29', '2025-03-31', '2025-04-01',
    '2025-04-18', '2025-04-20',
    '2025-05-01', '2025-05-12', '2025-05-29',
    '2025-06-01', '2025-06-06', '2025-06-27',
    '2025-08-17', '2025-09-05',
    '2025-12-25', '2025-12-26',
    '2026-01-01',
  ];
};

/** Inject national holidays in period when no task exists for that date. */
export const enrichTasksWithApiHolidays = (
  employee: { periodEnd?: string },
  tasks: Task[],
  customHolidays: string[] = []
): Task[] => {
  const HOLIDAYS = resolveHolidayDates(customHolidays);
  const { startDate, endDate } = getTimesheetPeriodBounds(employee);

  const tasksByDate = new Map<string, Task[]>();
  tasks.forEach((t) => {
    const { key } = parseDateKey(t.date);
    if (key === 'nodate') return;
    if (!tasksByDate.has(key)) tasksByDate.set(key, []);
    tasksByDate.get(key)!.push(t);
  });

  const extra: Task[] = [];
  HOLIDAYS.forEach((date) => {
    const d = dayjs(date);
    if (!d.isValid()) return;
    if (d.isBefore(startDate, 'day') || d.isAfter(endDate, 'day')) return;

    const existing = tasksByDate.get(date) || [];
    if (existing.length === 0) {
      extra.push({ date, description: 'Holiday / Libur Nasional', status: 'H' });
    }
  });

  return extra.length > 0 ? [...tasks, ...extra] : tasks;
};