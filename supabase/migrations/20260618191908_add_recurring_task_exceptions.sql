-- Tracks dates where a single occurrence of a recurring rule was deleted
-- ("delete this task only"), so the recurring engine doesn't regenerate it.
create table public.recurring_task_exceptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  recurring_rule_id  uuid not null references public.recurring_task_rules(id) on delete cascade,
  date               date not null,
  created_at         timestamptz not null default now(),
  unique (recurring_rule_id, date)
);

alter table public.recurring_task_exceptions enable row level security;

create policy "recurring_task_exceptions_select_own" on public.recurring_task_exceptions
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "recurring_task_exceptions_insert_own" on public.recurring_task_exceptions
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "recurring_task_exceptions_delete_own" on public.recurring_task_exceptions
  for delete to authenticated
  using ( (select auth.uid()) = user_id );
