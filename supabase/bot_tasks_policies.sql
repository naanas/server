-- =============================================================================
-- FIX: "Supabase RLS memblokir insert" pada bot_tasks
-- Jalankan SEMUA baris ini di Supabase Dashboard → SQL Editor → Run
-- =============================================================================

-- 1) Matikan RLS (cara paling simpel untuk bot backend)
alter table if exists public.bot_tasks disable row level security;

-- 2) Tetap buat policy untuk role anon (kalau RLS nyala lagi / project baru)
alter table if exists public.bot_tasks enable row level security;

drop policy if exists "bot_tasks_anon_select" on public.bot_tasks;
drop policy if exists "bot_tasks_anon_insert" on public.bot_tasks;
drop policy if exists "bot_tasks_anon_update" on public.bot_tasks;
drop policy if exists "bot_tasks_anon_delete" on public.bot_tasks;
drop policy if exists "bot_tasks_all" on public.bot_tasks;

create policy "bot_tasks_all"
on public.bot_tasks
for all
to anon, authenticated, service_role
using (true)
with check (true);

-- 3) Matikan RLS lagi (supaya tidak bentrok — pilih state final: OFF)
alter table public.bot_tasks disable row level security;

-- 4) Refresh schema cache PostgREST
notify pgrst, 'reload schema';

-- Cek: Table Editor → bot_tasks → ikon RLS harus OFF/gray
