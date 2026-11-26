import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import {
    Task,
    OvertimeTask,
    parseDateKey,
    enrichTasksWithApiHolidays,
    resolveHolidayDates,
    isNonCountableMandayDay,
    getTimesheetPeriodBounds,
} from './templates/htmlHelpers';

/**
 * Excel dibuat dari template resmi (assets/templates/poj-report-template.xlsx),
 * hasil sanitasi dari "2026_11_POJ42050260_ANNAS PUTRA ANURAGA.xlsx": style, merge,
 * lebar kolom, logo dan print setup diambil apa adanya; kode ini hanya mengisi data.
 */

const TEMPLATE_PATH = path.resolve(__dirname, '../assets/templates/poj-report-template.xlsx');

const SHEET_DATA = 'DATA';
const SHEET_TIMESHEET = 'PERHITUNGAN LEMBAR KERJA';
const SHEET_MANDAYS = 'MANDAYS CONSUMPTION REPORT';

const BULAN = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

type Style = Partial<ExcelJS.Style>;
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// ==========================================
// SHARED
// ==========================================
interface EmployeeInfo {
    name: string; no: string; company: string; clientSite: string; workUnit: string;
    deptHead: string; supervisor: string; squad: string;
    startMonth: string; endMonth: string; signDate: string;
}

const resolveEmployee = (employee: any): EmployeeInfo => {
    const { startDate, endDate } = getTimesheetPeriodBounds(employee);
    const reportName = employee.reportName && String(employee.reportName).trim() !== '' ? String(employee.reportName).trim() : '';
    return {
        name: reportName || employee.name || '',
        no: employee.no || '',
        company: 'PT Pesonna Optima Jasa',
        clientSite: employee.clientSite || 'Divisi Pengembangan Aplikasi TI - PT Pegadaian',
        workUnit: employee.workUnit || '',
        deptHead: employee.deptHead || '',
        supervisor: employee.supervisor || '',
        squad: employee.squad || '',
        startMonth: BULAN[startDate.month()],
        endMonth: BULAN[endDate.month()],
        signDate: `Date        ${endDate.format('DD')}  / ${endDate.format('MM')} / ${endDate.format('YYYY')}`,
    };
};

const loadTemplate = async (keepSheet: string) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(TEMPLATE_PATH);
    // Satu file per jenis laporan: DATA + sheet laporannya.
    for (const ws of [...wb.worksheets]) {
        if (ws.name !== SHEET_DATA && ws.name !== keepSheet) wb.removeWorksheet(ws.id);
    }
    const target = wb.getWorksheet(keepSheet)!;
    // Nama khusus custom view Excel ("Z_<GUID>_.wvu.*") kehilangan scope-nya setelah
    // dibaca ExcelJS dan membuat Excel menampilkan "repairing unreadable content".
    const names = wb.definedNames as any;
    names.model = names.model.filter((n: { name: string }) => !n.name.includes('.wvu.'));
    wb.worksheets.forEach((ws) => { (ws.pageSetup as any).useFirstPageNumber = false; });
    wb.views = [{ x: 0, y: 0, width: 28800, height: 16000, firstSheet: 0, activeTab: wb.worksheets.indexOf(target), visibility: 'visible' }];
    wb.calcProperties = { fullCalcOnLoad: true };
    return { wb, ws: target };
};

const fillDataSheet = (wb: ExcelJS.Workbook, e: EmployeeInfo) => {
    const ws = wb.getWorksheet(SHEET_DATA)!;
    ws.getCell('F5').value = e.name;
    ws.getCell('F6').value = e.no;
    ws.getCell('F7').value = e.company;
    ws.getCell('F8').value = e.clientSite;
    ws.getCell('F9').value = e.workUnit;
    ws.getCell('F10').value = e.deptHead;
    ws.getCell('F11').value = e.supervisor;
    ws.getCell('F12').value = e.squad;
    ws.getCell('F13').value = e.startMonth;
    ws.getCell('J13').value = e.endMonth;
};

