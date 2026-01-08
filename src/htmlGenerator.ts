import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import fs from 'fs';
import path from 'path';

// Load Plugin Dayjs
dayjs.extend(customParseFormat);

// --- INTERFACE ---
interface Task {
  date: string;
  description: string;
  ticketNumber?: string;
  ticketLink?: string;
}

interface OvertimeTask {
  date: string;
  description: string;
  duration: number;
  ticketLink: string;
  remarks: string;
}

// --- HELPER: Load Image ---
const getBase64Image = (filename: string) => {
  try {
    const imagePath = path.join(process.cwd(), 'assets', filename);
    if (!fs.existsSync(imagePath)) return ''; 
    const bitmap = fs.readFileSync(imagePath);
    const ext = path.extname(filename).slice(1);
    return `data:image/${ext};base64,${bitmap.toString('base64')}`;
  } catch (err) { return ''; }
};

// --- HELPER: Smart Date Parser ---
const parseDateKey = (rawDate: string): { key: string; display: string; valid: boolean; timestamp: number } => {
    if (!rawDate) return { key: 'nodate', display: '-', valid: false, timestamp: 0 };
    const formats = [
        'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'M/D/YYYY', 'D/M/YYYY', 
        'MM-DD-YYYY', 'DD-MM-YYYY', 'D-MMM-YY', 'D MMM YYYY'
    ];
    let d = dayjs(rawDate);
    if (!d.isValid()) d = dayjs(rawDate, formats, true);

    if (d.isValid()) {
        return {
            key: d.format('YYYY-MM-DD'),
            display: d.format('DD/MM/YYYY'),
            valid: true,
            timestamp: d.valueOf()
        };
    }
    return {
        key: `raw-${rawDate.trim()}`,
        display: rawDate,
        valid: false,
        timestamp: 0
    };
};

