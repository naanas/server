import { Invoice } from '../config/xendit';

export const createInvoice = async (
    externalId: string, 
    amount: number, 
    email: string, 
    description?: string,
    allowedMethods?: string[] // <--- Parameter ke-5 (WAJIB ADA BIAR GAK ERROR)
) => {
    // URL Frontend untuk redirect setelah sukses
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const response = await Invoice.createInvoice({
        data: {
            externalId: externalId,
            amount: amount,
            payerEmail: email,
            description: description || 'Jasa Export PDF Premium',
            invoiceDuration: 86400, // 24 Jam
            currency: 'IDR',
            reminderTime: 1,
            successRedirectUrl: `${frontendUrl}/payment-success?external_id=${externalId}`,
            // Batasi metode pembayaran di Xendit sesuai pilihan user
            paymentMethods: allowedMethods 
        }
    });

    return response;
};