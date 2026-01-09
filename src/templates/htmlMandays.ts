import dayjs from 'dayjs';
import { Task, OvertimeTask, getBase64Image, parseDateKey } from './htmlHelpers';

export const generateMandaysHtml = (employee: any, tasks: Task[], overtimeTasks: OvertimeTask[]) => {
  const logoPegadaian = getBase64Image('logo-pegadaian.png'); 
  const logoPoj = getBase64Image('logo-poj.png');             

  // --- LOGIC DISPLAY NAME ---
  const displayName = (employee.reportName && employee.reportName.trim() !== '') 
                      ? employee.reportName 
                      : employee.name;

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

  // LOGIC TABEL A
  const groupedTasks: { [key: string]: { tasks: Task[], meta: any } } = {};
  tasks.forEach((task) => {
    const { key, display, valid, timestamp } = parseDateKey(task.date);
    if (!groupedTasks[key]) groupedTasks[key] = { tasks: [], meta: { display, valid, timestamp } };
    groupedTasks[key].tasks.push(task);
  });
  
  const sortedKeys = Object.keys(groupedTasks).sort((a, b) => groupedTasks[a].meta.timestamp - groupedTasks[b].meta.timestamp);
  
  let rowsHtml = '';
  let rowNumber = 1;
  let totalMandays = 0; 
  
  sortedKeys.forEach((key) => {
    const group = groupedTasks[key];
    const dailyTasks = group.tasks;
    const rowSpan = dailyTasks.length; 
    
    const isCuti = dailyTasks.some(t => (t.description || '').toLowerCase().includes('cuti'));
    if (!isCuti) totalMandays += 1;

    dailyTasks.forEach((t, index) => {
      rowsHtml += `<tr>`;
      if (index === 0) {
        rowsHtml += `<td class="ctr" rowspan="${rowSpan}">${rowNumber}</td>`;
        rowsHtml += `<td class="ctr" rowspan="${rowSpan}">${group.meta.display}</td>`;
      }
      rowsHtml += `<td class="text-left" style="padding-left: 5px;">${t.description}</td>`;
      if (index === 0) {
        const mandayValue = isCuti ? '' : '1';
        rowsHtml += `<td class="ctr" rowspan="${rowSpan}">${mandayValue}</td>`;
      }
      const ticketNum = t.ticketNumber || '';
      const ticketDisplayA = t.ticketLink 
        ? `<a href="${t.ticketLink}" target="_blank" style="color:blue; text-decoration:none;">${ticketNum || 'Link'}</a>` 
        : ticketNum || '-';

      rowsHtml += `<td class="ctr px-1" style="font-size: 8px; word-break: break-all;">${ticketDisplayA}</td>`;
      rowsHtml += `<td></td><td></td></tr>`;
    });
    rowNumber++;
  });

  const totalHours = totalMandays * 8;

  // LOGIC TABEL B
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

  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: A4 landscape; margin: 2cm 4.5cm 2cm 4.5cm; }
        @media print {
          body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; width: 100%; }
          thead { display: table-row-group; } 
          tr { page-break-inside: avoid; }
          .footer-section { page-break-inside: avoid; }
        }
        body { font-family: Arial, sans-serif; background: #fff; margin: 0; display: block; }
        
        .preview-wrapper { background: #525659; padding: 20px; min-height: 100vh; display: flex; justify-content: center; }
        .content-area { background: white; width: 297mm; min-height: 210mm; box-sizing: border-box; padding: 1.25cm 4.5cm 4.5cm 4.5cm; margin: 0 auto; }
        @media print { .preview-wrapper { padding: 0; background: white; display: block; } .content-area { width: 100%; padding: 0; margin: 0; } }
        
        * { font-size: 9px; } 
        table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 5px; }
        
        /* GENERAL TABLE BORDER: 0.1pt */
        th, td { border: 0.1pt solid black; padding: 3px 2px; vertical-align: middle; }
        th { background-color: #E0E0E0 !important; font-weight: bold; text-align: center; height: 25px; }
        
        .header-wrap { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: none; padding-bottom: 5px; margin-bottom: 12px; }
        .logo-img { max-height: 40px; }
        
        .info-tbl td { border: none !important; padding: 2px 0 !important; }
        .info-tbl td.val-cell { border-bottom: 0.1pt solid black !important; font-weight: bold; padding-left: 5px !important; }
        
        .fw-bold { font-weight: bold; }
        .ctr { text-align: center; }
        .bg-gray { background-color: #F3F3F3 !important; }
        
        .footer-section { display: flex; justify-content: space-between; margin-top: 20px; align-items: flex-start; }
        .recap-tbl { width: auto; min-width: 200px; } 
        .recap-tbl td { text-align: center; }
        .recap-label { font-weight: bold; }
        
        .sign-area { flex: 1; text-align: center; padding: 0 10px; }
        .certify-text { font-style: italic; font-size: 8px; border: none; padding: 3px 0; display: block; text-align: left; margin-bottom: 5px; }

        /* --- STYLING BARU UNTUK TANDA TANGAN --- */
        .sign-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
        
        /* RESET BORDER DEFAULT UNTUK TABEL TANDA TANGAN */
        .sign-table td {
             border: none;
             padding: 0;
             vertical-align: bottom; /* Agar konten kedorong ke bawah */
        }

        /* SEPARATOR VERTICAL (Garis tegak antar kolom) */
        /* Pilih sel ke-2 (Supervisor) dan ke-3 (Dept Head) */
        .sign-table td + td {
            border-left: 0.5pt solid black;
        }

        /* CONTAINER JUDUL (Atas) */
        .sign-title-box {
            text-align: center;
            font-weight: bold;
            padding: 5px;
            /* Tidak ada border bawah disini */
        }

        /* SPACER (Ruang Kosong buat Tanda Tangan) */
        .sign-spacer {
            height: 40px; /* Atur tinggi ruang tanda tangan disini */
        }

        /* CONTAINER NAMA (Bawah) - GARIS DI SINI */
        .sign-name-box {
            text-align: center;
            border-top: 0.5pt solid black; /* INI GARIS HORIZONTAL DI ATAS NAMA */
            padding: 2px 0 5px 0;
            margin: 0 5px; /* Sedikit jarak kiri kanan biar garis gak nempel banget sama garis vertikal */
        }

        .sign-name { text-decoration: underline; font-weight: bold; text-transform: uppercase; }
        .sign-date { font-weight: normal; margin-top: 2px; font-size: 8px; }
        
        .notes-box { border: 0.1pt solid black; width: 120px; min-height: 60px; padding: 3px; }
        
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
              <tr><td>Employee Name</td><td>:</td><td class="val-cell" style="text-transform:uppercase;">${displayName}</td></tr>
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
              <div class="certify-text">"I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD FROM <b>${periodDisplay}</b>"</div>
              
              <table class="sign-table">
                <tr>
                    <td>
                        <div class="sign-title-box">Employee</div>
                        <div class="sign-spacer"></div>
                        <div class="sign-name-box">
                            <div class="sign-name">${displayName}</div>
                            <div class="sign-date">Date: ${signDate}</div>
                        </div>
                    </td>

                    <td>
                        <div class="sign-title-box">Supervisor</div>
                        <div class="sign-spacer"></div>
                        <div class="sign-name-box">
                            <div class="sign-name">${supervisor}</div>
                            <div class="sign-date">Date: ${signDate}</div>
                        </div>
                    </td>

                    <td>
                        <div class="sign-title-box">Dept. Head</div>
                        <div class="sign-spacer"></div>
                        <div class="sign-name-box">
                            <div class="sign-name">${deptHead}</div>
                            <div class="sign-date">Date: ${signDate}</div>
                        </div>
                    </td>
                </tr>
              </table>
            </div>
            
            <div class="notes-box">
              <div style="font-weight:bold; border-bottom:0.1pt solid black; margin-bottom:3px; padding-bottom:1px;">NOTES:</div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};