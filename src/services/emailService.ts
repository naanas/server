import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/** Bersihkan nilai dari .env / Vercel (kutip, spasi, newline). */
const normalizeEnv = (value?: string) =>
    (value || '').trim().replace(/^["']|["']$/g, '');

const getSmtpConfig = () => {
    const user = normalizeEnv(process.env.SMTP_USER);
    const pass = normalizeEnv(process.env.SMTP_PASS).replace(/\s+/g, '');
    const host = normalizeEnv(process.env.SMTP_HOST) || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT) || 465;

    return { user, pass, host, port };
};

const createTransporter = () => {
    const { user, pass, host, port } = getSmtpConfig();

    if (host === 'smtp.gmail.com') {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: { user, pass },
        });
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
    });
};

const formatSmtpAuthError = () => {
    const { user } = getSmtpConfig();
    return (
        'Gagal login SMTP Gmail (535 BadCredentials). ' +
        'Pastikan SMTP_USER = email Gmail yang benar' +
        (user ? ` (${user})` : '') +
        ', SMTP_PASS = App Password 16 karakter (bukan password login biasa). ' +
        'Buat ulang di: https://myaccount.google.com/apppasswords — lalu update env di Vercel tanpa tanda kutip.'
    );
};

export const sendEmailWithPdf = async (
    toEmail: string,
    subject: string,
    pdfBuffer: Buffer,
    filename: string
) => {
    const { user, pass } = getSmtpConfig();

    if (!user || !pass) {
        throw new Error('SMTP belum dikonfigurasi di server (SMTP_USER / SMTP_PASS).');
    }

    const transporter = createTransporter();

    try {
        await transporter.sendMail({
            from: `"Timesheet App" <${user}>`,
            to: toEmail,
            subject,
            html: `
                <h3>Pembayaran Berhasil! ✅</h3>
                <p>Halo,</p>
                <p>Terima kasih telah melakukan pembayaran. Berikut adalah lampiran dokumen <b>${filename}</b> yang Anda minta.</p>
                <p>Salam,<br>Admin Timesheet</p>
            `,
            attachments: [
                {
                    filename,
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });
        console.log(`✅ Email terkirim ke ${toEmail}`);
    } catch (error: any) {
        console.error('❌ Gagal kirim email:', error);
        if (error?.code === 'EAUTH' || error?.responseCode === 535) {
            throw new Error(formatSmtpAuthError());
        }
        throw error;
    }
};
