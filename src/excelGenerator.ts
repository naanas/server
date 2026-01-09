import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { Task, EmployeeData } from './types/types';

export const generateTimesheet = async (employee: EmployeeData, tasks: Task[]) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('MANDAYS CONSUMPTION REPORT', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
  });

  // 1. SETUP KOLOM
  sheet.columns = [
    { key: 'A', width: 5 },  // No
    { key: 'B', width: 12 }, // Date
    { key: 'C', width: 50 }, // Desc
    { key: 'U', width: 12 }, // Duration
    { key: 'W', width: 30 }, // Link
    { key: 'X', width: 15 }, // CRF
    { key: 'Y', width: 15 }, // Ket
  ];

  // STYLE HELPER
  const borderStyle: Partial<ExcelJS.Borders> = {
    top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
  };
  const centerStyle: Partial<ExcelJS.Style> = { alignment: { horizontal: 'center', vertical: 'middle' } };
  const boldStyle: Partial<ExcelJS.Style> = { font: { bold: true, name: 'Arial', size: 10 } };

  // 2. HEADER
  sheet.mergeCells('A1:Y1'); sheet.getCell('A1').value = 'MANDAYS CONSUMPTION REPORT'; 
  sheet.getCell('A1').font = { bold: true, size: 14, underline: true }; sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:Y2'); sheet.getCell('A2').value = 'PT Pesonna Optima Jasa';
  sheet.getCell('A2').font = { bold: true, size: 11 }; sheet.getCell('A2').alignment = { horizontal: 'center' };

  // INFO USER
  const infoRowStart = 5;
  sheet.getCell(`B${infoRowStart}`).value = 'Client Site : Divisi Pengembangan Aplikasi TI';
  sheet.getCell(`W${infoRowStart}`).value = 'Squad : IT PLATFORM';
  
  sheet.getCell(`B${infoRowStart+1}`).value = 'Work Unit : Dept. IT Business Analyst';
  sheet.getCell(`W${infoRowStart+1}`).value = `Employee Name : ${employee.name}`;

  sheet.getCell(`B${infoRowStart+2}`).value = 'Dept. Head : Andhar Setiawan';
  sheet.getCell(`W${infoRowStart+2}`).value = 'Employee No : POJ42050260';

  sheet.getCell(`B${infoRowStart+3}`).value = 'Supervisor : Lailatul Fitriana R';
  sheet.getCell(`W${infoRowStart+3}`).value = `Month : ${dayjs(employee.periodStart).format('MMMM').toUpperCase()}`;

  // 3. TABLE HEADER
  const headerRowIdx = 10;
  sheet.getCell(`A${headerRowIdx}`).value = 'A. Regular';
  sheet.getCell(`A${headerRowIdx}`).font = { bold: true };

  const tableHeadRow = sheet.getRow(headerRowIdx + 1);
  tableHeadRow.values = { A: 'No.', B: 'Date', C: 'Description', U: 'Duration\n(Mandays)', W: "JIRA's Link", X: 'CRF', Y: 'Ket' };
  tableHeadRow.font = { bold: true };
  tableHeadRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  
  // Apply Border to Header
  ['A','B','C','U','W','X','Y'].forEach(k => {
    tableHeadRow.getCell(k).border = borderStyle;
    tableHeadRow.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  });

  // 4. ISI DATA
  let currentRow = headerRowIdx + 2;
  tasks.forEach((task, i) => {
    const row = sheet.getRow(currentRow);
    row.getCell('A').value = i + 1;
    row.getCell('B').value = task.date;
    row.getCell('C').value = task.description;
    row.getCell('U').value = 1;
    
    if (task.ticketLink) {
       row.getCell('W').value = { text: task.ticketNumber, hyperlink: task.ticketLink };
       row.getCell('W').font = { color: { argb: 'FF0000FF' }, underline: true };
    } else {
       row.getCell('W').value = task.ticketNumber || '';
    }

    // Styling
    ['A','B','C','U','W','X','Y'].forEach(k => {
      row.getCell(k).border = borderStyle;
      if(k !== 'C') row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' };
    });
    
    currentRow++;
  });

  // FILLER ROWS (Min 15 baris)
  const fillerCount = Math.max(0, 15 - tasks.length);
  for(let i=0; i<fillerCount; i++) {
     const row = sheet.getRow(currentRow);
     ['A','B','C','U','W','X','Y'].forEach(k => row.getCell(k).border = borderStyle);
     currentRow++;
  }

  // TOTAL ROW
  const totalRow = sheet.getRow(currentRow);
  sheet.mergeCells(`A${currentRow}:C${currentRow}`);
  totalRow.getCell('A').value = 'Total Mandays Reguler';
  totalRow.getCell('A').alignment = { horizontal: 'right' };
  totalRow.getCell('A').font = { bold: true };
  totalRow.getCell('A').border = borderStyle;

  totalRow.getCell('U').value = tasks.length;
  totalRow.getCell('U').font = { bold: true };
  totalRow.getCell('U').border = borderStyle;
  totalRow.getCell('U').alignment = { horizontal: 'center' };

  // SIGNATURES & FOOTER (Simple Placement)
  const signRow = currentRow + 4;
  sheet.getCell(`C${signRow}`).value = 'Employee';
  sheet.getCell(`U${signRow}`).value = 'Supervisor';
  sheet.getCell(`W${signRow}`).value = 'Dept. Head';
  ['C','U','W'].forEach(c => sheet.getCell(`${c}${signRow}`).font = { bold: true, size: 10 });

  const nameRow = signRow + 5;
  sheet.getCell(`C${nameRow}`).value = employee.name.toUpperCase();
  sheet.getCell(`U${nameRow}`).value = 'LAILATUL FITRIANA R';
  sheet.getCell(`W${nameRow}`).value = 'ANDHAR SETIAWAN';
  ['C','U','W'].forEach(c => {
      sheet.getCell(`${c}${nameRow}`).font = { bold: true, underline: true };
  });

  return await workbook.xlsx.writeBuffer();
};