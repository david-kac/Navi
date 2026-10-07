-- Task details + time tracking on recurring series.
--
-- tasks.notes already exists (text, nullable, currently unused) and is reused
-- as the task "details" field, so tasks needs no schema change. Recurring
-- series get the same field so future generated instances inherit it, plus
-- aggregate time-tracking columns. Stats live on the series (the rule), never
-- on individual instances: average actual time = total_actual_seconds / run_count.

alter table public.recurring_task_rules
  add column if not exists notes                text,
  add column if not exists total_actual_seconds bigint  not null default 0 check (total_actual_seconds >= 0),
  add column if not exists run_count            integer not null default 0 check (run_count >= 0);

-- Atomic increment so two near-simultaneous completions can't lose an update.
-- security invoker: runs under the caller's RLS (recurring_task_rules_update_own),
-- the explicit user_id filter is belt-and-braces.
create or replace function public.log_recurring_run(p_rule_id uuid, p_seconds integer)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.recurring_task_rules
     set total_actual_seconds = total_actual_seconds + greatest(p_seconds, 0),
         run_count            = run_count + 1
   where id = p_rule_id
     and user_id = (select auth.uid());
$$;

revoke all on function public.log_recurring_run(uuid, integer) from public, anon;
grant execute on function public.log_recurring_run(uuid, integer) to authenticated;
