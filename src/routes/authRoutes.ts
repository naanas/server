import express, { Request, Response } from 'express';
import { supabase } from '../dbconfig/supabase';

const router = express.Router();

router.post('/register', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Success', user: data.user, session: data.session });
});

router.post('/login', async (req: Request, res: Response): Promise<any> => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ session: data.session, user: data.user });
});

router.get('/me', async (req: Request, res: Response): Promise<any> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error) return res.status(401).json({ error: 'Invalid token' });
    res.json({ user: data.user });
});

router.post('/logout', async (req: Request, res: Response): Promise<any> => {
    await supabase.auth.signOut();
    res.json({ message: 'Logged out' });
});

export default router;
