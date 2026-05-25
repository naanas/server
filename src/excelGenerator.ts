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
const fillHeader: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA6A6A6' } }; // Darker Gray per image
const fillHoliday: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; // Pinkish Red
const fillWeekend: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }; // Gray
const fillWeekendLight: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } }; // Lighter Gray


// ==========================================
// 1. GENERATOR TIMESHEET (SUDAH FIX - IMAGE ALIGNMENT)
// ==========================================
export const generateTimesheetExcel = async (
    employee: any,
    tasks: Task[],
    overtimeTasks: OvertimeTask[],
    holidays: string[] = []
) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Timesheet', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
    });

    // --- A. SETUP TANGGAL ---
    let endDate = employee.periodEnd ? dayjs(employee.periodEnd) : dayjs().date(25);
    if (endDate.date() !== 25) endDate = endDate.date(25);
    const startDate = endDate.subtract(1, 'month').date(26);

    const startMonthStr = startDate.format('MMMM').toUpperCase();
    const endMonthStr = endDate.format('MMMM').toUpperCase();
    const periodDisplay = startMonthStr === endMonthStr ? startMonthStr : `${startMonthStr}     TO     ${endMonthStr}`;

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

    // --- B. SETUP COLUMNS (A for code, B for Label, C for dates...) ---
    sheet.getColumn(1).width = 4; // A (Code)
    sheet.getColumn(2).width = 16; // B (Label)
    // Date columns
    dateHeaders.forEach((_, i) => sheet.getColumn(3 + i).width = 3.5);

    // --- C. DATA MAPPING ---
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
    Object.values(dataMap).forEach((d: { status: string, ot: number, isHoliday: boolean }) => {
        if (d.status === '8') { stats.wh += 8; stats.totalDays++; }
        else if (d.status === 'H') stats.h++;
        else if (d.status === 'AL') stats.al++;
        else if (d.status === 'S') stats.s++;
        else if (d.status === 'U') stats.u++;
        else if (d.status === 'C') stats.c++;
        stats.ot += d.ot;
    });

    // --- D. HEADER UI ---
    // Row 2: Title "Pegadaian ... REKAPITULASI ... PESONNA OPTIMA JASA"
    const titleRow = sheet.getRow(2);
    titleRow.height = 28;
    sheet.getRow(3).height = 18;

    // Fake Logo Pegadaian in A2-D2
    sheet.mergeCells('A2:H2');
    const logoPegadaianCell = sheet.getCell('A2');
    logoPegadaianCell.value = 'Pegadaian'; // Placeholder
    logoPegadaianCell.font = { name: 'Arial', bold: true, size: 20, color: { argb: 'FF00B050' } };
    logoPegadaianCell.alignment = { vertical: 'middle', horizontal: 'left' };

    // Main Titles
    sheet.mergeCells('I2:W2');
    const titleCell = sheet.getCell('I2');
    titleCell.value = 'REKAPITULASI PERHITUNGAN LEMBAR KERJA';
    titleCell.font = { name: 'Arial', bold: true, size: 14 };
    titleCell.alignment = { vertical: 'top', horizontal: 'center' };

    sheet.mergeCells('I3:W3');
    const subtitleCell = sheet.getCell('I3');
    subtitleCell.value = 'PT Pesonna Optima Jasa';
    subtitleCell.font = { name: 'Arial', bold: true, size: 12 };
    subtitleCell.alignment = { vertical: 'top', horizontal: 'center' };

    // Fake Logo POJ
    sheet.mergeCells('Y2:AG2');
    const logoPojCell = sheet.getCell('Y2');
    logoPojCell.value = 'PESONNA OPTIMA JASA'; // Placeholder
    logoPojCell.font = { name: 'Arial', bold: true, size: 16, color: { argb: 'FF92D050' } };
    logoPojCell.alignment = { vertical: 'middle', horizontal: 'right' };

    // Info Block Rows 6-9
    const infoLeft = [
        ['Client Site', ':', employee.clientSite || 'Divisi Pengembangan Aplikasi TI - PT Pegadaian'],
        ['Work Unit', ':', employee.workUnit || ''],
        ['Dept. Head Name', ':', employee.deptHead || ''],
        ['Supervisor', ':', employee.supervisor || '']
    ];

    const infoRight = [
        ['Squad', ':', employee.squad || ''],
        ['Employee Name', ':', (employee.reportName || employee.name || '').toUpperCase()],
        ['Employee Number', ':', employee.no || ''],
        ['Month', ':', periodDisplay]
    ];

    for (let i = 0; i < 4; i++) {
        const r = sheet.getRow(6 + i);
        r.height = 16;
        r.getCell(1).value = infoLeft[i][0]; r.getCell(1).font = { size: 9 };
        sheet.mergeCells(`A${6 + i}:B${6 + i}`); // Span "Client Site" over A and B

        r.getCell(3).value = infoLeft[i][1]; r.getCell(3).font = { size: 9 };
        r.getCell(4).value = infoLeft[i][2]; r.getCell(4).font = { size: 9, bold: true, underline: true };
        sheet.mergeCells(`D${6 + i}:K${6 + i}`); // Span values

        // Right side: perlebar label agar "Employee Number" tidak kepotong
        r.getCell(18).value = infoRight[i][0];
        r.getCell(18).font = { size: 9 };
        sheet.mergeCells(`R${6 + i}:T${6 + i}`);

        r.getCell(21).value = infoRight[i][1];
        r.getCell(21).font = { size: 9 };
        r.getCell(22).value = infoRight[i][2];
        r.getCell(22).font = { size: 9, bold: true, underline: true };
        sheet.mergeCells(`V${6 + i}:AD${6 + i}`);
    }

    // Row 11: Date Headers
    const headerRowIdx = 11;
    const headerRow = sheet.getRow(headerRowIdx);
    headerRow.height = 18;

    headerRow.getCell(1).value = 'Date';
    sheet.mergeCells(`A${headerRowIdx}:B${headerRowIdx}`);
    const dateLabelCell = headerRow.getCell(1);
    dateLabelCell.fill = fillHeader;
    dateLabelCell.border = borderStyle;
    dateLabelCell.alignment = centerStyle;
    dateLabelCell.font = { name: 'Arial', bold: true, size: 9 };

    // Set individual borders for merged cells A and B in header
    ['A', 'B'].forEach(col => { sheet.getCell(`${col}${headerRowIdx}`).border = borderStyle; });

    dateHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(3 + i);
        cell.value = Number(h.label);
        cell.fill = fillHeader;
        cell.border = borderStyle;
        cell.alignment = centerStyle;
        cell.font = { name: 'Arial', bold: true, size: 9 };
    });

    // Optional: an empty end column for spacing? Image stops right after the 25

    // Row data rendering function
    let currentRow = 13;
    const buildExcelRow = (code: string, label: string, type: 'status' | 'ot' | 'check', drawBorderCodes: boolean = true) => {
        const row = sheet.getRow(currentRow++);
        row.height = 16;

        row.getCell(1).value = code;
        row.getCell(2).value = label;

        row.getCell(1).font = { name: 'Arial', size: 9 };
        row.getCell(2).font = { name: 'Arial', size: 9 };

        if (drawBorderCodes) {
            row.getCell(1).border = borderStyle;
            row.getCell(2).border = borderStyle;
            row.getCell(1).alignment = centerStyle;
            row.getCell(2).alignment = { ...leftStyle, indent: 1 };
        }

        dateHeaders.forEach((h, i) => {
            const cell = row.getCell(3 + i);
            const item = dataMap[h.date];
            let val: string | number = '';

            if (item.isHoliday) cell.fill = fillHoliday;
            else if (h.isWeekend) cell.fill = fillWeekendLight;

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
            cell.font = { name: 'Arial', size: 9, bold: (item.status === 'H' || item.status === 'W' || item.status === 'AL') };

            // Image shows red text for H / AL ?
            if (val === 'H') cell.font = { ...cell.font, color: { argb: 'FFFF0000' } };
        });
    };

    buildExcelRow('WH', '- Work Hours', 'status');
    buildExcelRow('OT', '- Over Time', 'ot');

    currentRow++; // Empty row in between
    sheet.getRow(currentRow - 1).height = 8; // Small spacer row

    buildExcelRow('H', '- Holidays', 'check');
    buildExcelRow('AL', '- Annual Leave', 'check');
    buildExcelRow('S', '- Sick Leave', 'check');
    buildExcelRow('U', '- Unpaid Leave', 'check');
    buildExcelRow('C', '- Comp. Off', 'check');
    buildExcelRow('W', '- Weekend', 'check');

    // Total Row (Row 23)
    const totalRow = sheet.getRow(currentRow++);
    totalRow.height = 18;
    sheet.mergeCells(`A${totalRow.number}:B${totalRow.number}`);
    totalRow.getCell(1).value = 'Total';
    totalRow.getCell(1).font = { name: 'Arial', bold: true, size: 9 };
    totalRow.getCell(1).border = borderStyle;
    totalRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
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
        cell.font = { name: 'Arial', bold: true, size: 9 };
        if (d.isHoliday) cell.fill = fillHoliday;
        else if (h.isWeekend) cell.fill = fillWeekendLight;
    });

    // Notes Below Table (Row 24)
    const infoRow = sheet.getRow(currentRow++);
    sheet.mergeCells(`A${currentRow - 1}:AF${currentRow - 1}`);
    infoRow.getCell(1).value = 'Please write the corresponding alphabets (AL for Annual Leave, S for Sick Leave, C for Comp Off, etc) against the appropriate date.';
    infoRow.getCell(1).font = { name: 'Arial', italic: true, size: 8 };
    infoRow.height = 16;

    currentRow += 2; // Jump to Recap

    // --- FOOTER SECTION ---
    const footerStart = currentRow; // ~27

    // RECAP Block (Cols A-C)
    const recapHeaderRow = sheet.getRow(footerStart);
    recapHeaderRow.getCell(1).value = 'RECAP';
    sheet.mergeCells(`A${footerStart}:B${footerStart}`);
    recapHeaderRow.getCell(3).value = 'Hours';
    recapHeaderRow.getCell(4).value = 'Days';

    ['A', 'B', 'C', 'D'].forEach(col => {
        const c = sheet.getCell(`${col}${footerStart}`);
        c.fill = fillHeader;
        c.font = { name: 'Arial', bold: true, size: 9 };
        c.border = borderStyle;
        c.alignment = centerStyle;
    });
    sheet.getColumn(3).width = 7.5;
    sheet.getColumn(4).width = 7.5;

    const addRecap = (idxOffset: number, lbl1: string, lbl2: string, vHrs: number | string, vDays: number | string) => {
        const r = sheet.getRow(footerStart + idxOffset);
        r.getCell(1).value = lbl1;
        r.getCell(2).value = lbl2;
        r.getCell(3).value = vHrs;
        r.getCell(4).value = vDays;

        [1, 2, 3, 4].forEach(col => {
            const c = r.getCell(col);
            c.border = borderStyle;
            c.font = { name: 'Arial', size: 9, bold: (idxOffset === 8) }; // Total is offset 8
            if (col === 1) c.alignment = centerStyle;
            else if (col === 2) c.alignment = { horizontal: 'left', vertical: 'middle' };
            else c.alignment = centerStyle;
        });
    };

    addRecap(1, 'WH', '- Work Hours', stats.wh, stats.totalDays);
    addRecap(2, 'OT', '- Over Time', stats.ot, 0);
    // Mengikuti layout sample: kategori leave tetap direkap hari, kolom hours = 0
    addRecap(3, 'H', '- Holidays', 0, stats.h);
    addRecap(4, 'AL', '- Annual Leave', 0, stats.al);
    addRecap(5, 'S', '- Sick Leave', 0, stats.s);
    addRecap(6, 'U', '- Unpaid Leave', 0, stats.u);
    addRecap(7, 'C', '- Comp. Off', 0, stats.c);

    // TOTAL
    addRecap(8, 'TOTAL', '', stats.wh + stats.ot, stats.totalDays);
    sheet.mergeCells(`A${footerStart + 8}:B${footerStart + 8}`);
    sheet.getCell(`A${footerStart + 8}`).value = 'TOTAL';
    sheet.getCell(`A${footerStart + 8}`).alignment = { horizontal: 'left', vertical: 'middle' }; // In image it's on left

    // Signatures Block (Cols F - AA)
    const signTopRow = sheet.getRow(footerStart - 1); // Row above recap for CERTIFY
    sheet.mergeCells(`G${footerStart - 1}:U${footerStart - 1}`);
    const certifyCell = signTopRow.getCell(7);
    certifyCell.value = `" I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD "`;
    certifyCell.font = { name: 'Arial', size: 8 };

    const signPeriodRow = sheet.getRow(footerStart);
    sheet.mergeCells(`G${footerStart}:K${footerStart}`);
    const fromCell = signPeriodRow.getCell(7);
    fromCell.value = `FROM: ${periodDisplay}`;
    fromCell.font = { name: 'Arial', size: 8, bold: true };

    // Headers (Employee, Supervisor, Dept Head)
    const signRoleRow = sheet.getRow(footerStart + 1);
    signRoleRow.getCell(9).value = 'Employee'; signRoleRow.getCell(9).font = { name: 'Arial', bold: true, size: 9 };
    signRoleRow.getCell(15).value = 'Supervisor'; signRoleRow.getCell(15).font = { name: 'Arial', bold: true, size: 9 };
    signRoleRow.getCell(21).value = 'Departemen Head'; signRoleRow.getCell(21).font = { name: 'Arial', bold: true, size: 9 };

    // Names (Underlined)
    const signNameRow = sheet.getRow(footerStart + 6);
    // Lines under names in image are full width
    [9, 15, 21].forEach(c => {
        // Just applying thick bottom border
        const cell = signNameRow.getCell(c);
        cell.border = { bottom: { style: 'thin' } };
    });

    const signNameTextRow = sheet.getRow(footerStart + 7);
    // A bit messy positioning exactly without merge, but centering to columns
    signNameTextRow.getCell(9).value = (employee.reportName || employee.name || '').toUpperCase();
    signNameTextRow.getCell(15).value = employee.supervisor;
    signNameTextRow.getCell(21).value = employee.deptHead;

    [9, 15, 21].forEach(c => {
        const cell = signNameTextRow.getCell(c);
        cell.font = { name: 'Arial', bold: true, size: 9 };
        cell.alignment = { horizontal: 'center' };
        // Draw line above
        sheet.getCell(sheet.getColumn(c - 1).letter + (footerStart + 6)).border = { bottom: { style: 'thin' } };
        sheet.getCell(sheet.getColumn(c).letter + (footerStart + 6)).border = { bottom: { style: 'thin' } };
        sheet.getCell(sheet.getColumn(c + 1).letter + (footerStart + 6)).border = { bottom: { style: 'thin' } };
        sheet.getCell(sheet.getColumn(c + 2).letter + (footerStart + 6)).border = { bottom: { style: 'thin' } };
    });

    // Add line to the left of Employee start and right of Dept Head to frame it loosely if wanted, but image shows floating underscores

    const signDateRow = sheet.getRow(footerStart + 8);
    const dateStr = employee.periodEnd ? dayjs(employee.periodEnd).format('DD / MM / YYYY') : '-';

    [9, 15, 21].forEach(c => {
        signDateRow.getCell(c).value = `Date:   ${dateStr}`;
        signDateRow.getCell(c).font = { name: 'Arial', size: 8 };
        signDateRow.getCell(c).alignment = { horizontal: 'center' };
    });

    // NOTES Box (Cols V/W - ...)
    sheet.mergeCells(`W${footerStart - 1}:AC${footerStart + 6}`); // Big Box
    const notesStartRow = footerStart - 1;
    const notesEndRow = footerStart + 6;
    const notesStartCol = 23; // W
    const notesEndCol = 29; // AC
    const notesBox = sheet.getCell(`W${notesStartRow}`);
    notesBox.value = 'NOTES:';
    notesBox.font = { name: 'Arial', bold: true, size: 8 };
    notesBox.alignment = { vertical: 'top', horizontal: 'left' };
    for (let r = notesStartRow; r <= notesEndRow; r++) {
        for (let c = notesStartCol; c <= notesEndCol; c++) {
            const cell = sheet.getCell(r, c);
            cell.border = {
                top: r === notesStartRow ? { style: 'thin' } : undefined,
                bottom: r === notesEndRow ? { style: 'thin' } : undefined,
                left: c === notesStartCol ? { style: 'thin' } : undefined,
                right: c === notesEndCol ? { style: 'thin' } : undefined
            };
        }
    }

    // Bottom Notice
    const bottomNotice1 = sheet.getRow(footerStart + 10);
    bottomNotice1.getCell(1).value = 'Please Email This Form, Duly Signed To:';
    bottomNotice1.getCell(1).font = { name: 'Arial', size: 8, italic: true };
    sheet.mergeCells(`A${bottomNotice1.number}:F${bottomNotice1.number}`);

    const bottomNotice2 = sheet.getRow(footerStart + 11);
    bottomNotice2.getCell(1).value = 'Attn: The HR Departement';
    bottomNotice2.getCell(1).font = { name: 'Arial', size: 8, italic: true, bold: true, underline: true };
    sheet.mergeCells(`A${bottomNotice2.number}:F${bottomNotice2.number}`);

    const bottomNotice3 = sheet.getRow(footerStart + 10); // Far right
    bottomNotice3.getCell(21).value = '** Leave application must be faxed with the timesheet!';
    bottomNotice3.getCell(21).font = { name: 'Arial', size: 8, italic: true };
    sheet.mergeCells(`U${bottomNotice3.number}:AG${bottomNotice3.number}`);

    return await workbook.xlsx.writeBuffer();
};

