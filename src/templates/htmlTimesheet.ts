import dayjs from 'dayjs';
import { Task, OvertimeTask, getBase64Image, parseDateKey } from './htmlHelpers';

export const generateTimesheetHtml = (employee: any, tasks: Task[], overtimeTasks: OvertimeTask[]) => {
  const logoPoj = getBase64Image('logo-poj.png');
  const logoPegadaian = getBase64Image('logo-pegadaian.png'); 
  
  // --- DATA PROCESSING ---
  const displayName = (employee.reportName && employee.reportName.trim() !== '') ? employee.reportName : employee.name;
  const signDate = employee.periodEnd ? dayjs(employee.periodEnd).format('DD/MM/YYYY') : '-';
  const clientSite = employee.clientSite || 'Divisi Pengembangan Aplikasi TI - PT Pegadaian';
  const workUnit = employee.workUnit || 'Dept. IT Business Analyst';
  const deptHead = employee.deptHead || 'Andhar Setiawan';
  const supervisor = employee.supervisor || 'Lailatul Fitriana R';
  const squad = employee.squad || 'Squad IT PLATFORM';
  const employeeNo = employee.no || 'POJ42050260';

  // --- DATE LOGIC ---
  let endDate = employee.periodEnd ? dayjs(employee.periodEnd) : dayjs().date(25);
  if (endDate.date() !== 25) endDate = endDate.date(25); 
  const startDate = endDate.subtract(1, 'month').date(26);
  
  const startMonthStr = startDate.format('MMMM').toUpperCase();
  const endMonthStr = endDate.format('MMMM').toUpperCase();
  const monthLabel = startMonthStr === endMonthStr ? startMonthStr : `${startMonthStr} TO ${endMonthStr}`;

  // Headers
  const headers: { date: string, label: string, isWeekend: boolean }[] = [];
  let curr = startDate.clone();
  while (curr.isBefore(endDate) || curr.isSame(endDate, 'day')) {
      headers.push({ 
          date: curr.format('YYYY-MM-DD'), 
          label: curr.format('D'), 
          isWeekend: curr.day() === 0 || curr.day() === 6 
      });
      curr = curr.add(1, 'day');
  }

  // --- MAPPING ---
  const dataMap: Record<string, { status: string, ot: number, isHoliday: boolean }> = {};
  headers.forEach(h => { dataMap[h.date] = { status: h.isWeekend ? 'W' : '8', ot: 0, isHoliday: false }; });

  tasks.forEach(t => {
      const key = parseDateKey(t.date).key;
      if (dataMap[key]) {
          const desc = (t.description || '').toUpperCase(); 
          if (desc.startsWith('[AL]') || desc.includes('CUTI') || desc.includes('ANNUAL LEAVE')) dataMap[key].status = 'AL';
          else if (desc.startsWith('[S]') || desc.includes('SAKIT') || desc.includes('SICK')) dataMap[key].status = 'S';
          else if (desc.startsWith('[H]') || desc.includes('LIBUR') || desc.includes('HOLIDAY')) { dataMap[key].status = 'H'; dataMap[key].isHoliday = true; }
          else if (desc.startsWith('[U]') || desc.includes('UNPAID')) dataMap[key].status = 'U';
          else if (desc.startsWith('[C]') || desc.includes('COMP')) dataMap[key].status = 'C';
      }
  });

  overtimeTasks.forEach(ot => {
      const key = parseDateKey(ot.date).key;
      if (dataMap[key]) dataMap[key].ot += Number(ot.duration) || 0;
  });

  // Recap
  const stats = { wh: 0, ot: 0, h: 0, al: 0, s: 0, u: 0, c: 0, totalDays: 0 };
  Object.values(dataMap).forEach(d => {
      if (d.status === '8') { stats.wh += 8; stats.totalDays++; }
      else if (d.status === 'H') stats.h++;
      else if (d.status === 'AL') stats.al++;
      else if (d.status === 'S') stats.s++;
      else if (d.status === 'U') stats.u++;
      else if (d.status === 'C') stats.c++;
      stats.ot += d.ot;
  });

  const buildRow = (code: string, label: string, type: 'status'|'ot'|'check') => {
      let cells = '';
      headers.forEach(h => {
          const item = dataMap[h.date];
          let val = '';
          let bg = h.isWeekend ? 'background:#F3F3F3;' : '';
          if (type === 'ot') val = item.ot > 0 ? String(item.ot) : '';
          else if (type === 'check') {
              if (code === 'H' && item.isHoliday) { val = 'H'; bg = 'background:#FFECEC;'; }
              else if (code === 'AL' && item.status === 'AL') val = 'AL';
              else if (code === 'S' && item.status === 'S') val = 'S';
              else if (code === 'W' && item.status === 'W') val = 'W';
              else if (code === 'U' && item.status === 'U') val = 'U';
              else if (code === 'C' && item.status === 'C') val = 'C';
          } else {
              if (item.isHoliday) val = 'H'; else if (['AL','S','U','C'].includes(item.status)) val = item.status;
              else if (item.status === 'W') val = 'W'; else val = '8';
          }
          cells += `<td class="ctr" style="${bg}">${val}</td>`;
      });
      return `<tr><td class="fw-bold ctr" style="background:#E0E0E0;">${code}</td><td style="padding-left:3px; white-space:nowrap;">${label}</td>${cells}</tr>`;
  };

  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: A4 landscape; margin: 2cm 1cm 2cm 1cm; }
        
        @media print {
          body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; width: 100%; background-color: white !important; }
          .preview-wrapper { padding: 0 !important; margin: 0 !important; background-color: white !important; display: block; width: 100%; } 
          .content-area { width: 100%; padding: 0; margin: 0; box-shadow: none !important; border: none !important; }
        }
        
        body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; background: #525659; }
        .preview-wrapper { display: flex; justify-content: center; padding: 20px; background: #525659; }
        .content-area { background: white; width: 297mm; min-height: 210mm; box-sizing: border-box; padding: 1cm; margin: 0 auto; }

        table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 10px; }
        
        th, td { border: 0.5pt solid #000000; padding: 4px 2px; vertical-align: middle; }
        th { background-color: #E0E0E0 !important; font-weight: bold; text-align: center; height: 25px; }
        
        .ctr { text-align: center; }
        .fw-bold { font-weight: bold; }
        .bg-gray { background-color: #F3F3F3 !important; }

        .header-wrap { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: none; padding-bottom: 5px; margin-bottom: 12px; }
        
        /* STYLE INFO TABLE (KEMBALI KE GAYA MANDAYS) */
        .info-tbl td { border: none !important; padding: 2px 0 !important; }
        
        /* BORDER LANGSUNG DI CELL (SAMA KY MANDAYS) TAPI HITAM PEKAT */
        .info-tbl td.val-cell { 
            border-bottom: 0.5pt solid #000000 !important; 
            font-weight: bold; 
            padding-left: 5px !important;
        }

        .footer-section { display: flex; justify-content: space-between; margin-top: 20px; align-items: flex-start; }
        
        .recap-tbl { width: auto; margin-right: 20px; } 
        .recap-tbl td { text-align: center; padding: 2px 8px; border: 0.5pt solid #000000; }
        .recap-label { font-weight: bold; }

        .sign-area { flex: 1; text-align: center; padding: 0 10px; }
        .certify-text { font-style: italic; font-size: 8px; border: none; padding: 3px 0; display: block; text-align: left; margin-bottom: 5px; }
        
        .sign-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
        .sign-table td { border: none; padding: 0; vertical-align: bottom; }
        .sign-table td + td { border-left: 0.5pt solid #000000; }
        
        .sign-title-box { text-align: center; font-weight: bold; padding: 5px; }
        .sign-spacer { height: 40px; }
        .sign-name-box { text-align: center; border-top: 0.5pt solid #000000; padding: 2px 0 5px 0; margin: 0 5px; }
        .sign-name { text-decoration: underline; font-weight: bold; text-transform: uppercase; }
        .sign-date { font-weight: normal; margin-top: 2px; font-size: 8px; }
        
        .notes-box { border: 0.5pt solid #000000; width: 120px; min-height: 60px; padding: 3px; }
        .grid-header td { font-weight:bold; background-color:#E0E0E0; text-align:center; border: 0.5pt solid #000000; }
      </style>
    </head>
    <body>
      <div class="preview-wrapper">
        <div class="content-area">
          
          <div class="header-wrap">
            <div style="width: 20%;">${logoPegadaian ? `<img src="${logoPegadaian}" style="max-height:40px;">` : ''}</div>
            <div style="text-align: center; flex: 1;">
              <h1 style="font-size:18px; margin:0; font-weight:900;">REKAPITULASI PERHITUNGAN LEMBAR KERJA</h1>
              <h2 style="font-size:12px; margin:2px 0 0 0;">PT Pesonna Optima Jasa</h2>
            </div>
            <div style="width: 20%; text-align: right;">${logoPoj ? `<img src="${logoPoj}" style="max-height:40px;">` : ''}</div>
          </div>

          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <table class="info-tbl" style="width: 350px;">
              <tr><td width="70">Client Site</td><td width="2">:</td><td class="val-cell">${clientSite}</td></tr>
              <tr><td>Work Unit</td><td>:</td><td class="val-cell">${workUnit}</td></tr>
              <tr><td>Dept. Head Name</td><td>:</td><td class="val-cell">${deptHead}</td></tr>
              <tr><td>Supervisor</td><td>:</td><td class="val-cell">${supervisor}</td></tr>
            </table>
            <table class="info-tbl" style="width: 350px;">
              <tr><td width="70">Squad</td><td width="2">:</td><td class="val-cell">${squad}</td></tr>
              <tr><td>Employee Name</td><td>:</td><td class="val-cell" style="text-transform:uppercase;">${displayName}</td></tr>
              <tr><td>Employee No.</td><td>:</td><td class="val-cell">${employeeNo}</td></tr>
              <tr><td>Month</td><td>:</td><td class="val-cell" style="color:#00529C">${monthLabel}</td></tr>
            </table>
          </div>

          <table>
            <thead>
                <tr class="grid-header">
                    <td width="30">Code</td><td width="100">Category</td>
                    ${headers.map(h => `<td>${h.label}</td>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${buildRow('WH', 'Work Hours', 'status')}
                ${buildRow('OT', 'Over Time', 'ot')}
                ${buildRow('H', '- Holidays', 'check')}
                ${buildRow('AL', '- Annual Leave', 'check')}
                ${buildRow('S', 'Sick Leave', 'check')}
                ${buildRow('U', 'Unpaid Leave', 'check')}
                ${buildRow('C', 'Comp. Off', 'check')}
                ${buildRow('W', '- Weekend', 'check')}
                <tr style="font-weight:bold;">
                    <td colspan="2" style="text-align:right; padding-right:5px;">Total</td>
                    ${headers.map(h => {
                       const d = dataMap[h.date];
                       let val = 0;
                       if (d.status === '8') val += 8;
                       val += d.ot;
                       return `<td class="ctr" style="${h.isWeekend?'background:#F3F3F3':''}">${val > 0 ? val : ''}</td>`;
                    }).join('')}
                </tr>
            </tbody>
          </table>

          <div class="footer-section">
            <table class="recap-tbl">
              <thead><tr style="background:#E0E0E0; font-weight:bold;"><td colspan="2">RECAP</td><td width="40">Hours</td><td width="40">Days</td></tr></thead>
              <tbody>
                <tr><td class="recap-label">WH</td><td style="text-align:left;">Work Hours</td><td class="ctr">${stats.wh}</td><td class="ctr">${stats.totalDays}</td></tr>
                <tr><td class="recap-label">OT</td><td style="text-align:left;">Over Time</td><td class="ctr">${stats.ot}</td><td class="ctr">-</td></tr>
                <tr><td class="recap-label">AL</td><td style="text-align:left;">Annual Leave</td><td class="ctr">-</td><td class="ctr">${stats.al}</td></tr>
                <tr><td class="recap-label">S</td><td style="text-align:left;">Sick Leave</td><td class="ctr">-</td><td class="ctr">${stats.s}</td></tr>
                <tr><td class="recap-label">H</td><td style="text-align:left;">Holiday</td><td class="ctr">-</td><td class="ctr">${stats.h}</td></tr>
                <tr><td class="recap-label">U</td><td style="text-align:left;">Unpaid Leave</td><td class="ctr">-</td><td class="ctr">${stats.u}</td></tr>
                <tr><td class="recap-label">C</td><td style="text-align:left;">Comp. Off</td><td class="ctr">-</td><td class="ctr">${stats.c}</td></tr>
                <tr class="bg-gray" style="font-weight:bold;"><td colspan="2" style="text-align:center;">Total</td><td class="ctr">${stats.wh + stats.ot}</td><td class="ctr">${stats.totalDays + stats.al + stats.s + stats.h + stats.u + stats.c}</td></tr>
              </tbody>
            </table>

            <div class="sign-area">
              <div class="certify-text">"I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD FROM <b>${monthLabel}</b>"</div>
              <table class="sign-table">
                <tr>
                    <td><div class="sign-title-box">Employee</div><div class="sign-spacer"></div><div class="sign-name-box"><div class="sign-name">${displayName}</div><div class="sign-date">Date: ${signDate}</div></div></td>
                    <td><div class="sign-title-box">Supervisor</div><div class="sign-spacer"></div><div class="sign-name-box"><div class="sign-name">${supervisor}</div><div class="sign-date">Date: ${signDate}</div></div></td>
                    <td><div class="sign-title-box">Dept. Head</div><div class="sign-spacer"></div><div class="sign-name-box"><div class="sign-name">${deptHead}</div><div class="sign-date">Date: ${signDate}</div></div></td>
                </tr>
              </table>
            </div>
            
            <div class="notes-box">
              <div style="font-weight:bold; border-bottom:0.5pt solid #000000; margin-bottom:3px; padding-bottom:1px;">NOTES:</div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};