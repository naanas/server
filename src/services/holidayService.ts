import axios from 'axios';

// Cache sederhana di variable global
const holidayCache: Record<number, string[]> = {};

export const getIndonesianHolidays = async (year: number): Promise<string[]> => {
    // 1. Cek Cache
    if (holidayCache[year] && holidayCache[year].length > 0) {
        return holidayCache[year];
    }

    try {
        console.log(`🌍 Fetching Holidays for ${year} from Nager.Date API...`);
        const url = `https://date.nager.at/api/v3/publicholidays/${year}/ID`;
        const response = await axios.get(url, { timeout: 5000 });

        if (response.data && Array.isArray(response.data)) {
            const holidays = response.data.map((item: any) => item.date);
            holidayCache[year] = holidays;
            console.log(`✅ Berhasil dapat ${holidays.length} hari libur.`);
            return holidays;
        }
    } catch (error: any) {
        console.error(`❌ Gagal fetch API Libur (${error.message}). Menggunakan Fallback.`);
    }

    // 2. Fallback Data (Jika API Error)
    const fallbackHolidays = [
        '2024-12-25', '2024-12-26',
        '2025-01-01', '2025-01-27', '2025-01-29', '2025-03-29', '2025-03-31', 
        '2025-04-01', '2025-04-18', '2025-04-20', '2025-05-01', '2025-05-12', 
        '2025-05-29', '2025-06-01', '2025-06-06', '2025-06-27', '2025-08-17', 
        '2025-09-05', '2025-12-25', '2025-12-26',
        '2026-01-01'
    ];

    return fallbackHolidays.filter(d => d.startsWith(String(year)));
};