/** Set formula + hasil terhitung (supaya tampil benar walau viewer tidak recalculation). */
const setFormula = (ws: ExcelJS.Worksheet, addr: string, formula: string, result: any) => {
    ws.getCell(addr).value = { formula, result } as ExcelJS.CellFormulaValue;
};

/** Header kiri/kanan sheet laporan (semua mengacu ke sheet DATA). */
const fillReportHeader = (ws: ExcelJS.Worksheet, e: EmployeeInfo, right: { value: string; to: string }) => {
    setFormula(ws, 'A3', 'DATA!F7', e.company);
    setFormula(ws, 'E6', 'DATA!F8', e.clientSite);
    setFormula(ws, 'E7', 'DATA!F9', e.workUnit);
    setFormula(ws, 'E8', 'DATA!F10', e.deptHead);
    setFormula(ws, 'E9', 'DATA!F11', e.supervisor);
    const col = right.value;
    setFormula(ws, `${col}6`, 'DATA!F12', e.squad);
    setFormula(ws, `${col}7`, 'DATA!F5', e.name);
    setFormula(ws, `${col}8`, 'DATA!F6', e.no);
    setFormula(ws, `${col}9`, 'DATA!F13', e.startMonth);
    setFormula(ws, `${right.to}9`, 'DATA!J13', e.endMonth);
};

// ==========================================
// 1. TIMESHEET (PERHITUNGAN LEMBAR KERJA)
// ==========================================
const TS = {
    headerRow: 11, whRow: 13, otRow: 14, codeRows: { H: 15, AL: 16, S: 17, U: 18, C: 19, W: 20 } as Record<string, number>,
    totalRow: 22, firstDayCol: 8, maxDays: 31,
};

const FILL_HOLIDAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };

