-- Jalankan di Supabase SQL Editor
create table if not exists public.bot_tasks (
  id uuid primary key default gen_random_uuid(),
  issue_key text unique not null,
  telegram_id bigint not null,
  summary text not null,
  status text not null default 'backlog',
  start_date date,
  duration_minutes int,
  started_at timestamptz,
  timer_fire_at timestamptz,
  timer_status text default 'idle',
  jira_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists bot_tasks_telegram_id_idx on public.bot_tasks (telegram_id);
create index if not exists bot_tasks_timer_fire_at_idx on public.bot_tasks (timer_fire_at)
  where timer_status = 'running';
