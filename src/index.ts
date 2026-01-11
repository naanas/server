import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// --- 1. IMPORT DB CONFIG ---
import { supabase } from './dbconfig/supabase'; 

// --- 2. IMPORT GENERATORS ---
import { generatePreview } from './htmlGenerator'; 
import { generateTimesheetExcel, generateMandaysExcel } from './excelGenerator';

// --- 3. IMPORT SERVICES ---
import { generateProfessionalDescription } from './services/aiService';
import { syncCsvToSupabase } from './services/syncService';
import { getReportersFromDB, getTasksFromDB } from './services/dbService';
import { getIndonesianHolidays } from './services/holidayService';

// --- 4. IMPORT PAYMENT SERVICES ---
import { createInvoice } from './services/paymentService';
import { generatePdfBuffer } from './services/pdfService';
import { sendEmailWithPdf } from './services/emailService';

// --- CONFIGURATION ---
const app = express();

if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

// --- MIDDLEWARE ---
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

// ====================================================
// 🔐 ROUTES AUTH
// ====================================================

app.post('/api/auth/register', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Success', user: data.user, session: data.session });
});

app.post('/api/auth/login', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ session: data.session, user: data.user });
});

app.get('/api/auth/me', async (req: Request, res: Response): Promise<any> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error) return res.status(401).json({ error: 'Invalid token' });
    res.json({ user: data.user });
});

app.post('/api/auth/logout', async (req: Request, res: Response): Promise<any> => {
    await supabase.auth.signOut();
    res.json({ message: 'Logged out' });
});

// ====================================================
// 🔄 ROUTES SYNC & DATA
// ====================================================

app.post('/api/sync', async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await syncCsvToSupabase();
        res.json(result);
    } catch (error: any) {
        console.error("Sync Error:", error);
        res.status(500).json({ error: error.message || 'Gagal Sync Data' });
    }
});

app.get('/api/assignees', async (req: Request, res: Response): Promise<any> => {
    try {
        const list = await getReportersFromDB();
        res.json(list);
    } catch (error) {
        console.error("Fetch Reporters Error:", error);
        res.status(500).json({ error: 'Gagal ambil data reporter dari DB' });
    }
});

// ====================================================
// 💸 ROUTES PAYMENT & WEBHOOK (INTEGRASI XENDIT)
// ====================================================

// 1. Create Invoice (Frontend Request Link Bayar)
app.post('/api/payment/create', async (req: Request, res: Response): Promise<any> => {
    try {
        // Terima user_id dan paymentCategory dari frontend
        const { employee, tasks, overtimeTasks, type, email, user_id, paymentCategory } = req.body;
        
        if (!email) return res.status(400).json({ error: "Email wajib diisi!" });
        
        // --- LOGIKA HARGA & FEE ---
        
        // 1. Base Price (Harga Jasa)
        let basePrice = type === 'mandays' ? 25000 : 20000; 

        // 2. Admin Fee & Allowed Methods
        let adminFee = 4500; 
        let allowedMethods: string[] = [];

        // Ambil Config dari DB
        let priceMap: any = {};
        try {
            const { data: pricingData } = await supabase.from('pricing_config').select('key, value');
            if (pricingData) pricingData.forEach((p: any) => priceMap[p.key] = Number(p.value));
            
            if (type === 'mandays' && priceMap.mandays_price) basePrice = priceMap.mandays_price;
            if (type === 'timesheet' && priceMap.timesheet_price) basePrice = priceMap.timesheet_price;
        } catch (e) { console.warn("DB Price Error", e); }

        // --- UPDATE LOGIC DISINI ---
        // Menambahkan kembali E-Wallet spesifik
        switch (paymentCategory) {
            case 'qris':
                // Fee: Rp 1.000 (Cover QRIS & E-Wallet)
                adminFee = priceMap.fee_qris || 1000;
                
                // Tambahkan semua E-Wallet populer.
                // Jika error 400 lagi, berarti salah satu dari ini statusnya OFF di dashboard Xendit kamu.
                allowedMethods = ['QRIS', 'GOPAY', 'SHOPEEPAY', 'OVO', 'DANA', 'LINKAJA']; 
                break;

            case 'retail':
                // Fee: Rp 6.500 (Cover Indomaret/Alfamart)
                adminFee = priceMap.fee_retail || 6500;
                allowedMethods = ['ALFAMART', 'INDOMARET'];
                break;

            case 'va':
            default:
                // Fee: Rp 4.500 (Cover VA)
                adminFee = priceMap.fee_va || 4500;
                // Tambahkan Bank BSI, CIMB, dll jika di dashboard aktif
                allowedMethods = ['BCA', 'BNI', 'BRI', 'MANDIRI', 'PERMATA', 'CIMB', 'BSI', 'BJB'];
                break;
        }

        const totalAmount = basePrice + adminFee; 
        const externalId = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const description = `Export ${type ? type.toUpperCase() : 'DOC'} (Service Fee: Rp ${adminFee})`;

        // a. Create Xendit Invoice
        const invoice = await createInvoice(externalId, totalAmount, email, description, allowedMethods);

        // b. Simpan ke DB
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
        // Tampilkan pesan error detail jika dari Xendit (misal method not available)
        const msg = error.response?.message || error.message || "Terjadi kesalahan pembayaran";
        res.status(500).json({ error: msg });
    }
});

