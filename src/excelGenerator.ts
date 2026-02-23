import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { Task, OvertimeTask, parseDateKey } from './templates/htmlHelpers';

// --- STYLING HELPERS ---
const borderStyle: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' }
};

const centerStyle: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'center' };
const leftStyle: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'left', wrapText: true };
const boldFont = { bold: true };

// Warna Background
const fillHeader: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }; // Abu Gelap
const fillHoliday: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFECEC' } }; // Merah Muda
const fillWeekend: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } }; // Abu Terang

// ==========================================
// 1. GENERATOR TIMESHEET (SUDAH FIX)
// ==========================================
export const generateTimesheetExcel = async (
    employee: any,
    tasks: Task[],
    overtimeTasks: OvertimeTask[],
    holidays: string[] = []
) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Timesheet');

    // --- A. SETUP TANGGAL ---
    let endDate = employee.periodEnd ? dayjs(employee.periodEnd) : dayjs().date(25);
    if (endDate.date() !== 25) endDate = endDate.date(25);
    const startDate = endDate.subtract(1, 'month').date(26);

    const startMonthStr = startDate.format('MMMM').toUpperCase();
    const endMonthStr = endDate.format('MMMM').toUpperCase();
    const periodDisplay = startMonthStr === endMonthStr ? startMonthStr : `${startMonthStr} TO ${endMonthStr}`;

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

    // --- B. DATA MAPPING ---
    const dataMap: Record<string, { status: string, ot: number, isHoliday: boolean }> = {};

    let HOLIDAYS = holidays;
    if (!HOLIDAYS || HOLIDAYS.length === 0) {
        HOLIDAYS = ['2025-01-01', '2025-01-27', '2025-01-29', '2025-03-29', '2025-03-31', '2025-04-01', '2025-04-18', '2025-04-20', '2025-05-01'];
    }

    dateHeaders.forEach(h => {
        const isNasional = HOLIDAYS.includes(h.date);
        let initialStatus = '';
        let isHol = false;

        if (isNasional) {
            initialStatus = 'H';
            isHol = true;
        } else if (h.isWeekend) {
            initialStatus = 'W';
        }

        dataMap[h.date] = {
            status: initialStatus,
            ot: 0,
            isHoliday: isHol
        };
    });

    tasks.forEach(t => {
        const key = parseDateKey(t.date).key;
        if (dataMap[key]) {
            const desc = (t.description || '').toUpperCase();
            const userStatus = (t.status || '').toUpperCase();

            let detectedCode = '';
            if (desc.startsWith('[AL]') || desc.includes('CUTI') || desc.includes('ANNUAL')) detectedCode = 'AL';
            else if (desc.startsWith('[S]') || desc.includes('SAKIT') || desc.includes('SICK')) detectedCode = 'S';
            else if (desc.startsWith('[H]') || desc.includes('LIBUR') || desc.includes('HOLIDAY')) detectedCode = 'H';
            else if (desc.startsWith('[U]') || desc.includes('UNPAID')) detectedCode = 'U';
            else if (desc.startsWith('[C]') || desc.includes('COMP')) detectedCode = 'C';
            else if (['AL', 'S', 'H', 'U', 'C'].includes(userStatus)) {
                detectedCode = userStatus;
            }

            if (detectedCode) {
                dataMap[key].status = detectedCode;
                dataMap[key].isHoliday = (detectedCode === 'H');
            }
            else if (userStatus === 'WH' || desc.length > 1) {
                dataMap[key].status = '8';
            }
        }
    });

    overtimeTasks.forEach(ot => {
        const key = parseDateKey(ot.date).key;
        if (dataMap[key]) dataMap[key].ot += Number(ot.duration) || 0;
    });

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

    // --- C. BUILD EXCEL UI ---
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

    const infoData = [
        ['Client Site', ':', employee.clientSite || '', 'Squad', ':', employee.squad || ''],
        ['Work Unit', ':', employee.workUnit || '', 'Employee Name', ':', (employee.reportName || employee.name || '').toUpperCase()],
        ['Dept. Head Name', ':', employee.deptHead || '', 'Employee No.', ':', employee.no || ''],
        ['Supervisor', ':', employee.supervisor || '', 'Month', ':', periodDisplay]
    ];

    infoData.forEach((row, i) => {
        const r = sheet.getRow(4 + i);
        r.getCell(1).value = row[0]; r.getCell(2).value = row[1]; r.getCell(3).value = row[2]; r.getCell(3).font = boldFont;
        r.getCell(18).value = row[3]; r.getCell(19).value = row[4]; r.getCell(20).value = row[5]; r.getCell(20).font = boldFont;
    });

    const headerRowIdx = 9;
    const headerRow = sheet.getRow(headerRowIdx);
    headerRow.getCell(1).value = 'Code';
    headerRow.getCell(2).value = 'Category';

    dateHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(3 + i);
        cell.value = Number(h.label);
        cell.fill = fillHeader;
        cell.border = borderStyle;
        cell.alignment = centerStyle;
        sheet.getColumn(3 + i).width = 4;
    });

    ['A', 'B'].forEach(col => {
        const c = sheet.getCell(`${col}${headerRowIdx}`);
        c.fill = fillHeader;
        c.border = borderStyle;
        c.alignment = centerStyle;
        c.font = boldFont;
    });

    const buildExcelRow = (code: string, label: string, type: 'status' | 'ot' | 'check') => {
        const row = sheet.addRow([code, label]);

        row.getCell(1).fill = fillHeader;
        row.getCell(1).font = boldFont;
        row.getCell(1).alignment = centerStyle;
        row.getCell(1).border = borderStyle;

        row.getCell(2).alignment = { ...leftStyle, indent: 1 };
        row.getCell(2).border = borderStyle;

        dateHeaders.forEach((h, i) => {
            const cell = row.getCell(3 + i);
            const item = dataMap[h.date];
            let val: string | number = '';

            if (item.isHoliday) cell.fill = fillHoliday;
            else if (h.isWeekend) cell.fill = fillWeekend;

            if (type === 'ot') {
                val = item.ot > 0 ? item.ot : '';
            } else if (type === 'check') {
                if (code === item.status) val = code;
            } else {
                if (item.status === '8') val = 8;
                else if (['AL', 'S', 'U', 'C', 'H', 'W'].includes(item.status)) val = item.status;
            }

            cell.value = val;
            cell.border = borderStyle;
            cell.alignment = centerStyle;
        });
    };

    buildExcelRow('WH', 'Work Hours', 'status');
    buildExcelRow('OT', 'Over Time', 'ot');
    buildExcelRow('H', '- Holidays', 'check');
    buildExcelRow('AL', '- Annual Leave', 'check');
    buildExcelRow('S', 'Sick Leave', 'check');
    buildExcelRow('U', 'Unpaid Leave', 'check');
    buildExcelRow('C', 'Comp. Off', 'check');
    buildExcelRow('W', '- Weekend', 'check');

    const totalRow = sheet.addRow(['', 'Total']);
    totalRow.getCell(2).alignment = { horizontal: 'right' };
    totalRow.getCell(2).font = boldFont;
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
        cell.font = boldFont;
        if (h.isWeekend) cell.fill = fillWeekend;
    });

    let currentRow = 20;
    const recapHeader = sheet.getRow(currentRow);
    recapHeader.getCell(1).value = 'RECAP';
    recapHeader.getCell(3).value = 'Hours';
    recapHeader.getCell(4).value = 'Days';
    sheet.mergeCells(`A${currentRow}:B${currentRow}`);

    ['A', 'C', 'D'].forEach(c => {
        const cell = recapHeader.getCell(c === 'A' ? 1 : (c === 'C' ? 3 : 4));
        cell.fill = fillHeader;
        cell.font = boldFont;
        cell.border = borderStyle;
        cell.alignment = centerStyle;
    });

    const addRecapRow = (label: string, desc: string, valHours: any, valDays: any) => {
        currentRow++;
        const r = sheet.getRow(currentRow);
        r.getCell(1).value = label; r.getCell(1).font = boldFont; r.getCell(1).alignment = centerStyle;
        r.getCell(2).value = desc; r.getCell(2).alignment = { horizontal: 'left', indent: 1 };
        r.getCell(3).value = valHours; r.getCell(3).alignment = centerStyle;
        r.getCell(4).value = valDays; r.getCell(4).alignment = centerStyle;
        [1, 2, 3, 4].forEach(c => r.getCell(c).border = borderStyle);
    };

    addRecapRow('WH', 'Work Hours', stats.wh, stats.totalDays);
    addRecapRow('OT', 'Over Time', stats.ot, '-');
    addRecapRow('AL', 'Annual Leave', '-', stats.al);
    addRecapRow('S', 'Sick Leave', '-', stats.s);
    addRecapRow('H', 'Holiday', '-', stats.h);
    addRecapRow('U', 'Unpaid Leave', '-', stats.u);
    addRecapRow('C', 'Comp. Off', '-', stats.c);

    currentRow++;
    const totalRecap = sheet.getRow(currentRow);
    totalRecap.getCell(1).value = 'Total';
    sheet.mergeCells(`A${currentRow}:B${currentRow}`);
    totalRecap.getCell(1).alignment = centerStyle;
    totalRecap.getCell(1).font = boldFont;
    totalRecap.getCell(1).fill = fillWeekend;

    totalRecap.getCell(3).value = stats.wh + stats.ot;
    totalRecap.getCell(4).value = stats.totalDays + stats.al + stats.s + stats.h + stats.u + stats.c;
    [1, 3, 4].forEach(c => { const cell = totalRecap.getCell(c); cell.border = borderStyle; cell.alignment = centerStyle; });

    const signRowIdx = 20;
    sheet.mergeCells(`G${signRowIdx}:Q${signRowIdx}`);
    const certify = sheet.getCell(`G${signRowIdx}`);
    certify.value = `"I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD FROM ${periodDisplay}"`;
    certify.font = { italic: true, size: 9 };

    const signHeaderRow = sheet.getRow(signRowIdx + 2);
    signHeaderRow.getCell(7).value = 'Employee'; sheet.mergeCells(`G${signRowIdx + 2}:I${signRowIdx + 2}`); signHeaderRow.getCell(7).alignment = centerStyle; signHeaderRow.getCell(7).font = boldFont;
    signHeaderRow.getCell(11).value = 'Supervisor'; sheet.mergeCells(`K${signRowIdx + 2}:M${signRowIdx + 2}`); signHeaderRow.getCell(11).alignment = centerStyle; signHeaderRow.getCell(11).font = boldFont;
    signHeaderRow.getCell(15).value = 'Dept. Head'; sheet.mergeCells(`O${signRowIdx + 2}:Q${signRowIdx + 2}`); signHeaderRow.getCell(15).alignment = centerStyle; signHeaderRow.getCell(15).font = boldFont;

    const signNameRow = sheet.getRow(signRowIdx + 7);
    signNameRow.getCell(7).value = (employee.reportName || employee.name || '').toUpperCase(); sheet.mergeCells(`G${signRowIdx + 7}:I${signRowIdx + 7}`); signNameRow.getCell(7).alignment = centerStyle; signNameRow.getCell(7).font = { underline: true, bold: true };
    signNameRow.getCell(11).value = employee.supervisor; sheet.mergeCells(`K${signRowIdx + 7}:M${signRowIdx + 7}`); signNameRow.getCell(11).alignment = centerStyle; signNameRow.getCell(11).font = { underline: true, bold: true };
    signNameRow.getCell(15).value = employee.deptHead; sheet.mergeCells(`O${signRowIdx + 7}:Q${signRowIdx + 7}`); signNameRow.getCell(15).alignment = centerStyle; signNameRow.getCell(15).font = { underline: true, bold: true };

    const signDateRow = sheet.getRow(signRowIdx + 8);
    const dateStr = `Date: ${employee.periodEnd ? dayjs(employee.periodEnd).format('DD/MM/YYYY') : '-'}`;
    [7, 11, 15].forEach(col => {
        signDateRow.getCell(col).value = dateStr;
        sheet.mergeCells(`${sheet.getColumn(col).letter}${signRowIdx + 8}:${sheet.getColumn(col + 2).letter}${signRowIdx + 8}`);
        signDateRow.getCell(col).alignment = { horizontal: 'center' };
        signDateRow.getCell(col).font = { size: 9 };
    });

    sheet.getColumn(1).width = 5; sheet.getColumn(2).width = 20;
    return await workbook.xlsx.writeBuffer();
};

