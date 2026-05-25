import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase URL or Key in server .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

/** Pakai service_role jika ada — bypass RLS (disarankan untuk bot_tasks) */
let botSupabaseClient: SupabaseClient | null = null;

export const getBotSupabase = (): SupabaseClient => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    if (!botSupabaseClient) {
      botSupabaseClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      });
      console.log('✅ bot_tasks memakai SUPABASE_SERVICE_ROLE_KEY (bypass RLS)');
    }
    return botSupabaseClient;
  }
  return supabase;
};