// 2. Webhook Xendit (Dipanggil Xendit saat LUNAS)
app.post('/api/payment/webhook', async (req: Request, res: Response): Promise<any> => {
    try {
        const { external_id, status } = req.body;
        console.log(`🔔 Webhook masuk: ${external_id} status ${status}`);

        if (status === 'PAID') {
            // a. Ambil Data Transaksi dari DB
            const { data: trx, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('external_id', external_id)
                .single();

            if (error || !trx) return res.status(404).send('Transaction Not Found');

            // Cek double process
            if (trx.status === 'PAID') return res.status(200).json({ message: 'Already processed' });

            // b. Update Status DB jadi PAID
            await supabase.from('transactions')
                .update({ status: 'PAID', updated_at: new Date() })
                .eq('id', trx.id);

            // c. Generate PDF (Server Side Logic)
            const { employee, tasks: savedTasks, overtimeTasks } = trx.payload;
            const type = trx.type;

            // --- RE-FETCH DB LOGIC ---
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

            // Fetch Holidays
            const year = new Date(employee.periodEnd).getFullYear();
            const holidays = await getIndonesianHolidays(year);

            // Generate HTML String
            const htmlContent = generatePreview(type, employee, combinedRegularTasks, overtimeTasks, holidays);

            // Convert to PDF Buffer (Puppeteer)
            const pdfBuffer = await generatePdfBuffer(htmlContent);

            // d. Kirim Email
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

// ====================================================
// 📄 ROUTES PREVIEW HTML
// ====================================================

app.post('/api/preview-html', async (req: Request, res: Response): Promise<any> => {
  try {
    const { type, employee, tasks: manualTasks, overtimeTasks } = req.body;
    let combinedRegularTasks = [...(manualTasks || [])];

    if (employee.name) {
        try {
            const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
            const mappedTasks = dbTasks.map((t: any) => ({
                date: t.date, description: t.description, ticketNumber: t.ticket_number, ticketLink: t.ticket_link
            }));
            combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
        } catch (err) { console.warn("[DB Preview] Failed:", err); }
    }

    let holidays: string[] = [];
    if (type === 'timesheet') {
        const targetYear = employee.periodEnd ? new Date(employee.periodEnd).getFullYear() : new Date().getFullYear();
        holidays = await getIndonesianHolidays(targetYear);
    }

    const htmlString = generatePreview(type || 'mandays', employee, combinedRegularTasks, overtimeTasks || [], holidays);
    res.send(htmlString);

  } catch (error) {
    console.error('Error Preview:', error);
    res.status(500).send('Server Error');
  }
});

// ====================================================
// 📎 ROUTES UTILS (Excel & AI)
// ====================================================

app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks: manualTasks, overtimeTasks } = req.body;
        let combinedRegularTasks = [...(manualTasks || [])];
        if (employee.name) {
            try {
                const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                const mappedTasks = dbTasks.map((t: any) => ({
                    date: t.date, description: t.description, ticketNumber: t.ticket_number, ticketLink: t.ticket_link
                }));
                combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            } catch (err) { console.warn("DB Fetch Error Excel:", err); }
        }
        const year = employee.periodEnd ? new Date(employee.periodEnd).getFullYear() : new Date().getFullYear();
        const holidays = await getIndonesianHolidays(year);
        const buffer = await generateTimesheetExcel(employee, combinedRegularTasks, overtimeTasks, holidays);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Timesheet_${employee.name || 'Export'}.xlsx`);
        res.send(buffer);
    } catch (error) { res.status(500).send('Error Generate Excel'); }
});

app.post('/api/generate-mandays', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks: manualTasks, overtimeTasks } = req.body;
        let combinedRegularTasks = [...(manualTasks || [])];
        if (employee.name) {
            try {
                const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                const mappedTasks = dbTasks.map((t: any) => ({
                    date: t.date, description: t.description, ticketNumber: t.ticket_number, ticketLink: t.ticket_link
                }));
                combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            } catch (err) { console.warn("DB Fetch Error Excel Mandays:", err); }
        }
        const buffer = await generateMandaysExcel(employee, combinedRegularTasks, overtimeTasks);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Mandays_${employee.name || 'Export'}.xlsx`);
        res.send(buffer);
    } catch (error) { res.status(500).send('Error Generate Excel Mandays'); }
});

