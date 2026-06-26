import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: smtpPass,
    },
});

export const sendEmailWithPdf = async (toEmail: string, subject: string, pdfBuffer: Buffer, filename: string) => {
    try {
        await transporter.sendMail({
            from: `"Timesheet App" <${process.env.SMTP_USER}>`,
            to: toEmail,
            subject: subject,
            html: `
                <h3>Pembayaran Berhasil! ✅</h3>
                <p>Halo,</p>
                <p>Terima kasih telah melakukan pembayaran. Berikut adalah lampiran dokumen <b>${filename}</b> yang Anda minta.</p>
                <p>Salam,<br>Admin Timesheet</p>
            `,
            attachments: [
                {
                    filename: filename,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        });
        console.log(`✅ Email terkirim ke ${toEmail}`);
    } catch (error) {
        console.error("❌ Gagal kirim email:", error);
        throw error; 
    }
};