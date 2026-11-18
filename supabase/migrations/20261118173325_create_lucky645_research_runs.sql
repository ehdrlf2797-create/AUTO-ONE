create table if not exists public.lucky645_research_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id text not null check (char_length(run_id) between 1 and 128),
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 2097152),
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, run_id)
);

create index if not exists lucky645_research_runs_user_created_idx
  on public.lucky645_research_runs (user_id, created_at desc);

alter table public.lucky645_research_runs enable row level security;

create policy "Users can read their own LUCKY 645 research runs"
  on public.lucky645_research_runs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own LUCKY 645 research runs"
  on public.lucky645_research_runs for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own LUCKY 645 research runs"
  on public.lucky645_research_runs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own LUCKY 645 research runs"
  on public.lucky645_research_runs for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.lucky645_research_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.lucky645_research_runs to authenticated;
