import axios from 'axios';
import csv from 'csv-parser';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load Env
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const SHEET_URL = process.env.SHEET_CSV_URL;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;

const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
    auth: { persistSession: false }
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeRowKeys = (row: any) => {
    const newRow: any = {};
    Object.keys(row).forEach(key => {
        newRow[key.trim().toLowerCase()] = row[key];
    });
    return newRow;
};

const getValue = (row: any, possibleKeys: string[]) => {
    for (const key of possibleKeys) {
        if (row[key] !== undefined && row[key] !== '') return row[key].trim();
    }
    return '';
};

export const syncCsvToSupabase = async () => {
    // --- DEBUGGING LOGS ---
    console.log("-------------------------------------------------");
    console.log("🔍 DEBUG SYNC CONFIG:");
    console.log("🔗 SHEET_URL:", SHEET_URL ? "✅ OK" : "❌ MISSING");
    console.log("🔗 JIRA_BASE_URL:", JIRA_BASE_URL ? `✅ OK (${JIRA_BASE_URL})` : "❌ MISSING / UNDEFINED");
    console.log("-------------------------------------------------");

    if (!SHEET_URL) throw new Error("GOOGLE_SHEET_CSV_URL missing");

    console.log("🔄 Starting Sync Process...");

    // 1. Fetch CSV
    const csvRows: any[] = [];
    try {
        const response = await axios.get(SHEET_URL, { responseType: 'stream' });
        await new Promise((resolve, reject) => {
            response.data.pipe(csv())
                .on('data', (row: any) => csvRows.push(normalizeRowKeys(row)))
                .on('end', resolve)
                .on('error', reject);
        });
    } catch (err) {
        console.error("❌ Gagal download CSV:", err);
        throw err;
    }

    console.log(`📥 Downloaded ${csvRows.length} rows. Checking DB...`);

    // 2. Cek Data Existing
    const existingSignatures = new Set();
    const pageSize = 10000;
    let page = 0;
    let fetchMore = true;

    while (fetchMore) {
        const { data, error } = await supabase
            .from('tasks')
            .select('raw_signature')
            .range(page * pageSize, (page + 1) * pageSize - 1);
        
        if (error) throw error;

        if (data && data.length > 0) {
            data.forEach((d: any) => existingSignatures.add(d.raw_signature));
            page++;
        } else {
            fetchMore = false;
        }
    }

    // 3. Filter & Construct Data
    const newRecords: any[] = [];
    
    // Debug flag agar log tidak spam (cuma muncul sekali)
    let debugRowPrinted = false;

    for (const row of csvRows) {
        const date = getValue(row, ['start date (batb)', 'start date', 'date', 'tanggal']);
        const desc = getValue(row, ['description', 'summary', 'deskripsi', 'task']);
        const reporter = getValue(row, ['reporters', 'reporter', 'assignee', 'owner']);
        // Tambahkan variasi header tiket
        const ticketNum = getValue(row, ['ticket number', 'issue key', 'key', 'issue id', 'no tiket']); 
        
        // CSV Link fallback
        const csvLink = getValue(row, ['ticket link', 'link', 'url']);

        if (!date || !desc || !reporter) continue;

        // --- LOGIC JIRA LINK ---
        let finalLink = csvLink; 
        
        if (ticketNum && JIRA_BASE_URL) {
            const baseUrl = JIRA_BASE_URL.endsWith('/') ? JIRA_BASE_URL : `${JIRA_BASE_URL}/`;
            finalLink = `${baseUrl}${ticketNum}`;
        }
        
        // DEBUG: Cek 1 baris pertama yang punya tiket
        if (!debugRowPrinted && ticketNum) {
            console.log("🔍 [DEBUG ROW] Sample Ticket Logic:");
            console.log(`   - Ticket Num Found: ${ticketNum}`);
            console.log(`   - Generated Link: ${finalLink}`);
            debugRowPrinted = true;
        }
        // -----------------------

        const signature = `${date}|${desc}|${reporter}|${ticketNum}`.toLowerCase();

        if (!existingSignatures.has(signature)) {
            newRecords.push({
                date: date,
                description: desc,
                reporter: reporter,
                assignee: reporter,
                ticket_number: ticketNum,
                ticket_link: finalLink,
                raw_signature: signature
            });
            existingSignatures.add(signature);
        }
    }

    // 4. Insert Batch
    if (newRecords.length > 0) {
        console.log(`✨ Found ${newRecords.length} NEW records.`);
        const batchSize = 1000;
        
        for (let i = 0; i < newRecords.length; i += batchSize) {
            const batch = newRecords.slice(i, i + batchSize);
            console.log(`   🚀 Inserting batch ${i}...`);
            await supabase.from('tasks').insert(batch);
            await sleep(1000);
        }
        return { status: 'updated', count: newRecords.length };
    } else {
        console.log("✅ Database up to date.");
        return { status: 'up-to-date', count: 0 };
    }
};