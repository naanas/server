import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { Task, OvertimeTask, parseDateKey } from './templates/htmlHelpers';

// Helper untuk styling border
const borderStyle: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' }
};

const centerStyle: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'center' };
const leftStyle: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'left' };
const fillHeader: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }; // Abu-abu
const fillHoliday: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFECEC' } }; // Merah Muda
const fillWeekend: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } }; // Abu Muda

export const generateTimesheetExcel = async (
    employee: any, 
    tasks: Task[], 
    overtimeTasks: OvertimeTask[],
    holidays: string[] = [] // Terima data libur
) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Timesheet');

  // --- 1. SETUP TANGGAL ---
  let endDate = employee.periodEnd ? dayjs(employee.periodEnd) : dayjs().date(25);
  if (endDate.date() !== 25) endDate = endDate.date(25); 
  const startDate = endDate.subtract(1, 'month').date(26);
  
  // Generate Headers Tanggal
  const dateHeaders: { date: string, label: string, isWeekend: boolean }[] = [];
  let curr = startDate.clone();
  while (curr.isBefore(endDate) || curr.isSame(endDate, 'day')) {
      dateHeaders.push({ 
          date: curr.format('YYYY-MM-DD'), 
          label: curr.format('D'), 
          isWeekend: curr.day() === 0 || curr.day() === 6 
      });
      curr = curr.add(1, 'day');
  }

  // --- 2. DATA PROCESSING (Sama seperti HTML) ---
  const dataMap: Record<string, { status: string, ot: number, isHoliday: boolean }> = {};
  
  // Fallback Holiday jika kosong
  let HOLIDAYS = holidays;
  if (!HOLIDAYS || HOLIDAYS.length === 0) {
      HOLIDAYS = ['2025-01-01', '2025-01-27', '2025-01-29', '2025-03-29', '2025-03-31', '2025-04-01', '2025-04-18', '2025-04-20', '2025-05-01'];
  }

  // Init Map
  dateHeaders.forEach(h => {
      const isNasional = HOLIDAYS.includes(h.date);
      dataMap[h.date] = { 
          status: isNasional ? 'H' : (h.isWeekend ? 'W' : ''), 
          ot: 0, 
          isHoliday: isNasional 
      };
  });

  // Map Tasks
  tasks.forEach(t => {
      const key = parseDateKey(t.date).key;
      if (dataMap[key]) {
          const desc = (t.description || '').toUpperCase();
          const userStatus = (t.status || '').toUpperCase();
          
          let code = '';
          if (desc.startsWith('[AL]') || userStatus === 'AL') code = 'AL';
          else if (desc.startsWith('[S]') || userStatus === 'S') code = 'S';
          else if (desc.startsWith('[H]') || userStatus === 'H') code = 'H';
          else if (desc.startsWith('[U]') || userStatus === 'U') code = 'U';
          else if (desc.startsWith('[C]') || userStatus === 'C') code = 'C';
          
          if (code) {
             dataMap[key].status = code;
             dataMap[key].isHoliday = (code === 'H');
          } else if (userStatus === 'WH' || desc.length > 1) {
             dataMap[key].status = '8';
          }
      }
  });

  // Map Overtime
  overtimeTasks.forEach(ot => {
      const key = parseDateKey(ot.date).key;
      if (dataMap[key]) dataMap[key].ot += Number(ot.duration) || 0;
  });

  // --- 3. BUILD EXCEL UI ---

  // Judul
  sheet.mergeCells('A1:AG1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'REKAPITULASI PERHITUNGAN LEMBAR KERJA';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = centerStyle;

  sheet.mergeCells('A2:AG2');
  const subTitleCell = sheet.getCell('A2');
  subTitleCell.value = 'PT Pesonna Optima Jasa';
  subTitleCell.font = { size: 11 };
  subTitleCell.alignment = centerStyle;

  // Info Karyawan (Baris 4-7)
  const infoData = [
      ['Client Site', ':', employee.clientSite || '', 'Squad', ':', employee.squad || ''],
      ['Work Unit', ':', employee.workUnit || '', 'Name', ':', (employee.reportName || employee.name || '').toUpperCase()],
      ['Dept Head', ':', employee.deptHead || '', 'NIK', ':', employee.no || ''],
      ['Supervisor', ':', employee.supervisor || '', 'Month', ':', employee.month || '']
  ];

  infoData.forEach((row, i) => {
      const r = sheet.getRow(4 + i);
      r.getCell(1).value = row[0]; // Label Kiri
      r.getCell(2).value = row[1];
      r.getCell(3).value = row[2]; // Value Kiri
      r.getCell(3).font = { bold: true };
      
      r.getCell(18).value = row[3]; // Label Kanan (Geser ke kolom R)
      r.getCell(19).value = row[4];
      r.getCell(20).value = row[5]; // Value Kanan
      r.getCell(20).font = { bold: true };
  });

  // --- TABEL MATRIX ---
  const headerRowIdx = 9;
  const headerRow = sheet.getRow(headerRowIdx);
  
  // Kolom A & B
  headerRow.getCell(1).value = 'Code';
  headerRow.getCell(2).value = 'Category';
  
  // Kolom Tanggal (C dst)
  dateHeaders.forEach((h, i) => {
      const cell = headerRow.getCell(3 + i);
      cell.value = Number(h.label);
      cell.fill = fillHeader;
      cell.border = borderStyle;
      cell.alignment = centerStyle;
      
      // Set width kolom tanggal biar rapi (kecil)
      sheet.getColumn(3 + i).width = 4;
  });

  // Style Header A & B
  ['A','B'].forEach(col => {
      const c = sheet.getCell(`${col}${headerRowIdx}`);
      c.fill = fillHeader;
      c.border = borderStyle;
      c.alignment = centerStyle;
      c.font = { bold: true };
  });

  // Fungsi helper buat baris data
  const buildExcelRow = (code: string, label: string, type: 'status'|'ot'|'check') => {
      const row = sheet.addRow([code, label]);
      const rowIdx = row.number;

      // Style Col A & B
      const cA = row.getCell(1);
      cA.fill = fillHeader;
      cA.font = { bold: true };
      cA.alignment = centerStyle;
      cA.border = borderStyle;

      const cB = row.getCell(2);
      cB.alignment = leftStyle;
      cB.border = borderStyle;

      // Isi Data per Tanggal
      dateHeaders.forEach((h, i) => {
          const cell = row.getCell(3 + i);
          const item = dataMap[h.date];
          
          let val: string | number = '';
          
          // Warna Background Cell
          if (item.isHoliday) cell.fill = fillHoliday;
          else if (h.isWeekend) cell.fill = fillWeekend;

          if (type === 'ot') {
              val = item.ot > 0 ? item.ot : '';
          } else if (type === 'check') {
              if (code === 'H' && item.status === 'H') val = 'H';
              else if (code === 'AL' && item.status === 'AL') val = 'AL';
              else if (code === 'S' && item.status === 'S') val = 'S';
              else if (code === 'W' && item.status === 'W') val = 'W';
              else if (code === 'U' && item.status === 'U') val = 'U';
              else if (code === 'C' && item.status === 'C') val = 'C';
          } else {
              if (item.status === '8') val = 8;
              else if (['AL','S','U','C','H','W'].includes(item.status)) val = item.status;
          }

          cell.value = val;
          cell.border = borderStyle;
          cell.alignment = centerStyle;
      });
  };

  // Generate Rows
  buildExcelRow('WH', 'Work Hours', 'status');
  buildExcelRow('OT', 'Over Time', 'ot');
  buildExcelRow('H', '- Holidays', 'check');
  buildExcelRow('AL', '- Annual Leave', 'check');
  buildExcelRow('S', 'Sick Leave', 'check');
  buildExcelRow('U', 'Unpaid Leave', 'check');
  buildExcelRow('C', 'Comp. Off', 'check');
  buildExcelRow('W', '- Weekend', 'check');

  // Baris Total
  const totalRow = sheet.addRow(['', 'Total']);
  totalRow.getCell(2).alignment = { horizontal: 'right' };
  totalRow.getCell(2).font = { bold: true };
  totalRow.getCell(2).border = borderStyle;
  
  dateHeaders.forEach((h, i) => {
      const cell = totalRow.getCell(3 + i);
      const d = dataMap[h.date];
      let val = 0;
      if (d.status === '8') val += 8;
      val += d.ot;

      if (val > 0) cell.value = val;
      cell.border = borderStyle;
      cell.alignment = centerStyle;
      cell.font = { bold: true };
      if (h.isWeekend) cell.fill = fillWeekend;
  });

  // Adjust Col Widths
  sheet.getColumn(1).width = 5;  // Code
  sheet.getColumn(2).width = 20; // Category

  // Return Buffer
  return await workbook.xlsx.writeBuffer();
};