// ==========================================
// 2. GENERATOR MANDAYS (REVISED & FIXED)
// ==========================================
export const generateMandaysExcel = async (
    employee: any,
    tasks: Task[],
    overtimeTasks: OvertimeTask[],
    _holidays: string[] = []
) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mandays Report', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
    });

    const setBorder = (row: number, from: number, to: number) => {
        for (let c = from; c <= to; c++) {
            sheet.getCell(row, c).border = borderStyle;
        }
    };

    // A..N
    const widths = [4, 10, 10, 14, 14, 14, 14, 14, 14, 9, 13, 13, 10, 11];
    widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

    let periodDisplay = employee.month;
    if (!periodDisplay && employee.periodStart && employee.periodEnd) {
        const startMonth = dayjs(employee.periodStart).format('MMMM').toUpperCase();
        const endMonth = dayjs(employee.periodEnd).format('MMMM').toUpperCase();
        periodDisplay = startMonth === endMonth ? startMonth : `${startMonth} TO ${endMonth}`;
    } else if (!periodDisplay) {
        periodDisplay = '-';
    }

    const displayName = (employee.reportName || employee.name || '').toUpperCase();
    const clientSite = employee.clientSite || 'Divisi Pengembangan Aplikasi TI - PT Pegadaian';
    const workUnit = employee.workUnit || '';
    const deptHead = employee.deptHead || '';
    const supervisor = employee.supervisor || '';
    const squad = employee.squad || '';
    const employeeNo = employee.no || '';

    // Header + title
    sheet.mergeCells('A2:D2');
    sheet.getCell('A2').value = 'Pegadaian';
    sheet.getCell('A2').font = { name: 'Arial', bold: true, size: 18, color: { argb: 'FF00B050' } };
    sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' };

    sheet.mergeCells('E2:J2');
    sheet.getCell('E2').value = 'MANDAYS CONSUMPTION REPORT';
    sheet.getCell('E2').font = { name: 'Arial', bold: true, size: 14 };
    sheet.getCell('E2').alignment = centerStyle;

    sheet.mergeCells('E3:J3');
    sheet.getCell('E3').value = 'PT Pesonna Optima Jasa';
    sheet.getCell('E3').font = { name: 'Arial', bold: true, size: 11 };
    sheet.getCell('E3').alignment = centerStyle;

    sheet.mergeCells('K2:N2');
    sheet.getCell('K2').value = 'PESONNA OPTIMA JASA';
    sheet.getCell('K2').font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FF92D050' } };
    sheet.getCell('K2').alignment = { vertical: 'middle', horizontal: 'right' };

    const leftInfo = [
        ['Client Site', ':', clientSite],
        ['Work Unit', ':', workUnit],
        ['Dept. Head Name', ':', deptHead],
        ['Supervisor', ':', supervisor]
    ];
    const rightInfo = [
        ['Squad', ':', squad],
        ['Employee Name', ':', displayName],
        ['Employee Number', ':', employeeNo],
        ['Month', ':', periodDisplay]
    ];

    for (let i = 0; i < 4; i++) {
        const rowNum = 6 + i;
        const row = sheet.getRow(rowNum);
        row.height = 15;

        row.getCell(1).value = leftInfo[i][0];
        sheet.mergeCells(`A${rowNum}:B${rowNum}`);
        row.getCell(3).value = leftInfo[i][1];
        row.getCell(4).value = leftInfo[i][2];
        sheet.mergeCells(`D${rowNum}:G${rowNum}`);
        row.getCell(4).font = { name: 'Arial', size: 9, bold: true, underline: true };

        row.getCell(9).value = rightInfo[i][0];
        sheet.mergeCells(`I${rowNum}:J${rowNum}`);
        row.getCell(11).value = rightInfo[i][1];
        row.getCell(12).value = rightInfo[i][2];
        sheet.mergeCells(`L${rowNum}:N${rowNum}`);
        row.getCell(12).font = { name: 'Arial', size: 9, bold: true, underline: true };

        [1, 3, 4, 9, 11, 12].forEach((c) => {
            row.getCell(c).font = row.getCell(c).font || { name: 'Arial', size: 9 };
            row.getCell(c).alignment = { vertical: 'middle', horizontal: c === 4 || c === 12 ? 'left' : 'left' };
        });
    }

    const sectionRow = 10;
    sheet.mergeCells(`A${sectionRow}:D${sectionRow}`);
    sheet.getCell(`A${sectionRow}`).value = 'A. Regular';
    sheet.getCell(`A${sectionRow}`).font = { name: 'Arial', bold: true, size: 9 };

    const regularHeaderRow = 11;
    const regularDataStart = 12;
    let currentRow = regularDataStart;

    const regularHeader = sheet.getRow(regularHeaderRow);
    regularHeader.height = 22;
    const headerDefs = [
        { title: 'No.', from: 1, to: 1 },
        { title: 'Date', from: 2, to: 3 },
        { title: 'Description', from: 4, to: 9 },
        { title: 'Duration of Work\n(Mandays)', from: 10, to: 10 },
        { title: "JIRA's Link", from: 11, to: 12 },
        { title: 'CRF/G-Canvas No.', from: 13, to: 13 },
        { title: 'Ket.', from: 14, to: 14 }
    ];

    headerDefs.forEach((h) => {
        if (h.from !== h.to) sheet.mergeCells(regularHeaderRow, h.from, regularHeaderRow, h.to);
        const cell = regularHeader.getCell(h.from);
        cell.value = h.title;
        cell.fill = fillHeader;
        cell.font = { name: 'Arial', size: 9, bold: true };
        cell.alignment = { ...centerStyle, wrapText: true };
        setBorder(regularHeaderRow, h.from, h.to);
    });

    const groupedTasks: { [key: string]: { tasks: Task[], meta: any } } = {};
    tasks.forEach((task) => {
        const { key, display, timestamp } = parseDateKey(task.date);
        if (!groupedTasks[key]) groupedTasks[key] = { tasks: [], meta: { display, timestamp } };
        groupedTasks[key].tasks.push(task);
    });
    const sortedKeys = Object.keys(groupedTasks).sort((a, b) => groupedTasks[a].meta.timestamp - groupedTasks[b].meta.timestamp);

    let rowNumber = 1;
    let totalMandays = 0;
    sortedKeys.forEach((key) => {
        const group = groupedTasks[key];
        const dailyTasks = group.tasks;
        const rowSpan = dailyTasks.length;
        const isLeave = dailyTasks.some(t => (t.description || '').toLowerCase().includes('cuti') || (t.description || '').toLowerCase().includes('annual leave'));
        if (!isLeave) totalMandays += 1;

        const startRow = currentRow;
        dailyTasks.forEach((t, index) => {
            const row = sheet.getRow(currentRow++);
            row.height = 16;
            if (index === 0) {
                row.getCell(1).value = rowNumber;
                row.getCell(2).value = group.meta.display;
                row.getCell(10).value = isLeave ? '' : 1;
            }
            row.getCell(4).value = t.description || '';
            const jiraCell = row.getCell(11);
            jiraCell.value = t.ticketLink ? { text: t.ticketNumber || 'Link', hyperlink: t.ticketLink } : (t.ticketNumber || '');
            if (t.ticketLink) jiraCell.font = { color: { argb: 'FF0000FF' }, underline: true };

            row.getCell(1).alignment = centerStyle;
            row.getCell(2).alignment = centerStyle;
            row.getCell(4).alignment = { ...leftStyle, indent: 1 };
            row.getCell(10).alignment = centerStyle;
            row.getCell(11).alignment = centerStyle;

            setBorder(row.number, 1, 14);
            if (rowSpan === 1) {
                sheet.mergeCells(row.number, 2, row.number, 3);
            }
            sheet.mergeCells(row.number, 4, row.number, 9);
            sheet.mergeCells(row.number, 11, row.number, 12);
        });

        if (rowSpan > 1) {
            sheet.mergeCells(startRow, 1, startRow + rowSpan - 1, 1);
            sheet.mergeCells(startRow, 2, startRow + rowSpan - 1, 3);
            sheet.mergeCells(startRow, 10, startRow + rowSpan - 1, 10);
        }
        rowNumber++;
    });

    const totalRegularRow = sheet.getRow(currentRow++);
    totalRegularRow.getCell(4).value = 'TotalMandays Reguler';
    totalRegularRow.getCell(10).value = totalMandays;
    totalRegularRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    totalRegularRow.getCell(10).alignment = centerStyle;
    totalRegularRow.getCell(4).font = boldFont;
    totalRegularRow.getCell(10).font = boldFont;
    setBorder(totalRegularRow.number, 1, 14);
    for (let c = 1; c <= 14; c++) sheet.getCell(totalRegularRow.number, c).fill = fillWeekend;
    sheet.mergeCells(totalRegularRow.number, 1, totalRegularRow.number, 9);
    sheet.mergeCells(totalRegularRow.number, 11, totalRegularRow.number, 14);

    currentRow++;

    // Overtime table
    const overtimeTitleRow = sheet.getRow(currentRow++);
    overtimeTitleRow.getCell(1).value = 'Overtime';
    overtimeTitleRow.getCell(1).font = { bold: true, size: 9 };

    const overtimeHeaderRow = sheet.getRow(currentRow++);
    const otHeaderDefs = [
        { title: 'No.', from: 1, to: 1 },
        { title: 'Date', from: 2, to: 3 },
        { title: 'Description', from: 4, to: 9 },
        { title: 'Duration of Work\n(Hours)', from: 10, to: 10 },
        { title: "JIRA's Link", from: 11, to: 12 },
        { title: 'Ket./Nomor Surat Tugas', from: 13, to: 14 }
    ];
    otHeaderDefs.forEach((h) => {
        if (h.from !== h.to) sheet.mergeCells(overtimeHeaderRow.number, h.from, overtimeHeaderRow.number, h.to);
        const cell = overtimeHeaderRow.getCell(h.from);
        cell.value = h.title;
        cell.fill = fillHeader;
        cell.font = { name: 'Arial', size: 9, bold: true };
        cell.alignment = { ...centerStyle, wrapText: true };
        setBorder(overtimeHeaderRow.number, h.from, h.to);
    });

    let totalOtHours = 0;
    const otDates = new Set<string>();
    const sortedOt = [...overtimeTasks].sort((a, b) => parseDateKey(a.date).timestamp - parseDateKey(b.date).timestamp);
    sortedOt.forEach((ot, i) => {
        const row = sheet.getRow(currentRow++);
        row.height = 16;
        const { display } = parseDateKey(ot.date);
        const dur = parseFloat(String(ot.duration)) || 0;
        totalOtHours += dur;
        if (ot.date) otDates.add(parseDateKey(ot.date).key);

        row.getCell(1).value = i + 1;
        row.getCell(2).value = display;
        row.getCell(4).value = ot.description || '';
        row.getCell(10).value = dur || '';
        row.getCell(11).value = ot.ticketLink ? { text: 'Link', hyperlink: ot.ticketLink } : '';
        row.getCell(13).value = ot.remarks || '';

        if (ot.ticketLink) row.getCell(11).font = { color: { argb: 'FF0000FF' }, underline: true };
        row.getCell(1).alignment = centerStyle;
        row.getCell(2).alignment = centerStyle;
        row.getCell(4).alignment = { ...leftStyle, indent: 1 };
        row.getCell(10).alignment = centerStyle;
        row.getCell(11).alignment = centerStyle;
        row.getCell(13).alignment = { ...leftStyle, indent: 1 };

        setBorder(row.number, 1, 14);
        sheet.mergeCells(row.number, 2, row.number, 3);
        sheet.mergeCells(row.number, 4, row.number, 9);
        sheet.mergeCells(row.number, 11, row.number, 12);
        sheet.mergeCells(row.number, 13, row.number, 14);
    });

    const totalOtDays = otDates.size;
    const otTotalHoursRow = sheet.getRow(currentRow++);
    otTotalHoursRow.getCell(4).value = 'TotalHours Overtime';
    otTotalHoursRow.getCell(10).value = totalOtHours;
    otTotalHoursRow.getCell(4).font = boldFont;
    otTotalHoursRow.getCell(10).font = boldFont;
    otTotalHoursRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    otTotalHoursRow.getCell(10).alignment = centerStyle;
    setBorder(otTotalHoursRow.number, 1, 14);
    for (let c = 1; c <= 14; c++) sheet.getCell(otTotalHoursRow.number, c).fill = fillWeekend;
    sheet.mergeCells(otTotalHoursRow.number, 1, otTotalHoursRow.number, 9);
    sheet.mergeCells(otTotalHoursRow.number, 11, otTotalHoursRow.number, 14);

    const otTotalDaysRow = sheet.getRow(currentRow++);
    otTotalDaysRow.getCell(4).value = 'TotalDays Overtime';
    otTotalDaysRow.getCell(10).value = totalOtDays;
    otTotalDaysRow.getCell(4).font = boldFont;
    otTotalDaysRow.getCell(10).font = boldFont;
    otTotalDaysRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    otTotalDaysRow.getCell(10).alignment = centerStyle;
    setBorder(otTotalDaysRow.number, 1, 14);
    for (let c = 1; c <= 14; c++) sheet.getCell(otTotalDaysRow.number, c).fill = fillWeekend;
    sheet.mergeCells(otTotalDaysRow.number, 1, otTotalDaysRow.number, 9);
    sheet.mergeCells(otTotalDaysRow.number, 11, otTotalDaysRow.number, 14);

    currentRow += 1;
    const totalHoursFinal = totalMandays * 8;

    // Recap block (left)
    const recapStart = currentRow;
    sheet.mergeCells(`A${recapStart}:B${recapStart}`);
    sheet.getCell(`A${recapStart}`).value = 'RECAP';
    sheet.getCell(`C${recapStart}`).value = 'Hours';
    sheet.getCell(`D${recapStart}`).value = 'Days';
    ['A', 'B', 'C', 'D'].forEach((col) => {
        const c = sheet.getCell(`${col}${recapStart}`);
        c.fill = fillHeader;
        c.font = { name: 'Arial', bold: true, size: 9 };
        c.border = borderStyle;
        c.alignment = centerStyle;
    });

    const addRecap = (idx: number, code: string, label: string, hrs: number, days: number) => {
        const rowNum = recapStart + idx;
        sheet.getCell(`A${rowNum}`).value = code;
        sheet.getCell(`B${rowNum}`).value = label;
        sheet.getCell(`C${rowNum}`).value = hrs;
        sheet.getCell(`D${rowNum}`).value = days;
        ['A', 'B', 'C', 'D'].forEach((col) => {
            const c = sheet.getCell(`${col}${rowNum}`);
            c.border = borderStyle;
            c.alignment = col === 'B' ? { vertical: 'middle', horizontal: 'left' } : centerStyle;
            c.font = { name: 'Arial', size: 9, bold: code === 'TOTAL' };
        });
    };

    addRecap(1, 'REG', '- Work Hours', totalHoursFinal, totalMandays);
    addRecap(2, 'OT', '- Over Time', totalOtHours, totalOtDays);
    addRecap(3, 'TOTAL', '', totalHoursFinal + totalOtHours, totalMandays + totalOtDays);
    sheet.mergeCells(`A${recapStart + 3}:B${recapStart + 3}`);
    sheet.getCell(`A${recapStart + 3}`).alignment = { horizontal: 'left', vertical: 'middle' };

    // Signature + notes (right)
    sheet.mergeCells(`F${recapStart}:L${recapStart}`);
    sheet.getCell(`F${recapStart}`).value = `" I CERTIFY THAT THE ABOVE IS A TRUE RECORD OF MY TIME FOR THIS PERIOD FROM ${periodDisplay} "`;
    sheet.getCell(`F${recapStart}`).font = { name: 'Arial', size: 8, italic: true };

    const roleRow = recapStart + 1;
    sheet.getCell(`G${roleRow}`).value = 'Employee';
    sheet.getCell(`I${roleRow}`).value = 'Supervisor';
    sheet.getCell(`K${roleRow}`).value = 'Departemen Head';
    ['G', 'I', 'K'].forEach((col) => {
        const c = sheet.getCell(`${col}${roleRow}`);
        c.font = { name: 'Arial', bold: true, size: 9 };
        c.alignment = centerStyle;
    });

    const lineRow = recapStart + 5;
    const nameRow = recapStart + 6;
    const dateRow = recapStart + 7;
    const nameTriples = [
        { from: 'F', to: 'G', name: displayName },
        { from: 'H', to: 'I', name: supervisor },
        { from: 'J', to: 'L', name: deptHead }
    ];
    nameTriples.forEach((n) => {
        sheet.mergeCells(`${n.from}${lineRow}:${n.to}${lineRow}`);
        sheet.mergeCells(`${n.from}${nameRow}:${n.to}${nameRow}`);
        sheet.mergeCells(`${n.from}${dateRow}:${n.to}${dateRow}`);
        const line = sheet.getCell(`${n.from}${lineRow}`);
        line.border = { bottom: { style: 'thin' } };
        const nameCell = sheet.getCell(`${n.from}${nameRow}`);
        nameCell.value = n.name;
        nameCell.font = { name: 'Arial', bold: true, size: 9 };
        nameCell.alignment = centerStyle;
        const dateCell = sheet.getCell(`${n.from}${dateRow}`);
        dateCell.value = `Date: ${employee.periodEnd ? dayjs(employee.periodEnd).format('DD/MM/YYYY') : '-'}`;
        dateCell.font = { name: 'Arial', size: 8 };
        dateCell.alignment = centerStyle;
    });

    sheet.mergeCells(`M${recapStart}:N${recapStart + 6}`);
    const notesCell = sheet.getCell(`M${recapStart}`);
    notesCell.value = 'NOTES:';
    notesCell.font = { name: 'Arial', bold: true, size: 8 };
    notesCell.alignment = { vertical: 'top', horizontal: 'left' };
    notesCell.border = borderStyle;

    return await workbook.xlsx.writeBuffer();
};