export const generateHtmlPreview = (employee: any, tasks: Task[], overtimeTasks: OvertimeTask[] = []) => {
  const logoPegadaian = getBase64Image('logo-pegadaian.png'); 
  const logoPoj = getBase64Image('logo-poj.png');             

  // Format Data Karyawan
  const signDate = employee.periodEnd ? dayjs(employee.periodEnd).format('DD/MM/YYYY') : '-';
  const clientSite = employee.clientSite || 'Divisi Pengembangan Aplikasi TI - PT Pegadaian';
  const workUnit = employee.workUnit || 'Dept. IT Business Analyst';
  const deptHead = employee.deptHead || 'Andhar Setiawan';
  const supervisor = employee.supervisor || 'Lailatul Fitriana R';
  const squad = employee.squad || 'Squad IT PLATFORM';
  const employeeNo = employee.no || 'POJ42050260';
  
  let periodDisplay = employee.month;
  if (!periodDisplay && employee.periodStart && employee.periodEnd) {
      const startMonth = dayjs(employee.periodStart).format('MMMM').toUpperCase();
      const endMonth = dayjs(employee.periodEnd).format('MMMM').toUpperCase();
      periodDisplay = startMonth === endMonth ? startMonth : `${startMonth} TO ${endMonth}`;
  } else if (!periodDisplay) {
      periodDisplay = '-';
  }

  // ============================================================
  // LOGIC TABEL A (REGULAR)
  // ============================================================
  const groupedTasks: { [key: string]: { tasks: Task[], meta: any } } = {};
  
  // 1. Grouping
  tasks.forEach((task) => {
    const { key, display, valid, timestamp } = parseDateKey(task.date);
    if (!groupedTasks[key]) {
        groupedTasks[key] = { tasks: [], meta: { display, valid, timestamp } };
    }
    groupedTasks[key].tasks.push(task);
  });
  
  // 2. Sorting
  const sortedKeys = Object.keys(groupedTasks).sort((a, b) => groupedTasks[a].meta.timestamp - groupedTasks[b].meta.timestamp);
  
  // 3. Generate HTML & Kalkulasi Mandays (Real-time Calculation)
  let rowsHtml = '';
  let rowNumber = 1;
  let totalMandays = 0; // Counter Mandays
  
  sortedKeys.forEach((key) => {
    const group = groupedTasks[key];
    const dailyTasks = group.tasks;
    const rowSpan = dailyTasks.length; 
    
    // --- LOGIC CUTI ---
    // Cek apakah ada task di hari ini yang mengandung kata "CUTI"
    const isCuti = dailyTasks.some(t => 
        (t.description || '').toLowerCase().includes('cuti')
    );

    // Jika BUKAN cuti, tambahkan ke total
    if (!isCuti) {
        totalMandays += 1;
    }

    dailyTasks.forEach((t, index) => {
      rowsHtml += `<tr>`;
      
      // Merge Column: No & Date
      if (index === 0) {
        rowsHtml += `<td class="ctr" rowspan="${rowSpan}">${rowNumber}</td>`;
        rowsHtml += `<td class="ctr" rowspan="${rowSpan}">${group.meta.display}</td>`;
      }
      
      // Column: Description
      rowsHtml += `<td class="text-left" style="padding-left: 5px;">${t.description}</td>`;
      
      // Merge Column: Mandays
      if (index === 0) {
        // Jika CUTI, kosongkan. Jika KERJA, tulis 1.
        const mandayValue = isCuti ? '' : '1';
        rowsHtml += `<td class="ctr" rowspan="${rowSpan}">${mandayValue}</td>`;
      }
      
      // Column: JIRA Link
      const ticketNum = t.ticketNumber || '';
      const ticketDisplayA = t.ticketLink 
        ? `<a href="${t.ticketLink}" target="_blank" style="color:blue; text-decoration:none;">${ticketNum || 'Link'}</a>` 
        : ticketNum || '-';

      rowsHtml += `<td class="ctr px-1" style="font-size: 8px; word-break: break-all;">${ticketDisplayA}</td>`;
      rowsHtml += `<td></td><td></td></tr>`;
    });
    
    rowNumber++;
  });

  // Hitung Total Hours berdasarkan Mandays yang valid (bukan cuti)
  const totalHours = totalMandays * 8;


  // ==========================================
  // LOGIC TABEL B (OVERTIME)
  // ==========================================
  let totalOtHours = 0;
  const otDates = new Set();
  let otRowsHtml = '';
  let otRowNumber = 1;

  if (!overtimeTasks || overtimeTasks.length === 0) {
     otRowsHtml += `<tr style="height: 20px;"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
     otRowsHtml += `<tr style="height: 20px;"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  } else {
    overtimeTasks.sort((a, b) => parseDateKey(a.date).timestamp - parseDateKey(b.date).timestamp);

    overtimeTasks.forEach((ot) => {
       const dur = parseFloat(String(ot.duration)) || 0;
       totalOtHours += dur;
       if(ot.date) otDates.add(ot.date);

       const { display: dateDisplay } = parseDateKey(ot.date);
       const ticketDisplayB = ot.ticketLink 
          ? `<a href="${ot.ticketLink}" target="_blank" style="color:blue; text-decoration:none;">Link</a>` 
          : '-';

       otRowsHtml += `<tr>
         <td class="ctr">${otRowNumber}</td>
         <td class="ctr">${dateDisplay}</td>
         <td class="text-left" style="padding-left: 5px;">${ot.description || ''}</td>
         <td class="ctr">${dur}</td>
         <td class="ctr px-1" style="font-size: 8px;">${ticketDisplayB}</td>
         <td class="ctr">${ot.remarks || ''}</td>
       </tr>`;
       otRowNumber++;
    });
  }
  const totalOtDays = otDates.size;

  // --- RETURN HTML ---
  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <style>
        /* CSS LAYOUT */
        @page { size: A4 landscape; margin: 2cm 4.5cm 2cm 4.5cm; }
        
        @media print {
          body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; width: 100%; }
          thead { display: table-row-group; } 
          tr { page-break-inside: avoid; }
          .footer-section { page-break-inside: avoid; }
        }
        
        body { font-family: Arial, sans-serif; background: #fff; margin: 0; display: block; }
        
        .preview-wrapper { background: #525659; padding: 20px; min-height: 100vh; display: flex; justify-content: center; }
        
        .content-area { 
            background: white; 
            width: 297mm; 
            min-height: 210mm; 
            box-sizing: border-box; 
            padding: 1.25cm 4.5cm 4.5cm 4.5cm; 
            margin: 0 auto; 
        }
        
        @media print { .preview-wrapper { padding: 0; background: white; display: block; } .content-area { width: 100%; padding: 0; margin: 0; } }
        
        * { font-size: 9px; } 
        table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 5px; }
        th, td { border: 0.5pt solid black; padding: 3px 2px; vertical-align: middle; }
        th { background-color: #E0E0E0 !important; font-weight: bold; text-align: center; height: 25px; }
        
        .header-wrap { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: none; padding-bottom: 5px; margin-bottom: 12px; }
        .logo-img { max-height: 40px; }
        
        .info-tbl td { border: none !important; padding: 2px 0 !important; }
        .info-tbl td.val-cell { border-bottom: 1px solid black !important; font-weight: bold; padding-left: 5px !important; }
        
        .fw-bold { font-weight: bold; }
        .ctr { text-align: center; }
        .bg-gray { background-color: #F3F3F3 !important; }
        
        .footer-section { display: flex; justify-content: space-between; margin-top: 20px; align-items: flex-start; }
        .recap-tbl { width: auto; min-width: 200px; } 
        .recap-tbl td { text-align: center; }
        .recap-label { font-weight: bold; }
        
        .sign-area { flex: 1; text-align: center; padding: 0 10px; }
        .certify-text { font-style: italic; font-weight: bold; font-size: 8px; border: none; padding: 3px 0; display: block; text-align: left; margin-bottom: 10px; }
        .sign-grid { display: flex; justify-content: space-between; font-weight: bold; }
        .sign-name { margin-top: 45px; text-decoration: underline; text-transform: uppercase; }
        
        .notes-box { border: 0.5pt solid black; width: 120px; min-height: 60px; padding: 3px; }
        
        h1 { font-size: 18px; margin: 0; font-weight: 900; }
        h2 { font-size: 12px; margin: 2px 0 0 0; }
        a { text-decoration: none; color: blue; }
      </style>
    </head>
    <body>
      <div class="preview-wrapper">
        <div class="content-area">
          
          <div class="header-wrap">
            <div style="width: 20%;">${logoPegadaian ? `<img src="${logoPegadaian}" class="logo-img">` : ''}</div>
            <div style="text-align: center; flex: 1;">
              <h1>MANDAYS CONSUMPTION REPORT</h1>
              <h2>PT Pesonna Optima Jasa</h2>
            </div>
            <div style="width: 20%; text-align: right;">${logoPoj ? `<img src="${logoPoj}" class="logo-img">` : ''}</div>
          </div>

          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <table class="info-tbl" style="width: 48%;">
              <tr><td width="90">Client Site</td><td width="10">:</td><td class="val-cell">${clientSite}</td></tr>
              <tr><td>Work Unit</td><td>:</td><td class="val-cell">${workUnit}</td></tr>
              <tr><td>Dept. Head Name</td><td>:</td><td class="val-cell">${deptHead}</td></tr>
              <tr><td>Supervisor</td><td>:</td><td class="val-cell">${supervisor}</td></tr>
            </table>
            <table class="info-tbl" style="width: 48%;">
              <tr><td width="90">Squad</td><td width="10">:</td><td class="val-cell">${squad}</td></tr>
              <tr><td>Employee Name</td><td>:</td><td class="val-cell" style="text-transform:uppercase;">${employee.name}</td></tr>
              <tr><td>Employee No.</td><td>:</td><td class="val-cell">${employeeNo}</td></tr>
              <tr><td>Month</td><td>:</td><td class="val-cell" style="color:#00529C">${periodDisplay}</td></tr>
            </table>
          </div>

          <div style="font-weight:bold; margin-bottom:2px;">A. Regular</div>
          <table>
            <thead>
              <tr>
                <th width="30">No.</th><th width="70">Date</th><th>Description</th><th width="70">Duration of Work<br>(Mandays)</th><th width="140">JIRA's Link</th><th width="70">CRF/G-Canvas No.</th><th width="60">Ket</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr class="bg-gray" style="font-weight:bold;">
                <td colspan="3" style="text-align:right; padding-right:10px;">Total Mandays Reguler</td>
                <td class="ctr">${totalMandays}</td><td colspan="3" style="background:#E0E0E0"></td>
              </tr>
            </tbody>
          </table>

          <div style="font-weight:bold; margin: 15px 0 2px 0;">B. Overtime</div>
          <table>
            <thead>
              <tr>
                <th width="30">No.</th><th width="70">Date</th><th>Description</th><th width="70">Duration of Work<br>(Hours)</th><th width="140">JIRA's Link</th><th width="130">Ket./ Nomor Surat Tugas</th>
              </tr>
            </thead>
            <tbody>
              ${otRowsHtml}
              <tr class="bg-gray" style="font-weight:bold;">
                <td colspan="3" style="text-align:right; padding-right:10px;">Total Hours Overtime</td><td class="ctr">${totalOtHours}</td><td colspan="2" style="background:#E0E0E0"></td>
              </tr>
              <tr class="bg-gray" style="font-weight:bold;">
                <td colspan="3" style="text-align:right; padding-right:10px;">Total Days Overtime</td><td class="ctr">${totalOtDays}</td><td colspan="2" style="background:#E0E0E0"></td>
              </tr>
            </tbody>
          </table>

          <div class="footer-section">
            <table class="recap-tbl">
              <thead>
                <tr style="background:#E0E0E0; font-weight:bold;">
                  <td colspan="2">RECAP</td><td width="40">Hours</td><td width="40">Days</td>
                </tr>
              </thead>
              <tbody>
                <tr><td class="recap-label" width="30">REG</td><td style="text-align:left; width: auto; white-space: nowrap; padding-right: 5px;">Work Hours</td><td>${totalHours}</td><td>${totalMandays}</td></tr>
                <tr><td class="recap-label">OT</td><td style="text-align:left;">Over Time</td><td>${totalOtHours}</td><td>${totalOtDays}</td></tr>
                <tr class="bg-gray" style="font-weight:bold;"><td colspan="2" style="text-align:center;">Total</td><td>${totalHours + totalOtHours}</td><td>${totalMandays + totalOtDays}</td></tr>
              </tbody>
            </table>

            <div class="sign-area">
              <div class="certify-text">"I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD FROM ${periodDisplay}"</div>
              <div class="sign-grid">
                <div><div>Employee</div><div class="sign-name">${employee.name}</div><div style="font-weight:normal; margin-top:2px;">Date: ${signDate}</div></div>
                <div><div>Supervisor</div><div class="sign-name">${supervisor}</div><div style="font-weight:normal; margin-top:2px;">Date: ${signDate}</div></div>
                <div><div>Dept. Head</div><div class="sign-name">${deptHead}</div><div style="font-weight:normal; margin-top:2px;">Date: ${signDate}</div></div>
              </div>
            </div>
            
            <div class="notes-box">
              <div style="font-weight:bold; border-bottom:0.5pt solid black; margin-bottom:3px; padding-bottom:1px;">NOTES:</div>
            </div>
          </div>

        </div>
      </div>
    </body>
    </html>
  `;
};