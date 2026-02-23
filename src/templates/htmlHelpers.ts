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