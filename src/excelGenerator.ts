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
    titleRow.height = 30; // Tall row for logos

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
        r.height = 15;
        r.getCell(1).value = infoLeft[i][0]; r.getCell(1).font = { size: 9 };
        sheet.mergeCells(`A${6 + i}:B${6 + i}`); // Span "Client Site" over A and B

        r.getCell(3).value = infoLeft[i][1]; r.getCell(3).font = { size: 9 };
        r.getCell(4).value = infoLeft[i][2]; r.getCell(4).font = { size: 9, bold: true, underline: true };
        sheet.mergeCells(`D${6 + i}:K${6 + i}`); // Span values

        // Right side in Col S (19), T (20), U (21+)
        r.getCell(19).value = infoRight[i][0]; r.getCell(19).font = { size: 9 };
        sheet.mergeCells(`S${6 + i}:T${6 + i}`);

        r.getCell(21).value = infoRight[i][1]; r.getCell(21).font = { size: 9 };
        r.getCell(22).value = infoRight[i][2]; r.getCell(22).font = { size: 9, bold: true, underline: true };
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
    totalRow.getCell(2).value = 'Total';
    totalRow.getCell(2).font = { name: 'Arial', bold: true, size: 9 };
    totalRow.getCell(2).border = borderStyle;
    totalRow.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };

    // Need border for A as well to look complete?
    totalRow.getCell(1).border = borderStyle;

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
    addRecap(2, 'OT', '- Over Time', stats.ot, 0); // Image showed 0 if 0
    addRecap(3, 'H', '- Holidays', stats.h * 8, stats.h);
    addRecap(4, 'AL', '- Annual Leave', stats.al * 8, stats.al);
    addRecap(5, 'S', '- Sick Leave', stats.s * 8, stats.s);
    addRecap(6, 'U', '- Unpaid Leave', stats.u * 8, stats.u);
    addRecap(7, 'C', '- Comp. Off', stats.c * 8, stats.c);

    // TOTAL
    addRecap(8, 'TOTAL', '', stats.wh + stats.ot + (stats.h + stats.al + stats.s + stats.u + stats.c) * 8, stats.totalDays + stats.h + stats.al + stats.s + stats.u + stats.c);
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
    const notesBox = sheet.getCell(`W${footerStart - 1}`);
    notesBox.value = 'NOTES:';
    notesBox.font = { name: 'Arial', bold: true, size: 8 };
    notesBox.alignment = { vertical: 'top', horizontal: 'left' };
    notesBox.border = borderStyle;

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
    Object.values(groupedT).forEach((dailyTasks: Task[]) => {
        if (!dailyTasks.some((t: Task) => (t.description || '').toLowerCase().includes('cuti') || (t.description || '').toLowerCase().includes('annual leave'))) {
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