// ==========================================
// 2. GENERATOR MANDAYS (REVISED & FIXED)
// ==========================================
export const generateMandaysExcel = async (
    employee: any,
    tasks: Task[],
    overtimeTasks: OvertimeTask[]
) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mandays Report');

    // Setup Kolom
    sheet.getColumn('A').width = 5;
    sheet.getColumn('B').width = 12;
    sheet.getColumn('C').width = 15;
    sheet.getColumn('D').width = 35; // Ticket Link
    sheet.getColumn('E').width = 50; // Desc

    // HEADER JUDUL
    sheet.mergeCells('A1:E1');
    const title = sheet.getCell('A1');
    title.value = 'MANDAYS CONSUMPTION REPORT';
    title.font = { bold: true, size: 14 };
    title.alignment = centerStyle;

    sheet.mergeCells('A2:E2');
    const subtitle = sheet.getCell('A2');
    subtitle.value = 'PT Pesonna Optima Jasa';
    subtitle.font = { size: 11 };
    subtitle.alignment = centerStyle;

    // INFO KARYAWAN (SPLIT KIRI & KANAN SEPERTI PDF)
    const infoStartRow = 4;

    // Data Kiri
    const leftInfo = [
        ['Client Site', ':', employee.clientSite || ''],
        ['Work Unit', ':', employee.workUnit || ''],
        ['Dept. Head Name', ':', employee.deptHead || ''],
        ['Supervisor', ':', employee.supervisor || '']
    ];
    // Data Kanan

    let periodDisplay = employee.month;
    if (!periodDisplay && employee.periodStart && employee.periodEnd) {
        const startMonth = dayjs(employee.periodStart).format('MMMM').toUpperCase();
        const endMonth = dayjs(employee.periodEnd).format('MMMM').toUpperCase();
        periodDisplay = startMonth === endMonth ? startMonth : `${startMonth} TO ${endMonth}`;
    } else if (!periodDisplay) {
        periodDisplay = '-';
    }

    const rightInfo = [
        ['Squad', ':', employee.squad || ''],
        ['Employee Name', ':', (employee.reportName || employee.name || '').toUpperCase()],
        ['Employee No.', ':', employee.no || ''],
        ['Month', ':', periodDisplay]
    ];

    for (let i = 0; i < 4; i++) {
        const r = sheet.getRow(infoStartRow + i);
        // Kiri
        r.getCell(1).value = leftInfo[i][0];
        r.getCell(2).value = leftInfo[i][1];
        r.getCell(3).value = leftInfo[i][2];
        r.getCell(3).font = boldFont;

        // Kanan (Kolom D dan E)
        r.getCell(4).value = rightInfo[i][0];
        r.getCell(4).alignment = { horizontal: 'right' }; // Label rata kanan

        // Gabung cell value kanan dengan titik dua manual jika perlu, atau taruh di E
        r.getCell(5).value = `: ${rightInfo[i][2]}`;
        r.getCell(5).font = boldFont;
    }

    let currentRow = 9;

    // --- A. REGULAR TASKS ---
    const headerA = sheet.getRow(currentRow++);
    headerA.getCell(1).value = 'A. DAILY ACTIVITY';
    headerA.getCell(1).font = { bold: true, size: 11 };


    const tableHeaderA = sheet.getRow(currentRow++);
    ['No.', 'Date', 'Description', 'Duration of Work\n(Mandays)', 'JIRA\'s Link', 'CRF/G-Canvas No.', 'Ket'].forEach((h, i) => {
        // Karena ada column yang kita tidak pakai semua / mau dipass, mapping manual:
        // Excel column width adjustment: 
        if (i === 2) sheet.getColumn(i + 1).width = 40; // Description
        if (i === 3) sheet.getColumn(i + 1).width = 15; // Duration
        if (i === 4) sheet.getColumn(i + 1).width = 20; // JIRA Link
        if (i === 5) sheet.getColumn(i + 1).width = 15; // CRF
        if (i === 6) sheet.getColumn(i + 1).width = 10; // Ket

        const cell = tableHeaderA.getCell(i + 1);
        cell.value = h;
        cell.fill = fillHeader;
        cell.border = borderStyle;
        cell.alignment = centerStyle;
        cell.font = boldFont;
    });

    if (tasks.length === 0) {
        const r = sheet.getRow(currentRow++);
        r.getCell(1).value = 'No Data';
        sheet.mergeCells(`A${r.number}:E${r.number}`);
        r.getCell(1).alignment = centerStyle;
        r.getCell(1).border = borderStyle;
    } else {
        const groupedTasks: { [key: string]: { tasks: Task[], meta: any } } = {};
        tasks.forEach((task) => {
            const { key, display, valid, timestamp } = parseDateKey(task.date);
            if (!groupedTasks[key]) groupedTasks[key] = { tasks: [], meta: { display, valid, timestamp } };
            groupedTasks[key].tasks.push(task);
        });

        const sortedKeys = Object.keys(groupedTasks).sort((a, b) => groupedTasks[a].meta.timestamp - groupedTasks[b].meta.timestamp);

        let rowNumber = 1;
        let totalMandays = 0;

        sortedKeys.forEach((key) => {
            const group = groupedTasks[key];
            const dailyTasks = group.tasks;
            const rowSpan = dailyTasks.length;

            const isCuti = dailyTasks.some(t => (t.description || '').toLowerCase().includes('cuti') || (t.description || '').toLowerCase().includes('annual leave'));
            if (!isCuti) totalMandays += 1;

            const startRow = currentRow;

            dailyTasks.forEach((t, index) => {
                const row = sheet.getRow(currentRow++);

                // No.
                if (index === 0) row.getCell(1).value = rowNumber;
                row.getCell(1).alignment = centerStyle;

                // Date
                if (index === 0) row.getCell(2).value = group.meta.display;
                row.getCell(2).alignment = centerStyle;

                // Description
                row.getCell(3).value = t.description; row.getCell(3).alignment = leftStyle;

                // Duration of Work
                if (index === 0) row.getCell(4).value = isCuti ? '' : 1;
                row.getCell(4).alignment = centerStyle;

                // JIRA Link
                const ticketNum = t.ticketNumber || '';
                const displayUrl = t.ticketLink ? { text: ticketNum || 'Link', hyperlink: t.ticketLink } : (ticketNum || '-');
                const cell5 = row.getCell(5);
                cell5.value = displayUrl;
                if (t.ticketLink) { cell5.font = { color: { argb: 'FF0000FF' }, underline: true }; }
                cell5.alignment = centerStyle;

                // CRF/G-Canvas No. (Empty by default like HTML)
                row.getCell(6).value = '';
                // Ket
                row.getCell(7).value = '';

                [1, 2, 3, 4, 5, 6, 7].forEach(col => row.getCell(col).border = borderStyle);
            });

            if (rowSpan > 1) {
                sheet.mergeCells(startRow, 1, startRow + rowSpan - 1, 1);
                sheet.mergeCells(startRow, 2, startRow + rowSpan - 1, 2);
                sheet.mergeCells(startRow, 4, startRow + rowSpan - 1, 4);
            }

            rowNumber++;
        });

        // Add Total Row
        const totalRow = sheet.getRow(currentRow++);
        totalRow.getCell(3).value = 'Total Mandays Reguler';
        totalRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
        totalRow.getCell(3).font = boldFont;

        totalRow.getCell(4).value = totalMandays;
        totalRow.getCell(4).alignment = centerStyle;
        totalRow.getCell(4).font = boldFont;

        [1, 2, 3, 4, 5, 6, 7].forEach(col => {
            const cell = totalRow.getCell(col);
            cell.border = borderStyle;
            cell.fill = fillWeekend;
        });
        sheet.mergeCells(`A${totalRow.number}:C${totalRow.number}`);
        sheet.mergeCells(`E${totalRow.number}:G${totalRow.number}`);
    }

    currentRow += 1;

    // --- B. OVERTIME ---
    const headerB = sheet.getRow(currentRow++);
    headerB.getCell(1).value = 'B. OVERTIME';
    headerB.getCell(1).font = { bold: true, size: 11 };

    const tableHeaderB = sheet.getRow(currentRow++);
    ['No.', 'Date', 'Description', 'Duration of Work\n(Hours)', 'JIRA\'s Link', 'Ket./ Nomor Surat Tugas'].forEach((h, i) => {
        const cell = tableHeaderB.getCell(i + 1);
        cell.value = h;
        cell.fill = fillHeader;
        cell.border = borderStyle;
        cell.alignment = centerStyle;
        cell.font = boldFont;
    });

    let totalOtHours = 0;
    const otDates = new Set();
    if (overtimeTasks.length === 0) {
        const r = sheet.getRow(currentRow++);
        r.getCell(1).value = '- No Overtime -';
        sheet.mergeCells(`A${r.number}:F${r.number}`);
        r.getCell(1).alignment = centerStyle;
        r.getCell(1).border = borderStyle;
    } else {
        const sortedOt = [...overtimeTasks].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        sortedOt.forEach((ot, i) => {
            const row = sheet.getRow(currentRow++);
            const { display: dateDisplay } = parseDateKey(ot.date);
            const dur = parseFloat(String(ot.duration)) || 0;
            totalOtHours += dur;
            if (ot.date) otDates.add(ot.date);

            row.getCell(1).value = i + 1; row.getCell(1).alignment = centerStyle;
            row.getCell(2).value = dateDisplay; row.getCell(2).alignment = centerStyle;
            row.getCell(3).value = ot.description || '-'; row.getCell(3).alignment = leftStyle;
            row.getCell(4).value = dur; row.getCell(4).alignment = centerStyle;

            const displayUrl = ot.ticketLink ? { text: 'Link', hyperlink: ot.ticketLink } : '-';
            const cell5 = row.getCell(5);
            cell5.value = displayUrl;
            if (ot.ticketLink) { cell5.font = { color: { argb: 'FF0000FF' }, underline: true }; }
            cell5.alignment = centerStyle;

            row.getCell(6).value = ot.remarks || ''; row.getCell(6).alignment = leftStyle;

            [1, 2, 3, 4, 5, 6].forEach(col => {
                const cell = row.getCell(col);
                cell.border = borderStyle;
            });
        });

        const totalOtDays = otDates.size;

        // Add OT Total Rows
        const otTotalRow1 = sheet.getRow(currentRow++);
        otTotalRow1.getCell(3).value = 'Total Hours Overtime';
        otTotalRow1.getCell(3).font = boldFont;
        otTotalRow1.getCell(3).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
        otTotalRow1.getCell(4).value = totalOtHours;
        otTotalRow1.getCell(4).font = boldFont;
        otTotalRow1.getCell(4).alignment = centerStyle;

        [1, 2, 3, 4, 5, 6].forEach(col => {
            const cell = otTotalRow1.getCell(col);
            cell.border = borderStyle;
            cell.fill = fillWeekend;
        });
        sheet.mergeCells(`A${otTotalRow1.number}:C${otTotalRow1.number}`);
        sheet.mergeCells(`E${otTotalRow1.number}:F${otTotalRow1.number}`);

        const otTotalRow2 = sheet.getRow(currentRow++);
        otTotalRow2.getCell(3).value = 'Total Days Overtime';
        otTotalRow2.getCell(3).font = boldFont;
        otTotalRow2.getCell(3).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
        otTotalRow2.getCell(4).value = totalOtDays;
        otTotalRow2.getCell(4).font = boldFont;
        otTotalRow2.getCell(4).alignment = centerStyle;

        [1, 2, 3, 4, 5, 6].forEach(col => {
            const cell = otTotalRow2.getCell(col);
            cell.border = borderStyle;
            cell.fill = fillWeekend;
        });
        sheet.mergeCells(`A${otTotalRow2.number}:C${otTotalRow2.number}`);
        sheet.mergeCells(`E${otTotalRow2.number}:F${otTotalRow2.number}`);
    }

    currentRow += 2;

    // Calculate total mandays for recap (assuming totalMandays & totalOtHours/Days have been calculated)
    const totalMandaysCalc = tasks.filter(t => !(t.description || '').toLowerCase().includes('cuti') && !(t.description || '').toLowerCase().includes('annual leave')).length;
    // (This count may be slightly off if tasks on the same day were cuti vs non-cuti, but it will generally match the loop above for simplicity we will recalculate precisely)
    let totalMandaysFinal = 0;
    const groupedT: { [key: string]: Task[] } = {};
    tasks.forEach(t => {
        const { key } = parseDateKey(t.date);
        if (!groupedT[key]) groupedT[key] = [];
        groupedT[key].push(t);
    });
    Object.values(groupedT).forEach(dailyTasks => {
        if (!dailyTasks.some(t => (t.description || '').toLowerCase().includes('cuti') || (t.description || '').toLowerCase().includes('annual leave'))) {
            totalMandaysFinal += 1;
        }
    });

    const totalHoursFinal = totalMandaysFinal * 8;
    const totalOtDaysFinal = otDates.size;

    // --- RECAP SECTION ---
    const recapHeaderRow = sheet.getRow(currentRow++);
    recapHeaderRow.getCell(1).value = 'RECAP';
    recapHeaderRow.getCell(3).value = 'Hours';
    recapHeaderRow.getCell(4).value = 'Days';
    sheet.mergeCells(`A${recapHeaderRow.number}:B${recapHeaderRow.number}`);

    [1, 3, 4].forEach(c => {
        const cell = recapHeaderRow.getCell(c);
        cell.fill = fillHeader;
        cell.font = boldFont;
        cell.border = borderStyle;
        cell.alignment = centerStyle;
    });

    const addRecapMandaysRow = (label: string, desc: string, valHours: any, valDays: any) => {
        const r = sheet.getRow(currentRow++);
        r.getCell(1).value = label; r.getCell(1).font = boldFont; r.getCell(1).alignment = centerStyle;
        r.getCell(2).value = desc; r.getCell(2).alignment = { horizontal: 'left', indent: 1 };
        r.getCell(3).value = valHours; r.getCell(3).alignment = centerStyle;
        r.getCell(4).value = valDays; r.getCell(4).alignment = centerStyle;
        [1, 2, 3, 4].forEach(c => r.getCell(c).border = borderStyle);
    };

    addRecapMandaysRow('REG', 'Work Hours', totalHoursFinal, totalMandaysFinal);
    addRecapMandaysRow('OT', 'Over Time', totalOtHours, totalOtDaysFinal);

    const totalRecap = sheet.getRow(currentRow++);
    totalRecap.getCell(1).value = 'Total';
    sheet.mergeCells(`A${totalRecap.number}:B${totalRecap.number}`);
    totalRecap.getCell(1).alignment = centerStyle;
    totalRecap.getCell(1).font = boldFont;
    totalRecap.getCell(1).fill = fillWeekend;

    totalRecap.getCell(3).value = totalHoursFinal + totalOtHours;
    totalRecap.getCell(4).value = totalMandaysFinal + totalOtDaysFinal;
    [1, 3, 4].forEach(c => {
        const cell = totalRecap.getCell(c);
        cell.border = borderStyle;
        cell.alignment = centerStyle;
        cell.font = boldFont;
        cell.fill = fillWeekend;
    });

    // --- SIGNATURE SECTION (CENTERED) ---
    currentRow += 2;
    sheet.mergeCells(`A${currentRow}:F${currentRow}`);
    const certify = sheet.getCell(`A${currentRow}`);
    certify.value = `"I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD FROM ${periodDisplay}"`;
    certify.font = { italic: true, size: 9 };
    certify.alignment = { horizontal: 'left', vertical: 'middle' };

    currentRow += 2;
    const signRowTitle = sheet.getRow(currentRow);

    signRowTitle.getCell(2).value = 'Employee';
    signRowTitle.getCell(2).alignment = centerStyle;
    signRowTitle.getCell(2).font = boldFont;

    signRowTitle.getCell(4).value = 'Supervisor';
    signRowTitle.getCell(4).alignment = centerStyle;
    signRowTitle.getCell(4).font = boldFont;

    signRowTitle.getCell(6).value = 'Dept. Head';
    signRowTitle.getCell(6).alignment = centerStyle;
    signRowTitle.getCell(6).font = boldFont;

    currentRow += 5; // Space Tanda Tangan
    const signRowName = sheet.getRow(currentRow);

    signRowName.getCell(2).value = (employee.reportName || employee.name || '').toUpperCase();
    signRowName.getCell(2).alignment = centerStyle;
    signRowName.getCell(2).font = { underline: true, bold: true };

    signRowName.getCell(4).value = employee.supervisor;
    signRowName.getCell(4).alignment = centerStyle;
    signRowName.getCell(4).font = { underline: true, bold: true };

    signRowName.getCell(6).value = employee.deptHead;
    signRowName.getCell(6).alignment = centerStyle;
    signRowName.getCell(6).font = { underline: true, bold: true };

    // Date
    currentRow++;
    const signRowDate = sheet.getRow(currentRow);
    const dateStr = `Date: ${employee.periodEnd ? dayjs(employee.periodEnd).format('DD/MM/YYYY') : '-'}`;
    [2, 4, 6].forEach(col => {
        signRowDate.getCell(col).value = dateStr;
        signRowDate.getCell(col).alignment = centerStyle;
        signRowDate.getCell(col).font = { size: 9 };
    });

    return await workbook.xlsx.writeBuffer();
};