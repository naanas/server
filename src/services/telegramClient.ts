import axios from 'axios';

export const sendTelegramMessage = async (chatId: number, text: string) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN belum di .env');

    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
    });
};
