import { Xendit } from 'xendit-node';
import dotenv from 'dotenv';
dotenv.config();

const xenditClient = new Xendit({
    secretKey: process.env.XENDIT_SECRET_KEY as string,
});

const { Invoice } = xenditClient;

export const createInvoice = async (externalId: string, amount: number, email: string, description?: string) => {
    // Tentukan URL Frontend kamu (Ganti jika sudah deploy ke Vercel)
    // Contoh Local: http://localhost:5173
    // Contoh Prod: https://timesheet-app.vercel.app
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const response = await Invoice.createInvoice({
        data: {
            externalId: externalId,
            amount: amount,
            description: description || 'Export Premium PDF Timesheet/Mandays',
            payerEmail: email,
            invoiceDuration: 86400, 
            currency: "IDR",
            // INI YANG PENTING AGAR REDIRECT:
            successRedirectUrl: `${FRONTEND_URL}/payment-success?external_id=${externalId}`
        }
    });
    return response;
};