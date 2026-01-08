import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import path from 'path';

// Load Env
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

// Inisialisasi Google AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export const generateProfessionalDescription = async (originalText: string): Promise<string> => {
    // Validasi input
    if (!originalText || originalText.trim().length === 0) return "";
    
    // Cek API Key
    if (!process.env.GEMINI_API_KEY) {
        console.warn("⚠️ GEMINI_API_KEY tidak ditemukan di .env");
        return originalText; // Kembalikan text asli jika tidak ada key
    }

    try {
        // Gunakan model gemini-1.5-flash (Lebih cepat & murah untuk task ringan)
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const prompt = `
        Rewrite the following timesheet task description to be professional, concise, and formal (Corporate Style).
        Language: English.
        Max length: 15 words.
        Directly output the rewritten text without quotes or explanations.

        Input: "${originalText}"
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Bersihkan hasil (hapus tanda kutip atau spasi berlebih)
        return text.replace(/^"|"$/g, '').trim();

    } catch (error) {
        console.error("❌ Error AI Generation:", error);
        return originalText; // Fallback ke text asli jika error
    }
};