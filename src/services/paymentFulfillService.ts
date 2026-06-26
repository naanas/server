import { Invoice } from '../config/xendit';
import { supabase } from '../dbconfig/supabase';
import { generatePdfBuffer } from './pdfService';
import { sendEmailWithPdf } from './emailService';
import { getTasksFromDB } from './dbService';
import { getIndonesianHolidays } from './holidayService';
import { generatePreview } from '../htmlGenerator';
import type { OvertimeTask, Task } from '../templates/htmlHelpers';

type TransactionRow = {
    id: string;
    external_id: string;
    customer_email: string;
    status: string;
    type: string;
    payload: {
        employee?: { name?: string; periodStart?: string; periodEnd?: string };
        tasks?: unknown[];
        overtimeTasks?: unknown[];
        emailSentAt?: string;
    };
};

const isPaidStatus = (status: string | undefined) =>
    String(status || '').toUpperCase() === 'PAID';

export const verifyXenditPaid = async (externalId: string): Promise<boolean> => {
    const invoices = await Invoice.getInvoices({ externalId });
    return invoices.some((inv) => isPaidStatus(inv.status));
};

export const fulfillPaidTransaction = async (
    externalId: string
): Promise<{ ok: boolean; message: string; alreadyDone?: boolean }> => {
    const { data: trx, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('external_id', externalId)
        .single();

    if (error || !trx) {
        return { ok: false, message: 'Transaksi tidak ditemukan' };
    }

    const row = trx as TransactionRow;

    if (row.payload?.emailSentAt) {
        return { ok: true, alreadyDone: true, message: 'PDF sudah dikirim ke email' };
    }

    if (!isPaidStatus(row.status)) {
        const paidOnXendit = await verifyXenditPaid(externalId);
        if (!paidOnXendit) {
            return { ok: false, message: 'Pembayaran belum lunas di Xendit' };
        }
    }

    const { employee, tasks: savedTasks, overtimeTasks } = row.payload || {};
    const type = row.type;

    let combinedRegularTasks = [...(savedTasks || [])];
    if (employee?.name) {
        try {
            const dbTasks = await getTasksFromDB(
                employee.name,
                employee.periodStart!,
                employee.periodEnd!
            );
            const mappedTasks = dbTasks.map((t: any) => ({
                date: t.date,
                description: t.description,
                ticketNumber: t.ticket_number,
                ticketLink: t.ticket_link,
            }));
            combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
        } catch (err) {
            console.warn('Fulfill DB Fetch Error:', err);
        }
    }

    const year = new Date(employee?.periodEnd || Date.now()).getFullYear();
    const holidays = await getIndonesianHolidays(year);

    const htmlContent = generatePreview(
        type,
        employee,
        combinedRegularTasks as Task[],
        (overtimeTasks || []) as OvertimeTask[],
        holidays
    );
    const pdfBuffer = await generatePdfBuffer(htmlContent);

    const filename = `${type.toUpperCase()}_${employee?.name || 'Report'}.pdf`;
    await sendEmailWithPdf(row.customer_email, `Download ${filename}`, pdfBuffer, filename);

    await supabase
        .from('transactions')
        .update({
            status: 'PAID',
            updated_at: new Date(),
            payload: {
                ...row.payload,
                emailSentAt: new Date().toISOString(),
            },
        })
        .eq('id', row.id);

    console.log(`✅ PDF dikirim ke ${row.customer_email} (${externalId})`);
    return { ok: true, message: `PDF dikirim ke ${row.customer_email}` };
};
