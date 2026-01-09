import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Task } from '../types/types';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

// Prioritas Format Tanggal
const POSSIBLE_DATE_FORMATS = [
  'M/D/YYYY', 'MM/DD/YYYY', 'D/M/YYYY', 'DD/MM/YYYY', 
  'YYYY-MM-DD', 'DD-MMM-YYYY', 'YYYY-MM-DD HH:mm', 'DD/MM/YYYY HH:mm'
];

export const fetchTasksFromSheet = async (periodStart: string, periodEnd: string): Promise<Task[]> => {
  // --- BACA ENV DI DALAM FUNGSI (Agar aman urutan loadingnya) ---
  const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
  const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://pegadaian.atlassian.net/browse/';

  // Debugging Log (Bisa dilihat di Vercel Logs untuk memastikan ENV masuk)
  if (!SHEET_CSV_URL) {
    console.error("❌ Error: SHEET_CSV_URL tidak ditemukan di Environment Variables.");
    return [];
  } else {
    // Log sukses tapi jangan print URL lengkap demi keamanan
    console.log("✅ SHEET_CSV_URL: Terdeteksi.");
  }

  try {
    const response = await axios.get(SHEET_CSV_URL);
    
    // Parse CSV
    const records = parse(response.data, {
      columns: true, 
      skip_empty_lines: true,
      trim: true,
    }) as any[]; 

    if (records.length === 0) return [];

    // 1. Deteksi Header Kolom (Flexible)
    const headers = Object.keys(records[0]);
    
    const dateColName = headers.find(h => 
      h.toLowerCase().includes('start date') || h.toLowerCase().includes('batb')
    ) || headers[0]; 

    const keyColName = headers.find(h => 
      h.toLowerCase() === 'issue key' || h.toLowerCase() === 'key' || h.toLowerCase() === 'id'
    );

    const descColName = headers.find(h => 
      h.toLowerCase() === 'summary' || h.toLowerCase() === 'description' || h.toLowerCase() === 'judul'
    );

    // 2. Mapping Data
    const rawMappedData = records.map((row: any) => {
      // Tanggal
      const rawDateStr = row[dateColName];
      let dateObj = dayjs(rawDateStr, POSSIBLE_DATE_FORMATS, true);
      if (!dateObj.isValid()) dateObj = dayjs(rawDateStr); // Fallback

      if (!dateObj.isValid()) return null;

      // Ticket
      let ticketNumber = '';
      if (keyColName && row[keyColName]) {
        ticketNumber = row[keyColName].toString().trim();
      }

      // Link
      let fullLink = '';
      if (ticketNumber) {
        fullLink = `${JIRA_BASE_URL}${ticketNumber}`;
      }

      // Deskripsi
      let description = 'No Description';
      if (descColName && row[descColName]) {
        description = row[descColName];
      }

      return {
        date: dateObj.format('YYYY-MM-DD'),
        description: description,
        ticketNumber: ticketNumber,
        ticketLink: fullLink
      };
    });

    const tasks = rawMappedData.filter((t: any) => t !== null) as Task[];

    // 3. Filter Periode
    const start = dayjs(periodStart).startOf('day');
    const end = dayjs(periodEnd).endOf('day');

    const filteredTasks = tasks.filter((t) => {
      const tDate = dayjs(t.date);
      // Logic inclusive
      return (tDate.isAfter(start.subtract(1, 'second')) && tDate.isBefore(end.add(1, 'second')));
    });

    // 4. Sorting
    filteredTasks.sort((a, b) => {
      const dateA = dayjs(a.date);
      const dateB = dayjs(b.date);
      return dateA.diff(dateB); 
    });

    console.log(`🚀 Fetched ${filteredTasks.length} valid tasks from sheet.`);
    return filteredTasks;

  } catch (error) {
    console.error('Error fetching sheet:', error);
    return [];
  }
};