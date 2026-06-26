import express, { Request, Response } from 'express';
import { supabase } from '../dbconfig/supabase';
import { createInvoice } from '../services/paymentService';
import { fulfillPaidTransaction } from '../services/paymentFulfillService';

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
        const external_id = req.body.external_id || req.body.externalId;
        const status = String(req.body.status || '').toUpperCase();
        console.log(`🔔 Webhook masuk: ${external_id} status ${status}`);

        if (status === 'PAID' && external_id) {
            const result = await fulfillPaidTransaction(external_id);
            if (!result.ok && !result.alreadyDone) {
                console.error('Webhook fulfill gagal:', result.message);
                return res.status(500).send(result.message);
            }
        }

        res.status(200).json({ message: 'Webhook received' });
    } catch (error) {
        console.error('Webhook Failed:', error);
        res.status(500).send('Webhook Processing Error');
    }
});

// 3. Fallback: proses PDF + email setelah redirect sukses (jika webhook Xendit telat/gagal)
router.post('/fulfill', async (req: Request, res: Response): Promise<any> => {
    try {
        const { external_id } = req.body;
        if (!external_id) {
            return res.status(400).json({ error: 'external_id wajib diisi' });
        }

        const result = await fulfillPaidTransaction(external_id);
        if (!result.ok) {
            return res.status(400).json({ error: result.message });
        }

        res.json(result);
    } catch (error: any) {
        console.error('Fulfill error:', error);
        res.status(500).json({ error: error.message || 'Gagal memproses PDF' });
    }
});

router.post('/check-status', async (req: Request, res: Response): Promise<any> => {
    try {
        const { external_id } = req.body;
        const { data: trx } = await supabase
            .from('transactions')
            .select('*')
            .eq('external_id', external_id)
            .single();
        if (!trx) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });

        if (!trx.payload?.emailSentAt) {
            const result = await fulfillPaidTransaction(external_id);
            if (result.ok) {
                return res.json({ status: 'PAID', message: result.message });
            }
        }

        res.json({ status: trx.status });
    } catch (e) {
        res.status(500).json({ error: 'Gagal cek status' });
    }
});

export default router;
