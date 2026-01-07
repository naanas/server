import { Task, EmployeeData } from './types';
import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';

const getBase64Image = (filename: string) => {
  try {
    const imagePath = path.join(process.cwd(), 'assets', filename);
    if (!fs.existsSync(imagePath)) return ''; 
    const bitmap = fs.readFileSync(imagePath);
    const ext = path.extname(filename).slice(1);
    return `data:image/${ext};base64,${bitmap.toString('base64')}`;
  } catch (err) { return ''; }
};

export const generateHtmlPreview = (employee: EmployeeData, tasks: Task[]) => {
  const logoPegadaian = getBase64Image('logo-pegadaian.png'); 
  const logoPoj = getBase64Image('logo-poj.png');             

  const startMonth = dayjs(employee.periodStart).format('MMMM').toUpperCase();
  const endMonth = dayjs(employee.periodEnd).format('MMMM').toUpperCase();
  const periodDisplay = startMonth === endMonth ? startMonth : `${startMonth} TO ${endMonth}`;
  const signDate = dayjs(employee.periodEnd).format('DD/MM/YYYY');

  const groupedTasks: { [date: string]: Task[] } = {};
  tasks.forEach(task => {
    if (!groupedTasks[task.date]) groupedTasks[task.date] = [];
    groupedTasks[task.date].push(task);
  });

  const uniqueDays = Object.keys(groupedTasks);
  const totalMandays = uniqueDays.length;
  const totalHours = totalMandays * 8;

  let rowsHtml = '';
  let rowNumber = 1;

  uniqueDays.forEach((date) => {
    const dailyTasks = groupedTasks[date];
    const rowSpan = dailyTasks.length;

    dailyTasks.forEach((t, index) => {
      // Style page-break-inside: avoid mencegah baris terpotong di tengah halaman
      rowsHtml += `<tr style="page-break-inside: avoid;">`;
      if (index === 0) {
        rowsHtml += `<td class="border ctr" rowspan="${rowSpan}">${rowNumber}</td>`;
        rowsHtml += `<td class="border ctr" rowspan="${rowSpan}">${dayjs(date).format('DD/MM/YYYY')}</td>`;
      }
      rowsHtml += `<td class="border px-2 text-left">${t.description}</td>`;
      if (index === 0) {
        rowsHtml += `<td class="border ctr" rowspan="${rowSpan}">1</td>`;
      }
      // word-break: break-all PENTING agar link panjang tidak melebarkan tabel
      rowsHtml += `<td class="border ctr px-1" style="font-size: 9px; word-break: break-all;">
        ${t.ticketLink ? `<a href="${t.ticketLink}" target="_blank" style="color:blue; text-decoration:none;">${t.ticketNumber}</a>` : t.ticketNumber || '-'}
      </td>`;
      rowsHtml += `<td class="border"></td><td class="border"></td></tr>`;
    });
    rowNumber++;
  });

  const fillerCount = Math.max(0, 10 - tasks.length);
  const fillerRows = Array(fillerCount).fill(0).map(() => 
    `<tr style="height: 24px;"><td class="border"></td><td class="border"></td><td class="border"></td><td class="border"></td><td class="border"></td><td class="border"></td><td class="border"></td></tr>`
  ).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Timesheet Preview</title>
      <style>
        /* 1. RESET MARGIN BROWSER */
        @page {
          size: A4 landscape;
          margin: 0; /* Hapus margin default browser */
        }
        
        /* 2. BODY RESET */
        body {
          margin: 0;
          padding: 0;
          background-color: #E5E5E5; /* Background abu di preview web */
          -webkit-print-color-adjust: exact;
        }

        /* 3. KERTAS A4 FISIK */
        .sheet {
          width: 297mm;  /* Lebar A4 Landscape */
          min-height: 209mm; /* Tinggi A4 Landscape (-1mm toleransi) */
          margin: 0 auto;
          background: white;
          padding: 10mm 15mm; /* Kita atur margin sendiri di sini (Atas/Bawah 10mm, Kiri/Kanan 15mm) */
          box-sizing: border-box;
          position: relative;
          box-shadow: 0 0 10px rgba(0,0,0,0.1); /* Shadow hanya untuk preview web */
        }

        /* Hapus shadow saat print */
        @media print {
          body { background: white; }
          .sheet { box-shadow: none; margin: 0; width: 100%; page-break-after: always; }
        }

        /* STYLE UMUM */
        * { font-family: Arial, Helvetica, sans-serif; }
        
        /* TABLE LAYOUT FIXED: Agar kolom nurut sama width yg kita set */
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        
        th, td { 
          border: 0.75pt solid black; /* Border solid tipis tajam */
          padding: 4px 3px; 
          font-size: 10px; 
          vertical-align: middle; 
        }

        th { 
          font-weight: bold; 
          background-color: #DBEAFF !important; 
          text-align: center;
          font-size: 10.5px;
        }

        .ctr { text-align: center; }
        .px-2 { padding-left: 5px; padding-right: 5px; }
        .bg-gray { background-color: #F3F3F3 !important; }
        
        /* HEADER SECTION */
        .header-wrap { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2pt solid #00529C; padding-bottom: 8px; margin-bottom: 15px; }
        
        /* INFO TABLE (Tanpa Border) */
        .info-tbl td { border: none !important; padding: 1px 0 !important; font-size: 10px; }
        .fw-bold { font-weight: bold; }

      </style>
    </head>
    <body>
      
      <div class="sheet">
        
        <div class="header-wrap">
          <div style="width: 20%;">${logoPegadaian ? `<img src="${logoPegadaian}" style="max-height: 45px;">` : ''}</div>
          <div style="text-align: center; flex: 1;">
            <h1 style="font-size: 18px; margin: 0; font-weight: 900; color: #333;">MANDAYS CONSUMPTION REPORT</h1>
            <h2 style="font-size: 13px; margin: 2px 0 0 0; color: #555;">PT Pesonna Optima Jasa</h2>
          </div>
          <div style="width: 20%; text-align: right;">${logoPoj ? `<img src="${logoPoj}" style="max-height: 40px;">` : ''}</div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <div style="width: 48%;">
            <table class="info-tbl">
              <tr><td width="90">Client Site</td><td width="10">:</td><td class="fw-bold">Divisi Pengembangan Aplikasi TI - PT Pegadaian</td></tr>
              <tr><td>Work Unit</td><td>:</td><td class="fw-bold">Dept. IT Business Analyst</td></tr>
              <tr><td>Dept. Head Name</td><td>:</td><td class="fw-bold">Andhar Setiawan</td></tr>
              <tr><td>Supervisor</td><td>:</td><td class="fw-bold">Lailatul Fitriana R</td></tr>
            </table>
          </div>
          <div style="width: 48%;">
            <table class="info-tbl">
              <tr><td width="90">Squad</td><td width="10">:</td><td class="fw-bold">Squad IT PLATFORM</td></tr>
              <tr><td>Employee Name</td><td>:</td><td class="fw-bold" style="text-transform:uppercase;">${employee.name}</td></tr>
              <tr><td>Employee No.</td><td>:</td><td class="fw-bold">POJ42050260</td></tr>
              <tr><td>Month</td><td>:</td><td class="fw-bold" style="color:#00529C">${periodDisplay}</td></tr>
            </table>
          </div>
        </div>

        <div style="font-weight:bold; margin-bottom:4px; font-size: 11px;">A. Regular</div>
        <table>
          <thead>
            <tr>
              <th style="width: 35px;">No.</th>
              <th style="width: 90px;">Date</th>
              <th>Description</th> <th style="width: 80px;">Duration of Work<br>(Mandays)</th>
              <th style="width: 180px;">JIRA's Link</th>
              <th style="width: 90px;">CRF No.</th>
              <th style="width: 90px;">Ket.</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            ${fillerRows}
            <tr class="bg-gray" style="font-weight:bold; height: 26px;">
              <td colspan="3" style="text-align:right; padding-right:12px;">Total Mandays Reguler</td>
              <td class="ctr">${totalMandays}</td>
              <td colspan="3" style="background:#E0E0E0;"></td>
            </tr>
          </tbody>
        </table>

        <div style="font-weight:bold; margin: 15px 0 4px 0; font-size: 11px;">B. Overtime</div>
        <table>
          <thead>
            <tr>
              <th style="width: 35px;">No.</th>
              <th style="width: 90px;">Date</th>
              <th>Description</th>
              <th style="width: 80px;">Duration of Work<br>(Hours)</th>
              <th style="width: 180px;">JIRA's Link</th>
              <th style="width: 180px;">Ket./ No. ST</th>
            </tr>
          </thead>
          <tbody>
            <tr style="height:22px;"><td colspan="6"></td></tr>
            <tr class="bg-gray" style="font-weight:bold;">
              <td colspan="3" style="text-align:right; padding-right:12px;">Total Hours Overtime</td>
              <td class="ctr">0</td>
              <td colspan="2" style="background:#E0E0E0;"></td>
            </tr>
          </tbody>
        </table>

        <div style="display: flex; justify-content: space-between; margin-top: 20px; page-break-inside: avoid;">
          
          <div style="width: 220px;">
            <table>
              <tr style="background-color: #DBEAFF; font-weight:bold;" class="ctr"><td>RECAP</td><td>Hours</td><td>Days</td></tr>
              <tr><td style="padding-left: 8px;">REG - Work Hours</td><td class="ctr">${totalHours}</td><td class="ctr">${totalMandays}</td></tr>
              <tr><td style="padding-left: 8px;">OT - Over Time</td><td class="ctr">0</td><td class="ctr">0</td></tr>
              <tr class="bg-gray" style="font-weight:bold;"><td class="ctr">Total</td><td class="ctr">${totalHours}</td><td class="ctr">${totalMandays}</td></tr>
            </table>
          </div>

          <div style="flex:1; margin: 0 20px; text-align:center;">
            <div style="font-style:italic; font-weight:bold; font-size:9px; border:0.75pt solid black; padding:4px; margin-bottom:12px; display:inline-block;">
              "I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD FROM ${periodDisplay}"
            </div>
            <div style="display:flex; justify-content:space-between; font-size:10px; font-weight:bold;">
              <div>
                <div style="margin-bottom:50px">Employee</div>
                <div style="text-decoration:underline; text-transform:uppercase;">${employee.name}</div>
                <div style="font-weight:normal; font-size:9px; margin-top:2px;">Date: ${signDate}</div>
              </div>
              <div>
                <div style="margin-bottom:50px">Supervisor</div>
                <div style="text-decoration:underline">LAILATUL FITRIANA R</div>
                <div style="font-weight:normal; font-size:9px; margin-top:2px;">Date: ${signDate}</div>
              </div>
              <div>
                <div style="margin-bottom:50px">Dept. Head</div>
                <div style="text-decoration:underline">ANDHAR SETIAWAN</div>
                <div style="font-weight:normal; font-size:9px; margin-top:2px;">Date: ${signDate}</div>
              </div>
            </div>
          </div>

          <div style="border:0.75pt solid black; width: 150px; min-height: 80px; padding: 4px;">
            <div style="font-weight:bold; border-bottom:0.75pt solid black; margin-bottom:5px; font-size: 10px;">NOTES:</div>
          </div>

        </div> </div> </body>
    </html>
  `;
};