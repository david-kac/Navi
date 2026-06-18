-- Dot initial schema: categories, goals, recurring_task_rules, tasks, schedule_blocks
-- Every table carries user_id tied to auth.users and is locked down with RLS,
-- even though Dot is single-user, because the API is internet-accessible.

create extension if not exists "pgcrypto";

-- ── categories ──────────────────────────────────────────────────────────
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  icon       text not null,
  color      text,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "categories_select_own" on public.categories
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "categories_insert_own" on public.categories
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "categories_update_own" on public.categories
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "categories_delete_own" on public.categories
  for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- ── goals ───────────────────────────────────────────────────────────────
create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  category_id uuid references public.categories(id) on delete set null,
  target_date date,
  status      text not null default 'active'
                check (status in ('active', 'completed', 'archived')),
  created_at  timestamptz not null default now()
);

alter table public.goals enable row level security;

create policy "goals_select_own" on public.goals
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "goals_insert_own" on public.goals
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "goals_update_own" on public.goals
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "goals_delete_own" on public.goals
  for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- ── recurring_task_rules ───────────────────────────────────────────────
-- Templates that the recurrence engine expands into concrete `tasks` rows.
create table public.recurring_task_rules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text not null,
  category_id       uuid references public.categories(id) on delete set null,
  goal_id           uuid references public.goals(id) on delete set null,
  rule_type         text not null check (rule_type in ('daily', 'weekly', 'custom')),
  days_of_week      smallint[],
  scheduled_time    time,
  duration_minutes  integer,
  time_period       text not null default 'unscheduled'
                       check (time_period in ('morning', 'afternoon', 'evening', 'unscheduled')),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

alter table public.recurring_task_rules enable row level security;

create policy "recurring_task_rules_select_own" on public.recurring_task_rules
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "recurring_task_rules_insert_own" on public.recurring_task_rules
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "recurring_task_rules_update_own" on public.recurring_task_rules
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "recurring_task_rules_delete_own" on public.recurring_task_rules
  for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- ── tasks ───────────────────────────────────────────────────────────────
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  title              text not null,
  category_id        uuid references public.categories(id) on delete set null,
  goal_id            uuid references public.goals(id) on delete set null,
  recurring_rule_id  uuid references public.recurring_task_rules(id) on delete set null,
  date               date not null,
  scheduled_time     time,
  duration_minutes   integer,
  time_period        text not null default 'unscheduled'
                        check (time_period in ('morning', 'afternoon', 'evening', 'unscheduled')),
  is_completed       boolean not null default false,
  is_ttfo            boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now()
);

alter table public.tasks enable row level security;

create index tasks_user_date_idx on public.tasks (user_id, date);

create policy "tasks_select_own" on public.tasks
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "tasks_insert_own" on public.tasks
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "tasks_update_own" on public.tasks
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "tasks_delete_own" on public.tasks
  for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- ── schedule_blocks ────────────────────────────────────────────────────
-- Protected/fixed time windows (commute, Thursday date night, sleep, etc.)
-- that the conflict detector treats as non-negotiable, distinct from tasks.
create table public.schedule_blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  block_type    text not null check (block_type in ('commute', 'date-night', 'sleep', 'custom')),
  day_of_week   smallint check (day_of_week between 0 and 6),
  date          date,
  start_time    time not null,
  end_time      time not null,
  is_recurring  boolean not null default true,
  is_protected  boolean not null default true,
  created_at    timestamptz not null default now(),
  check (
    (is_recurring and day_of_week is not null and date is null)
    or (not is_recurring and date is not null)
  )
);

alter table public.schedule_blocks enable row level security;

create policy "schedule_blocks_select_own" on public.schedule_blocks
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "schedule_blocks_insert_own" on public.schedule_blocks
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "schedule_blocks_update_own" on public.schedule_blocks
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "schedule_blocks_delete_own" on public.schedule_blocks
  for delete to authenticated
  using ( (select auth.uid()) = user_id );
