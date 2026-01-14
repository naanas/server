import express, { Request, Response } from 'express';
import { supabase } from '../dbconfig/supabase';
import { createInvoice } from '../services/paymentService';
import { generatePdfBuffer } from '../services/pdfService';
import { sendEmailWithPdf } from '../services/emailService';
import { getTasksFromDB } from '../services/dbService';
import { getIndonesianHolidays } from '../services/holidayService';
import { generatePreview } from '../htmlGenerator';

const router = express.Router();

// 1. Create Invoice
router.post('/create', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks, overtimeTasks, type, email, user_id, paymentCategory } = req.body;

        if (!email) return res.status(400).json({ error: "Email wajib diisi!" });

        let basePrice = type === 'mandays' ? 25000 : 20000;
        let adminFee = 4500;
        let allowedMethods: string[] = [];

        let priceMap: any = {};
        try {
            const { data: pricingData } = await supabase.from('pricing_config').select('key, value');
            if (pricingData) pricingData.forEach((p: any) => priceMap[p.key] = Number(p.value));

            if (type === 'mandays' && priceMap.mandays_price) basePrice = priceMap.mandays_price;
            if (type === 'timesheet' && priceMap.timesheet_price) basePrice = priceMap.timesheet_price;
        } catch (e) { console.warn("DB Price Error", e); }

        switch (paymentCategory) {
            case 'qris':
                adminFee = priceMap.fee_qris || 1000;
                allowedMethods = ['QRIS', 'GOPAY', 'SHOPEEPAY', 'OVO', 'DANA', 'LINKAJA'];
                break;
            case 'retail':
                adminFee = priceMap.fee_retail || 6500;
                allowedMethods = ['ALFAMART', 'INDOMARET'];
                break;
            case 'va':
            default:
                adminFee = priceMap.fee_va || 4500;
                allowedMethods = ['BCA', 'BNI', 'BRI', 'MANDIRI', 'PERMATA', 'CIMB', 'BSI', 'BJB'];
                break;
        }

        const totalAmount = basePrice + adminFee;
        const externalId = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const description = `Export ${type ? type.toUpperCase() : 'DOC'} (Service Fee: Rp ${adminFee})`;

        const invoice = await createInvoice(externalId, totalAmount, email, description, allowedMethods);

        const { error } = await supabase.from('transactions').insert({
            external_id: externalId,
            amount: totalAmount,
            admin_fee: adminFee,
            customer_email: email,
            user_id: user_id,
            type: type || 'timesheet',
            status: 'PENDING',
            payload: { employee, tasks, overtimeTasks, paymentCategory }
        });

        if (error) {
            console.error("DB Transaction Error:", error);
            return res.status(500).json({ error: "Gagal menyimpan transaksi" });
        }

        res.json({ invoiceUrl: invoice.invoiceUrl });

    } catch (error: any) {
        console.error("Create Payment Error:", error);
        const msg = error.response?.message || error.message || "Terjadi kesalahan pembayaran";
        res.status(500).json({ error: msg });
    }
});

// 2. Webhook Xendit
router.post('/webhook', async (req: Request, res: Response): Promise<any> => {
    try {
        const { external_id, status } = req.body;
        console.log(`🔔 Webhook masuk: ${external_id} status ${status}`);

        if (status === 'PAID') {
            const { data: trx, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('external_id', external_id)
                .single();

            if (error || !trx) return res.status(404).send('Transaction Not Found');
            if (trx.status === 'PAID') return res.status(200).json({ message: 'Already processed' });

            await supabase.from('transactions')
                .update({ status: 'PAID', updated_at: new Date() })
                .eq('id', trx.id);

            const { employee, tasks: savedTasks, overtimeTasks } = trx.payload;
            const type = trx.type;

            let combinedRegularTasks = [...(savedTasks || [])];
            if (employee.name) {
                try {
                    const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                    const mappedTasks = dbTasks.map((t: any) => ({
                        date: t.date, description: t.description, ticketNumber: t.ticket_number, ticketLink: t.ticket_link
                    }));
                    combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
                } catch (err) { console.warn("Webhook DB Fetch Error:", err); }
            }

            const year = new Date(employee.periodEnd).getFullYear();
            const holidays = await getIndonesianHolidays(year);

            const htmlContent = generatePreview(type, employee, combinedRegularTasks, overtimeTasks, holidays);
            const pdfBuffer = await generatePdfBuffer(htmlContent);

            const filename = `${type.toUpperCase()}_${employee.name || 'Report'}.pdf`;
            await sendEmailWithPdf(trx.customer_email, `Download ${filename}`, pdfBuffer, filename);

            console.log(`✅ Sukses kirim PDF ke ${trx.customer_email}`);
        }

        res.status(200).json({ message: 'Webhook received' });
    } catch (error) {
        console.error("Webhook Failed:", error);
        res.status(500).send('Webhook Processing Error');
    }
});

router.post('/check-status', async (req: Request, res: Response): Promise<any> => {
    try {
        const { external_id } = req.body;
        const { data: trx } = await supabase.from('transactions').select('*').eq('external_id', external_id).single();
        if (!trx) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
        res.json({ status: trx.status });
    } catch (e) { res.status(500).json({ error: "Gagal cek status" }); }
});

export default router;