export const generateTimesheetExcel = async (
    employee: any,
    tasks: Task[],
    overtimeTasks: OvertimeTask[],
    holidays: string[] = []
) => {
    const e = resolveEmployee(employee);
    const { wb, ws } = await loadTemplate(SHEET_TIMESHEET);
    fillDataSheet(wb, e);
    fillReportHeader(ws, e, { value: 'AC', to: 'AH' });

    // --- Periode 26 bulan lalu s/d 25 ---
    const { startDate, endDate } = getTimesheetPeriodBounds(employee);
    const days: { key: string; day: number; isWeekend: boolean }[] = [];
    for (let d = startDate.clone(); !d.isAfter(endDate, 'day'); d = d.add(1, 'day')) {
        days.push({ key: d.format('YYYY-MM-DD'), day: d.date(), isWeekend: d.day() === 0 || d.day() === 6 });
    }

    // --- Status per hari (logika sama dengan versi sebelumnya) ---
    const HOLIDAYS = resolveHolidayDates(holidays);
    const dataMap: Record<string, { status: string; ot: number; isHoliday: boolean }> = {};
    days.forEach((h) => {
        const isNasional = HOLIDAYS.includes(h.key);
        dataMap[h.key] = { status: isNasional ? 'H' : h.isWeekend ? 'W' : '', ot: 0, isHoliday: isNasional };
    });

    tasks.forEach((t) => {
        const key = parseDateKey(t.date).key;
        if (!dataMap[key]) return;
        const desc = (t.description || '').toUpperCase();
        const userStatus = (t.status || '').toUpperCase();
        let code = '';
        if (desc.startsWith('[AL]') || desc.includes('CUTI') || desc.includes('ANNUAL')) code = 'AL';
        else if (desc.startsWith('[S]') || desc.includes('SAKIT') || desc.includes('SICK')) code = 'S';
        else if (desc.startsWith('[H]') || desc.includes('LIBUR') || desc.includes('HOLIDAY')) code = 'H';
        else if (desc.startsWith('[U]') || desc.includes('UNPAID')) code = 'U';
        else if (desc.startsWith('[C]') || desc.includes('COMP')) code = 'C';
        else if (['AL', 'S', 'H', 'U', 'C'].includes(userStatus)) code = userStatus;

        if (code) {
            dataMap[key].status = code;
            dataMap[key].isHoliday = code === 'H';
        } else if (userStatus === 'WH' || desc.length > 1) {
            dataMap[key].status = '8';
        }
    });

    overtimeTasks.forEach((ot) => {
        const key = parseDateKey(ot.date).key;
        if (dataMap[key]) dataMap[key].ot += Number(ot.duration) || 0;
    });

    // --- Style acuan dari template (kolom H = hari kerja, kolom M = weekend) ---
    const gridRows = [TS.whRow, TS.otRow, ...Object.values(TS.codeRows)];
    const styleOf = (r: number, c: number): Style => clone(ws.getCell(r, c).style);
    const st = {
        header: styleOf(TS.headerRow, 8),
        normal: styleOf(TS.whRow, 8),
        weekend: styleOf(TS.whRow, 13),
        totalNormal: styleOf(TS.totalRow, 8),
        totalWeekend: styleOf(TS.totalRow, 13),
    };
    const holidayStyle = (base: Style): Style => ({ ...clone(base), fill: FILL_HOLIDAY, font: { ...(base.font || {}), bold: true, color: { argb: 'FFFF0000' } } });

    for (let i = 0; i < TS.maxDays; i++) {
        const col = TS.firstDayCol + i;
        const h = days[i];
        const cells = [TS.headerRow, 12, ...gridRows, 21, TS.totalRow].map((r) => ws.getCell(r, col));
        if (!h) {
            // Periode < 31 hari: kolom sisa dikosongkan
            cells.forEach((c) => { c.value = null; c.style = {}; });
            continue;
        }
        const d = dataMap[h.key];
        const base = d.isHoliday ? holidayStyle(st.normal) : h.isWeekend ? st.weekend : st.normal;
        const totalBase = d.isHoliday ? holidayStyle(st.totalNormal) : h.isWeekend ? st.totalWeekend : st.totalNormal;

        const header = ws.getCell(TS.headerRow, col);
        header.style = clone(st.header);
        header.value = h.day;
        ws.getCell(21, col).value = null;

        gridRows.forEach((r) => {
            const c = ws.getCell(r, col);
            c.style = clone(base);
            c.value = null;
        });

        // WH: 8 untuk hari kerja, selain itu kode statusnya
        const wh = ws.getCell(TS.whRow, col);
        if (d.status === '8') wh.value = 8;
        else if (['AL', 'S', 'U', 'C', 'H', 'W'].includes(d.status)) wh.value = d.status;

        if (d.ot > 0) ws.getCell(TS.otRow, col).value = d.ot;
        if (TS.codeRows[d.status]) ws.getCell(TS.codeRows[d.status], col).value = d.status;

        const total = ws.getCell(TS.totalRow, col);
        total.style = clone(totalBase);
        const totalVal = (d.status === '8' ? 8 : 0) + d.ot;
        total.value = totalVal > 0 ? totalVal : null;
    }

    // --- Recap (range diseragamkan H:AL, kode Sick Leave = "S" sesuai baris 17) ---
    const sum = (pred: (d: { status: string; ot: number }) => number) => Object.values(dataMap).reduce((a, d) => a + pred(d), 0);
    const whHours = sum((d) => (d.status === '8' ? 8 : 0));
    const otHours = sum((d) => d.ot);
    const count = (code: string) => sum((d) => (d.status === code ? 1 : 0));

    setFormula(ws, 'H26', 'SUM(H13:AL13)', whHours);
    setFormula(ws, 'J26', 'H26/8', whHours / 8);
    setFormula(ws, 'H27', 'SUM(H14:AL14)', otHours);
    setFormula(ws, 'J27', 'H27/8', otHours / 8);
    ([['H', 28], ['AL', 29], ['S', 30], ['U', 31], ['C', 32]] as [string, number][]).forEach(([code, r]) => {
        const src = TS.codeRows[code];
        const f = `COUNTIF($H$${src}:$AL$${src},"${code}")`;
        setFormula(ws, `H${r}`, f, count(code));
        setFormula(ws, `J${r}`, f, count(code));
    });
    setFormula(ws, 'H33', 'SUM(H26:I27)', whHours + otHours);
    setFormula(ws, 'J33', 'SUM(J26:K27)', (whHours + otHours) / 8);

    // --- Tanda tangan ---
    setFormula(ws, 'N26', 'AC9', e.startMonth);
    setFormula(ws, 'Q26', 'AH9', e.endMonth);
    setFormula(ws, 'M32', 'AC7', e.name);
    setFormula(ws, 'S32', 'E9', e.supervisor);
    setFormula(ws, 'Y32', 'E8', e.deptHead);
    ['M33', 'S33', 'Y33'].forEach((a) => { ws.getCell(a).value = e.signDate; });

    return wb.xlsx.writeBuffer();
};

