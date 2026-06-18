-- Prevents the recurring task generator from creating duplicate instances
-- of the same rule on the same date (e.g. on rapid refocus/refresh).
create unique index tasks_recurring_rule_date_uidx
  on public.tasks (user_id, recurring_rule_id, date)
  where recurring_rule_id is not null;
