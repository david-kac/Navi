-- Party feature: friends + contact_logs

-- ── friends ─────────────────────────────────────────────────────────────────
create table public.friends (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.friends enable row level security;

create policy "friends_select_own" on public.friends
  for select to authenticated using (auth.uid() = user_id);

create policy "friends_insert_own" on public.friends
  for insert to authenticated with check (auth.uid() = user_id);

create policy "friends_update_own" on public.friends
  for update to authenticated using (auth.uid() = user_id);

create policy "friends_delete_own" on public.friends
  for delete to authenticated using (auth.uid() = user_id);

-- ── contact_logs ─────────────────────────────────────────────────────────────
create table public.contact_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  friend_id    uuid not null references public.friends(id) on delete cascade,
  contact_date date not null,
  type         text not null check (type in ('VISIT','CALL','MSG')),
  created_at   timestamptz not null default now()
);

alter table public.contact_logs enable row level security;

create policy "contact_logs_select_own" on public.contact_logs
  for select to authenticated using (auth.uid() = user_id);

create policy "contact_logs_insert_own" on public.contact_logs
  for insert to authenticated with check (auth.uid() = user_id);

create policy "contact_logs_delete_own" on public.contact_logs
  for delete to authenticated using (auth.uid() = user_id);