// ==========================================
// 2. MANDAYS CONSUMPTION REPORT
// ==========================================
const MD = {
    firstTaskRow: 12,
    tplTaskRow: 64,        // baris task bergaris penuh di template
    tplBlockA: [65, 67],   // Total Mandays Reguler, "B. Overtime", header overtime
    tplOtRow: 69,          // baris overtime
    tplBlockB: [70, 81],   // total overtime, recap, tanda tangan
    lastCol: 38,           // AL
    clearCols: 50,
};

interface RowSnapshot { height?: number; cells: { col: number; value: any; style: Style }[] }
interface BlockSnapshot { rows: RowSnapshot[]; merges: { top: number; left: number; bottom: number; right: number }[] }

const decodeRange = (range: string) => {
    const [a, b = a] = range.split(':');
    const parse = (ref: string) => {
        const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
        const col = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        return { col, row: Number(m[2]) };
    };
    const p1 = parse(a), p2 = parse(b);
    return { top: p1.row, left: p1.col, bottom: p2.row, right: p2.col };
};

const snapshotRows = (ws: ExcelJS.Worksheet, from: number, to: number): BlockSnapshot => {
    const rows: RowSnapshot[] = [];
    for (let r = from; r <= to; r++) {
        const row = ws.getRow(r);
        const cells: RowSnapshot['cells'] = [];
        for (let c = 1; c <= MD.clearCols; c++) {
            const cell = row.getCell(c);
            const isSlave = cell.isMerged && cell.master.address !== cell.address;
            cells.push({ col: c, value: isSlave ? null : clone(cell.value), style: clone(cell.style) });
        }
        rows.push({ height: row.height, cells });
    }
    const merges = (ws.model.merges as string[])
        .map(decodeRange)
        .filter((m) => m.top >= from && m.bottom <= to)
        .map((m) => ({ ...m, top: m.top - from, bottom: m.bottom - from }));
    return { rows, merges };
};

const pasteRows = (ws: ExcelJS.Worksheet, snap: BlockSnapshot, at: number) => {
    snap.merges.forEach((m) => ws.mergeCellsWithoutStyle(at + m.top, m.left, at + m.bottom, m.right));
    snap.rows.forEach((rs, i) => {
        const row = ws.getRow(at + i);
        if (rs.height) row.height = rs.height;
        rs.cells.forEach(({ col, value, style }) => {
            const cell = row.getCell(col);
            cell.style = clone(style);
            if (value !== null && value !== undefined) cell.value = clone(value);
        });
    });
};

