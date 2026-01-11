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

// --- 4. IMPORT PAYMENT SERVICES (INI YANG KEMAREN HILANG) ---
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
        // Terima user_id dari frontend
        const { employee, tasks, overtimeTasks, type, email, user_id } = req.body;
        
        if (!email) return res.status(400).json({ error: "Email wajib diisi!" });
        // if (!user_id) return res.status(400).json({ error: "User ID wajib ada!" }); // Opsional strict check

        const externalId = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const amount = 20000; 

        // a. Create Xendit Invoice
        const invoice = await createInvoice(externalId, amount, email);

        // b. Simpan ke DB dengan USER_ID
        const { error } = await supabase.from('transactions').insert({
            external_id: externalId,
            amount: amount,
            customer_email: email, // Email tujuan PDF
            user_id: user_id,      // ID Akun yang login (PENTING)
            type: type || 'timesheet',
            status: 'PENDING',
            payload: { employee, tasks, overtimeTasks } 
        });

        if (error) {
            console.error("DB Transaction Error:", error);
            return res.status(500).json({ error: "Gagal menyimpan transaksi" });
        }

        res.json({ invoiceUrl: invoice.invoiceUrl });

    } catch (error: any) {
        console.error("Create Payment Error:", error);
        res.status(500).json({ error: "Terjadi kesalahan pembayaran" });
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

            // --- RE-FETCH DB LOGIC (Agar data PDF lengkap sama seperti Preview/Excel) ---
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
    
    // Gabung Manual Input + DB Data
    let combinedRegularTasks = [...(manualTasks || [])];

    if (employee.name) {
        try {
            const dbTasks = await getTasksFromDB(
                employee.name,
                employee.periodStart,
                employee.periodEnd
            );
            
            const mappedTasks = dbTasks.map((t: any) => ({
                date: t.date,
                description: t.description,
                ticketNumber: t.ticket_number,
                ticketLink: t.ticket_link
            }));

            combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
        } catch (err) {
            console.warn("[DB Preview] Failed:", err);
        }
    }

    // Fetch Libur jika Timesheet
    let holidays: string[] = [];
    if (type === 'timesheet') {
        const targetYear = employee.periodEnd 
            ? new Date(employee.periodEnd).getFullYear() 
            : new Date().getFullYear();
            
        holidays = await getIndonesianHolidays(targetYear);
    }

    const htmlString = generatePreview(
        type || 'mandays', 
        employee, 
        combinedRegularTasks, 
        overtimeTasks || [],
        holidays 
    );
    
    res.send(htmlString);

  } catch (error) {
    console.error('Error Preview:', error);
    res.status(500).send('Server Error');
  }
});


// ====================================================
// 📎 ROUTES UTILS (Excel & AI)
// ====================================================

// Route Excel Timesheet
app.post('/api/generate-timesheet', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks: manualTasks, overtimeTasks } = req.body;

        // 1. FETCH DATA DB (Fix: Agar tidak kosong)
        let combinedRegularTasks = [...(manualTasks || [])];
        if (employee.name) {
            try {
                const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                const mappedTasks = dbTasks.map((t: any) => ({
                    date: t.date,
                    description: t.description,
                    ticketNumber: t.ticket_number,
                    ticketLink: t.ticket_link
                }));
                combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            } catch (err) { console.warn("DB Fetch Error Excel:", err); }
        }

        // 2. Fetch Libur
        const year = employee.periodEnd ? new Date(employee.periodEnd).getFullYear() : new Date().getFullYear();
        const holidays = await getIndonesianHolidays(year);

        // 3. Generate Excel
        const buffer = await generateTimesheetExcel(employee, combinedRegularTasks, overtimeTasks, holidays);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Timesheet_${employee.name || 'Export'}.xlsx`);
        res.send(buffer);

    } catch (error) {
        console.error('Error Excel Timesheet:', error);
        res.status(500).send('Error Generate Excel');
    }
});

// Route Excel Mandays
app.post('/api/generate-mandays', async (req: Request, res: Response): Promise<any> => {
    try {
        const { employee, tasks: manualTasks, overtimeTasks } = req.body;

        // 1. FETCH DATA DB (Fix: Agar tidak kosong)
        let combinedRegularTasks = [...(manualTasks || [])];
        if (employee.name) {
            try {
                const dbTasks = await getTasksFromDB(employee.name, employee.periodStart, employee.periodEnd);
                const mappedTasks = dbTasks.map((t: any) => ({
                    date: t.date,
                    description: t.description,
                    ticketNumber: t.ticket_number,
                    ticketLink: t.ticket_link
                }));
                combinedRegularTasks = [...mappedTasks, ...combinedRegularTasks];
            } catch (err) { console.warn("DB Fetch Error Excel Mandays:", err); }
        }

        // 2. Generate Excel Mandays
        const buffer = await generateMandaysExcel(employee, combinedRegularTasks, overtimeTasks);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Mandays_${employee.name || 'Export'}.xlsx`);
        res.send(buffer);

    } catch (error) {
        console.error('Error Excel Mandays:', error);
        res.status(500).send('Error Generate Excel Mandays');
    }
});

app.post('/api/enhance-description', async (req: Request, res: Response): Promise<any> => {
    try {
      const { text } = req.body;
      const enhancedText = await generateProfessionalDescription(text);
      res.json({ text: enhancedText });
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).send('AI Error');
    }
});

app.get('/api/history', async (req: Request, res: Response): Promise<any> => {
    const userId = req.query.user_id as string;
    
    if (!userId) {
        return res.status(400).json({ error: "User ID parameter required" });
    }

    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId) // Filter punya user yang login
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error("Fetch History Error:", error);
        res.status(500).json({ error: "Gagal mengambil history" });
    }
});

app.post('/api/payment/check-status', async (req: Request, res: Response): Promise<any> => {
    try {
        const { external_id } = req.body;
        // Cari transaksi di DB
        const { data: trx } = await supabase.from('transactions').select('*').eq('external_id', external_id).single();
        
        if (!trx) return res.status(404).json({ error: "Transaksi tidak ditemukan" });

        // Jika sudah PAID, kembalikan saja
        if (trx.status === 'PAID') return res.json({ status: 'PAID' });

        // Jika masih PENDING, Cek ke Xendit (Optional: Butuh Xendit Client di sini)
        // Untuk simplifikasi, kita anggap endpoint ini hanya trigger re-fetch dari sisi client
        // Tapi idealnya kita panggil API Xendit Get Invoice di sini.
        // Karena kode Xendit Client ada di service lain, kita skip logic call Xendit API demi kesederhanaan,
        // user cukup refresh tabel. Atau kalau mau canggih, panggil service getInvoice.
        
        res.json({ status: trx.status }); 
    } catch (e) {
        res.status(500).json({ error: "Gagal cek status" });
    }
});

app.get('/', (req, res) => {
    res.send('🚀 Backend Timesheet (With Payment & Excel) is Running!');
});

// --- SERVER LISTENER ---
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

export default app;