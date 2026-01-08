import axios from 'axios';

export const generateProfessionalDescription = async (text: string): Promise<string> => {
  const API_KEY = process.env.GEMINI_API_KEY;

  if (!API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY is undefined.");
    return text;
  }
  
  if (!text || text.trim().length < 3) return text;

  try {
    // KITA TEMBAK LANGSUNG KE URL GOOGLE
    // Model: gemini-1.5-flash (Versi paling ringan & cepat)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;
    
    const prompt = `
      Ubah deskripsi pekerjaan teknis berikut menjadi bahasa laporan timesheet yang profesional, formal (Bahasa Indonesia).
      Singkat (1 kalimat). Tanpa tanda kutip.
      Input: "${text}"
    `;

    // Request Body sesuai standar REST API Gemini
    const requestBody = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    };

    const response = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' }
    });

    // Ambil hasilnya dari struktur JSON Google
    const candidate = response.data.candidates?.[0];
    let cleanText = candidate?.content?.parts?.[0]?.text || text;

    // Bersihkan sisa format
    cleanText = cleanText.trim().replace(/^"|"$/g, '').replace(/\*\*/g, '');
    
    console.log("✅ AI Success:", cleanText);
    return cleanText;

  } catch (error: any) {
    // Kalau error, kita log detailnya biar tau kenapa
    if (error.response) {
      console.error("❌ AI API Error:", error.response.status, error.response.data);
    } else {
      console.error("❌ AI Network Error:", error.message);
    }
    return text; // Fallback ke teks asli
  }
};