export const generateMandaysExcel = async (
    employee: any,
    tasks: Task[],
    overtimeTasks: OvertimeTask[],
    customHolidays: string[] = []
) => {
    const e = resolveEmployee(employee);
    const { wb, ws } = await loadTemplate(SHEET_MANDAYS);
    fillDataSheet(wb, e);
    fillReportHeader(ws, e, { value: 'AE', to: 'AI' });

    // --- Snapshot bagian template yang akan ditulis ulang ---
    const taskStyle = snapshotRows(ws, MD.tplTaskRow, MD.tplTaskRow).rows[0].cells.map((c) => c.style);
    const otStyle = snapshotRows(ws, MD.tplOtRow, MD.tplOtRow).rows[0].cells.map((c) => c.style);
    const taskHeight = ws.getRow(MD.tplTaskRow).height || 29;
    const otHeight = ws.getRow(MD.tplOtRow).height || 29;
    const emptyOtBlock = snapshotRows(ws, MD.tplOtRow - 1, MD.tplOtRow);
    const blockA = snapshotRows(ws, MD.tplBlockA[0], MD.tplBlockA[1]);
    const blockB = snapshotRows(ws, MD.tplBlockB[0], MD.tplBlockB[1]);

    // --- Bersihkan area dinamis (baris 12 ke bawah) ---
    (ws.model.merges as string[]).filter((r) => decodeRange(r).top >= MD.firstTaskRow).forEach((r) => ws.unMergeCells(r));
    const clearUntil = Math.max(ws.rowCount, MD.tplBlockB[1]);
    for (let r = MD.firstTaskRow; r <= clearUntil; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= MD.clearCols; c++) { const cell = row.getCell(c); cell.value = null; cell.style = {}; }
        row.height = 15.75;
    }

    const writeRow = (r: number, styles: Style[], height: number) => {
        const row = ws.getRow(r);
        row.height = height;
        styles.forEach((s, i) => { row.getCell(i + 1).style = clone(s); });
        return row;
    };
    const linkValue = (text: string, link?: string): ExcelJS.CellValue => (link ? { text, hyperlink: link } : text);

    // --- A. Regular ---
    const HOLIDAYS = resolveHolidayDates(customHolidays);
    const allTasks = enrichTasksWithApiHolidays(employee, tasks, HOLIDAYS);
    const grouped: Record<string, { tasks: Task[]; display: string; timestamp: number }> = {};
    allTasks.forEach((t) => {
        const { key, display, timestamp } = parseDateKey(t.date);
        if (!grouped[key]) grouped[key] = { tasks: [], display, timestamp };
        grouped[key].tasks.push(t);
    });
    const sortedKeys = Object.keys(grouped).sort((a, b) => grouped[a].timestamp - grouped[b].timestamp);

    let r = MD.firstTaskRow;
    let no = 1;
    let totalMandays = 0;
    sortedKeys.forEach((key) => {
        const g = grouped[key];
        const skip = isNonCountableMandayDay(g.tasks, key, HOLIDAYS);
        if (!skip) totalMandays += 1;
        const start = r;
        g.tasks.forEach((t, i) => {
            const row = writeRow(r, taskStyle, taskHeight);
            if (i === 0) {
                row.getCell(1).value = no;
                row.getCell(2).value = g.display;
                row.getCell(2).numFmt = '@';
                row.getCell(22).value = skip ? null : 1;
            }
            row.getCell(4).value = t.description || '';
            const ticket = t.ticketNumber || '';
            row.getCell(24).value = ticket || t.ticketLink ? linkValue(ticket || 'Link', t.ticketLink) : null;
            ws.mergeCellsWithoutStyle(r, 4, r, 21);   // D:U
            ws.mergeCellsWithoutStyle(r, 24, r, 31);  // X:AE
            ws.mergeCellsWithoutStyle(r, 32, r, 34);  // AF:AH
            ws.mergeCellsWithoutStyle(r, 35, r, 38);  // AI:AL
            r++;
        });
        const end = r - 1;
        ws.mergeCellsWithoutStyle(start, 1, end, 1);   // No.
        ws.mergeCellsWithoutStyle(start, 2, end, 3);   // Date
        ws.mergeCellsWithoutStyle(start, 22, end, 23); // Duration
        no++;
    });
    if (r === MD.firstTaskRow) {
        // Tidak ada task: satu baris kosong agar tabel tetap utuh
        writeRow(r, taskStyle, taskHeight);
        [[4, 21], [24, 31], [32, 34], [35, 38], [2, 3], [22, 23]].forEach(([a, b]) => ws.mergeCellsWithoutStyle(r, a, r, b));
        r++;
    }
    const lastTaskRow = r - 1;

    // Total Mandays Reguler, "B. Overtime", header overtime
    const totalRegRow = r;
    pasteRows(ws, blockA, totalRegRow);
    setFormula(ws, `V${totalRegRow}`, `SUM(V${MD.firstTaskRow}:W${lastTaskRow})`, totalMandays);
    r += blockA.rows.length;

    // --- B. Overtime ---
    const sortedOt = [...(overtimeTasks || [])].sort((a, b) => parseDateKey(a.date).timestamp - parseDateKey(b.date).timestamp);
    const otFirst = r;
    let totalOtHours = 0;
    if (sortedOt.length === 0) {
        pasteRows(ws, emptyOtBlock, r);
        r += emptyOtBlock.rows.length;
    }
    for (let i = 0; i < sortedOt.length; i++) {
        const row = writeRow(r, otStyle, otHeight);
        const ot = sortedOt[i];
        if (ot) {
            const dur = parseFloat(String(ot.duration)) || 0;
            totalOtHours += dur;
            row.getCell(1).value = i + 1;
            row.getCell(2).value = parseDateKey(ot.date).display;
            row.getCell(2).numFmt = '@';
            row.getCell(4).value = ot.description || '';
            row.getCell(22).value = dur || null;
            if (ot.ticketLink) {
                row.getCell(24).value = linkValue('Link', ot.ticketLink);
                row.getCell(24).font = clone(taskStyle[23].font) || {};
            }
            row.getCell(35).value = ot.remarks || '';
        }
        [[2, 3], [4, 21], [22, 23], [24, 31], [32, 34], [35, 38]].forEach(([a, b]) => ws.mergeCellsWithoutStyle(r, a, r, b));
        r++;
    }
    const otLast = r - 1;

    // Total overtime, recap, tanda tangan
    const b0 = r;
    pasteRows(ws, blockB, b0);
    const otTotalH = b0, otTotalD = b0 + 1, recapReg = b0 + 4, recapOt = b0 + 5, recapTotal = b0 + 6, signName = b0 + 10, signDate = b0 + 11;
    setFormula(ws, `V${otTotalH}`, `SUM(V${otFirst}:W${otLast})`, totalOtHours);
    setFormula(ws, `V${otTotalD}`, `V${otTotalH}/8`, totalOtHours / 8);
    setFormula(ws, `J${recapReg}`, `V${totalRegRow}`, totalMandays);
    setFormula(ws, `H${recapReg}`, `J${recapReg}*8`, totalMandays * 8);
    setFormula(ws, `N${recapReg}`, 'AE9', e.startMonth);
    setFormula(ws, `Q${recapReg}`, 'AI9', e.endMonth);
    setFormula(ws, `H${recapOt}`, `V${otTotalH}`, totalOtHours);
    setFormula(ws, `J${recapOt}`, `V${otTotalD}`, totalOtHours / 8);
    setFormula(ws, `H${recapTotal}`, `SUM(H${recapReg}:I${recapOt})`, totalMandays * 8 + totalOtHours);
    setFormula(ws, `J${recapTotal}`, `SUM(J${recapReg}:K${recapOt})`, totalMandays + totalOtHours / 8);
    setFormula(ws, `M${signName}`, 'AE7', e.name);
    setFormula(ws, `S${signName}`, 'E9', e.supervisor);
    setFormula(ws, `Y${signName}`, 'E8', e.deptHead);
    [`M${signDate}`, `S${signDate}`, `Y${signDate}`].forEach((a) => { ws.getCell(a).value = e.signDate; });

    return wb.xlsx.writeBuffer();
};

/** Nama file mengikuti format dokumen resmi: YYYY_MM_<NO>_<NAMA>.xlsx */
export const buildReportFilename = (employee: any, suffix = '') => {
    const { endDate } = getTimesheetPeriodBounds(employee);
    const name = String((employee.reportName && String(employee.reportName).trim()) || employee.name || 'EXPORT').toUpperCase();
    return `${endDate.format('YYYY_MM')}_${employee.no || ''}_${name}${suffix}.xlsx`.replace(/[\\/:*?"<>|]/g, '');
};

// Template wajib ikut ter-bundle saat deploy
if (!fs.existsSync(TEMPLATE_PATH)) {
    console.warn(`⚠️ Template Excel tidak ditemukan: ${TEMPLATE_PATH}`);
}
