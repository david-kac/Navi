-- Allow tasks to have no date (fully unscheduled backlog items), independent
-- of scheduled_time already being nullable. Day/Categories views filter these
-- out of date-range queries naturally since NULL never matches gte/lte.
alter table public.tasks alter column date drop not null;
