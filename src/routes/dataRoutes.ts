import express, { Request, Response } from 'express';
import { supabase } from '../dbconfig/supabase';
import { syncCsvToSupabase } from '../services/syncService';
import { getReportersFromDB } from '../services/dbService';

const router = express.Router();

// Sync
router.post('/sync', async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await syncCsvToSupabase();
        res.json(result);
    } catch (error: any) {
        console.error("Sync Error:", error);
        res.status(500).json({ error: error.message || 'Gagal Sync Data' });
    }
});

// Assignees / Reporters
router.get('/assignees', async (req: Request, res: Response): Promise<any> => {
    try {
        const list = await getReportersFromDB();
        res.json(list);
    } catch (error) {
        console.error("Fetch Reporters Error:", error);
        res.status(500).json({ error: 'Gagal ambil data reporter dari DB' });
    }
});

// History
router.get('/history', async (req: Request, res: Response): Promise<any> => {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: "User ID parameter required" });

    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) throw error;
        res.json(data);
    } catch (error) { res.status(500).json({ error: "Gagal mengambil history" }); }
});

// Pricing
router.get('/pricing', async (req: Request, res: Response): Promise<any> => {
    try {
        const { data, error } = await supabase.from('pricing_config').select('*');
        if (error) throw error;
        const pricingMap: any = {};
        data.forEach((item: any) => { pricingMap[item.key] = item.value; });
        res.json(pricingMap);
    } catch (error) { res.status(500).json({ error: "Gagal ambil harga" }); }
});

router.post('/pricing/update', async (req: Request, res: Response): Promise<any> => {
    const { user_id, updates } = req.body;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    try {
        const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user_id).single();
        if (error || !profile || profile.role !== 'admin') return res.status(403).json({ error: "Unauthorized" });

        for (const update of updates) {
            await supabase.from('pricing_config')
                .update({ value: update.value, updated_at: new Date(), updated_by: user_id })
                .eq('key', update.key);
        }
        res.json({ message: "Updated" });
    } catch (error) { res.status(500).json({ error: "Server Error" }); }
});

export default router;
