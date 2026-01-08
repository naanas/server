import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Task } from './types';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

// Load plugin format tanggal
dayjs.extend(customParseFormat);

// Prioritas Format Tanggal
const POSSIBLE_DATE_FORMATS = [
  'M/D/YYYY',         
  'MM/DD/YYYY',       
  'D/M/YYYY',         
  'DD/MM/YYYY',       
  'YYYY-MM-DD',
  'DD-MMM-YYYY',
  'YYYY-MM-DD HH:mm',
  'DD/MM/YYYY HH:mm'
];

export const fetchTasksFromSheet = async (periodStart: string, periodEnd: string): Promise<Task[]> => {
  // --- CONFIG (PINDAH KE DALAM FUNGSI) ---
  // Agar dibaca SETELAH dotenv.config() jalan di index.ts
  const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
  const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://pegadaian.atlassian.net/browse/';

  // DEBUG LOG: Cek apakah URL terbaca
  console.log('--- DEBUG SHEET SERVICE ---');
  console.log('URL CSV:', SHEET_CSV_URL ? 'Terbaca ✅' : 'KOSONG ❌');
  
  if (!SHEET_CSV_URL) {
    console.error("❌ Error: SHEET_CSV_URL belum diset di file .env");
    return [];
  }

  try {
    console.log(`Fetching data from: ${SHEET_CSV_URL}`);
    const response = await axios.get(SHEET_CSV_URL);
    
    // Parse CSV
    const records = parse(response.data, {
      columns: true, 
      skip_empty_lines: true,
      trim: true,
    }) as any[]; 

    if (records.length === 0) {
      console.warn("⚠️ Data CSV kosong atau gagal diparse.");
      return [];
    }

    // --- 1. DETEKSI KOLOM ---
    const headers = Object.keys(records[0]);
    
    // Cari kolom Tanggal
    let dateColName = headers.find(h => 
      h.toLowerCase().includes('start date') || h.toLowerCase().includes('batb')
    ) || headers[0]; 

    // Cari kolom Ticket Key
    let keyColName = headers.find(h => 
      h.toLowerCase() === 'issue key' || h.toLowerCase() === 'key' || h.toLowerCase() === 'id'
    );

    // Cari kolom Deskripsi
    let descColName = headers.find(h => 
      h.toLowerCase() === 'summary' || h.toLowerCase() === 'description' || h.toLowerCase() === 'judul'
    );

    // --- 2. MAPPING DATA ---
    const rawMappedData = records.map((row: any) => {
      // A. Proses Tanggal
      const rawDateStr = row[dateColName];
      let dateObj = dayjs(rawDateStr, POSSIBLE_DATE_FORMATS, true);
      if (!dateObj.isValid()) dateObj = dayjs(rawDateStr); // Fallback

      if (!dateObj.isValid()) return null;

      // B. Proses Ticket & Link
      let ticketNumber = '';
      if (keyColName && row[keyColName]) {
        ticketNumber = row[keyColName].toString().trim();
      }

      let fullLink = '';
      if (ticketNumber) {
        fullLink = `${JIRA_BASE_URL}${ticketNumber}`;
      }

      // C. Proses Deskripsi
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

    // --- 3. FILTER PERIODE ---
    const start = dayjs(periodStart).startOf('day');
    const end = dayjs(periodEnd).endOf('day');

    const filteredTasks = tasks.filter((t) => {
      const tDate = dayjs(t.date);
      // Logic inclusive aman
      return (tDate.isAfter(start.subtract(1, 'second')) && tDate.isBefore(end.add(1, 'second')));
    });

    // --- 4. SORTING ---
    filteredTasks.sort((a, b) => {
      const dateA = dayjs(a.date);
      const dateB = dayjs(b.date);
      return dateA.diff(dateB);
    });

    console.log(`🚀 Data Siap: ${filteredTasks.length} tasks (Range: ${periodStart} s/d ${periodEnd})`);
    
    return filteredTasks;

  } catch (error) {
    console.error('Error fetching sheet:', error);
    return [];
  }
};