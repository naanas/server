import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Task } from './types';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

// Load plugin format tanggal
dayjs.extend(customParseFormat);

// --- CONFIG ---
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSdJ_MTijEr9OCB1IVZlAlL7aj4rZb9QzMjMua82AL22rJJv6WP2jLzLyEwKgwUlYnfMD2mg3TEzS2i/pub?output=csv';
const JIRA_BASE_URL = 'https://pegadaian.atlassian.net/browse/';

// Prioritas Format Tanggal
const POSSIBLE_DATE_FORMATS = [
  'M/D/YYYY',         // 1/2/2026 (Format Default Sheet US)
  'MM/DD/YYYY',       
  'D/M/YYYY',         // Format Indo
  'DD/MM/YYYY',       
  'YYYY-MM-DD',
  'DD-MMM-YYYY',
  'YYYY-MM-DD HH:mm',
  'DD/MM/YYYY HH:mm'
];

export const fetchTasksFromSheet = async (periodStart: string, periodEnd: string): Promise<Task[]> => {
  try {
    console.log('--- START FETCHING SHEET ---');
    const response = await axios.get(SHEET_CSV_URL);
    
    // Parse CSV
    const records = parse(response.data, {
      columns: true, 
      skip_empty_lines: true,
      trim: true,
    }) as any[]; 

    if (records.length === 0) return [];

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
      return (tDate.isAfter(start.subtract(1, 'second')) && tDate.isBefore(end.add(1, 'second')));
    });

    // --- 4. SORTING (ASCENDING) ---
    // Logika: Tanggal Awal (Lama) -> Tanggal Akhir (Baru)
    filteredTasks.sort((a, b) => {
      const dateA = dayjs(a.date);
      const dateB = dayjs(b.date);
      return dateA.diff(dateB); // Jika positif, A lebih besar (lebih baru), taruh di bawah
    });

    console.log(`🚀 Data Siap & Terurut: ${filteredTasks.length} tasks`);
    
    return filteredTasks;

  } catch (error) {
    console.error('Error fetching sheet:', error);
    throw error;
  }
};