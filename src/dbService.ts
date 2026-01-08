import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || '', {
    auth: { persistSession: false }
});

// --- Helper: Parse Date Logic ---
const parseDateForLogic = (raw: string): Date | null => {
    if (!raw) return null;
    if (raw.includes('/')) {
        const parts = raw.split('/');
        if (parts.length === 3) {
            const m = parseInt(parts[0], 10) - 1;
            const d = parseInt(parts[1], 10);
            const y = parseInt(parts[2].trim(), 10);
            return new Date(y, m, d);
        }
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
};

// ==========================================
// 1. GET REPORTERS (FIXED: Loop Fetching)
// ==========================================
export const getReportersFromDB = async () => {
    const uniqueReporters = new Set<string>();
    
    let page = 0;
    const pageSize = 1000; // Ambil per 1000 baris (Max Supabase)
    let fetchMore = true;

    try {
        // Loop sampai data habis
        while (fetchMore) {
            const { data, error } = await supabase
                .from('tasks')
                .select('reporter')
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                console.error("DB Error fetch reporters:", error);
                throw error;
            }

            if (data && data.length > 0) {
                // Masukkan ke Set biar unik
                data.forEach((r: any) => {
                    if (r.reporter) uniqueReporters.add(r.reporter.trim());
                });

                // Jika data yang didapat < 1000, berarti ini halaman terakhir
                if (data.length < pageSize) {
                    fetchMore = false;
                } else {
                    page++; // Lanjut ke halaman berikutnya
                }
            } else {
                fetchMore = false;
            }
        }

        const result = Array.from(uniqueReporters).sort();
        console.log(`✅ Loaded ${result.length} unique reporters from DB.`);
        return result;

    } catch (error) {
        console.error("Fatal Error getReporters:", error);
        return [];
    }
};

// ==========================================
// 2. GET TASKS (Dari DB)
// ==========================================
export const getTasksFromDB = async (reporterName: string, startDate?: string, endDate?: string) => {
    // Ambil data berdasarkan reporter
    // Karena kita filter by kolom, biasanya hasilnya tidak akan lebih dari 1000 (kecuali 1 orang ngerjain 1000 tiket)
    // Tapi untuk aman, kita set limit tinggi
    
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .ilike('reporter', reporterName) // Case insensitive
        .limit(2000); // Ambil maks 2000 task per orang (cukup untuk 1 bulan)

    if (error || !data) {
        console.error("DB Error fetch tasks:", error);
        return [];
    }

    // Filter Tanggal di JS
    const filtered = data.filter((task: any) => {
        if (!startDate || !endDate) return true;
        
        const taskDate = parseDateForLogic(task.date);
        if (!taskDate) return false;

        const start = new Date(startDate); start.setHours(0,0,0,0);
        const end = new Date(endDate); end.setHours(0,0,0,0);

        return taskDate >= start && taskDate <= end;
    });

    // Sorting (Oldest to Newest)
    return filtered.sort((a: any, b: any) => {
        const dA = parseDateForLogic(a.date);
        const dB = parseDateForLogic(b.date);
        return (dA?.getTime() || 0) - (dB?.getTime() || 0);
    });
};