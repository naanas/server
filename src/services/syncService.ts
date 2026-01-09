import axios from 'axios';
import csv from 'csv-parser';
import { supabase } from '../dbconfig/supabase'; // Gunakan client terpusat (sudah load env)

// Helper: Normalisasi Key Object (Lowercase & Trim)
const normalizeRowKeys = (row: any) => {
    const newRow: any = {};
    Object.keys(row).forEach(key => {
        newRow[key.trim().toLowerCase()] = row[key];
    });
    return newRow;
};

// Helper: Ambil value dari berbagai kemungkinan nama kolom
const getValue = (row: any, possibleKeys: string[]) => {
    for (const key of possibleKeys) {
        if (row[key] !== undefined && row[key] !== '') return row[key].trim();
    }
    return '';
};

// Helper: Sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const syncCsvToSupabase = async () => {
    // 1. BACA ENV DI DALAM FUNGSI (Agar aman terbaca)
    const SHEET_URL = process.env.GOOGLE_SHEET_CSV_URL;
    const JIRA_BASE_URL = process.env.JIRA_BASE_URL;

    // Cek Env
    if (!SHEET_URL) {
        console.error("❌ ERROR: SHEET_CSV_URL belum ada di file .env");
        throw new Error("SHEET_CSV_URL missing in .env file");
    }

    console.log("🔄 Starting Sync Process (Optimized Upsert Mode)...");
    console.log("🔗 Connecting to Sheet...");

    // 2. Fetch CSV Stream
    const csvRows: any[] = [];
    try {
        const response = await axios.get(SHEET_URL, { responseType: 'stream' });
        await new Promise((resolve, reject) => {
            response.data.pipe(csv())
                .on('data', (row: any) => csvRows.push(normalizeRowKeys(row)))
                .on('end', resolve)
                .on('error', reject);
        });
    } catch (err: any) {
        console.error("❌ Gagal download CSV. Pastikan Link Public/CSV benar.", err.message);
        throw new Error("Failed to download CSV from Google Sheet");
    }

    console.log(`📥 Downloaded ${csvRows.length} rows from Sheet.`);

    // 3. Construct Data (Mapping CSV ke DB Schema)
    const recordsToUpsert: any[] = [];
    const processedSignatures = new Set(); 

    for (const row of csvRows) {
        const date = getValue(row, ['start date (batb)', 'start date', 'date', 'tanggal']);
        const desc = getValue(row, ['description', 'summary', 'deskripsi', 'task']);
        const reporter = getValue(row, ['reporters', 'reporter', 'assignee', 'owner']);
        const ticketNum = getValue(row, ['ticket number', 'issue key', 'key', 'issue id', 'no tiket']); 
        const csvLink = getValue(row, ['ticket link', 'link', 'url']);

        // Skip jika data wajib kosong
        if (!date || !desc || !reporter) continue;

        // Logic Link Jira
        let finalLink = csvLink; 
        if (ticketNum && JIRA_BASE_URL) {
            const baseUrl = JIRA_BASE_URL.endsWith('/') ? JIRA_BASE_URL : `${JIRA_BASE_URL}/`;
            finalLink = `${baseUrl}${ticketNum}`;
        }

        // Signature Unik (Composite Key manual)
        const signature = `${date}|${desc}|${reporter}|${ticketNum}`.toLowerCase();

        // Cegah duplikat dalam batch CSV itu sendiri
        if (!processedSignatures.has(signature)) {
            recordsToUpsert.push({
                date: date, // Format YYYY-MM-DD
                description: desc,
                reporter: reporter,
                assignee: reporter,
                ticket_number: ticketNum,
                ticket_link: finalLink,
                raw_signature: signature,
                updated_at: new Date()
            });
            processedSignatures.add(signature);
        }
    }

    // 4. Batch Upsert ke Supabase
    if (recordsToUpsert.length > 0) {
        console.log(`✨ Preparing to sync ${recordsToUpsert.length} records...`);
        
        const batchSize = 1000; 
        let insertedCount = 0;
        
        for (let i = 0; i < recordsToUpsert.length; i += batchSize) {
            const batch = recordsToUpsert.slice(i, i + batchSize);
            console.log(` 🚀 Upserting batch ${i} - ${i + batch.length}...`);
            
            // Upsert (Insert or Ignore/Update based on unique key)
            const { error } = await supabase
                .from('tasks')
                .upsert(batch, { 
                    onConflict: 'raw_signature', 
                    ignoreDuplicates: true 
                });

            if (error) {
                console.error(`❌ Batch error at index ${i}:`, error.message);
            } else {
                insertedCount += batch.length;
            }
            
            await sleep(200); // Jeda nafas database
        }
        
        console.log(`✅ Sync Finished. Processed ${insertedCount} rows.`);
        return { status: 'updated', count: insertedCount };
    } else {
        console.log("⚠️ No valid rows found in CSV.");
        return { status: 'empty', count: 0 };
    }
};