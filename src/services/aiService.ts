import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import path from 'path';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export const generateProfessionalDescription = async (text: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    // UPDATE PROMPT: Paksa Bahasa Indonesia Formal
    const prompt = `
      Kamu adalah asisten profesional untuk menulis laporan kerja (Timesheet).
      Tugasmu: Tulis ulang deskripsi pekerjaan berikut menjadi kalimat **Bahasa Indonesia yang formal, ringkas, dan profesional**.
      
      Aturan:
      1. JANGAN gunakan bahasa Inggris kecuali istilah teknis (seperti: Deployment, UAT, Bugfix).
      2. Jangan terlalu panjang, cukup 1 kalimat jelas.
      3. Hilangkan kata-kata santai.
      
      Contoh:
      - "meeting sama user" -> "Menghadiri rapat koordinasi dengan user."
      - "benerin bug login" -> "Melakukan perbaikan (bugfix) pada modul login."
      
      Input: "${text}"
      Output (Hanya teks hasil):
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().replace(/\n/g, '').replace(/"/g, '').trim();
  } catch (error) {
    console.error("AI Error:", error);
    return text; // Fallback ke teks asli jika error
  }
};