app.post('/api/enhance-description', async (req: Request, res: Response): Promise<any> => {
    try {
      const { text } = req.body;
      const enhancedText = await generateProfessionalDescription(text);
      res.json({ text: enhancedText });
    } catch (error) { res.status(500).send('AI Error'); }
});

// ====================================================
// 📊 ROUTES HISTORY & PRICING
// ====================================================

app.get('/api/history', async (req: Request, res: Response): Promise<any> => {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: "User ID parameter required" });

    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId) 
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) throw error;
        res.json(data);
    } catch (error) { res.status(500).json({ error: "Gagal mengambil history" }); }
});

app.post('/api/payment/check-status', async (req: Request, res: Response): Promise<any> => {
    try {
        const { external_id } = req.body;
        const { data: trx } = await supabase.from('transactions').select('*').eq('external_id', external_id).single();
        if (!trx) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
        res.json({ status: trx.status }); 
    } catch (e) { res.status(500).json({ error: "Gagal cek status" }); }
});

app.get('/api/pricing', async (req: Request, res: Response): Promise<any> => {
    try {
        const { data, error } = await supabase.from('pricing_config').select('*');
        if (error) throw error;
        const pricingMap: any = {};
        data.forEach((item: any) => { pricingMap[item.key] = item.value; });
        res.json(pricingMap);
    } catch (error) { res.status(500).json({ error: "Gagal ambil harga" }); }
});

app.post('/api/pricing/update', async (req: Request, res: Response): Promise<any> => {
    const { user_id, updates } = req.body;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    try {
        const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user_id).single();
        if (error || !profile || profile.role !== 'admin') return res.status(403).json({ error: "Unauthorized" });

        for (const update of updates) {
            await supabase.from('pricing_config')
                .update({ value: update.value, updated_at: new Date(), updated_by: user_id })
                .eq('key', update.key);
        }
        res.json({ message: "Updated" });
    } catch (error) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/', (req, res) => {
    res.send('🚀 Backend Timesheet (With Payment & Excel) is Running!');
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

export default app;