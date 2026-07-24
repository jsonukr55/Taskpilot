-- Monday-style workflow stage (the 6 statuses) + sprint, added additively.
-- The existing 4-value `status` stays for completion logic and is DERIVED from
-- stage in the app, so nothing that reads `status` breaks.
alter table tasks add column if not exists stage text not null default 'created'
  check (stage in ('created','in_discussion','development','done','released','production'));
alter table tasks add column if not exists sprint text;

-- Backfill stage from the existing status (one-time; all rows currently 'created').
update tasks set stage = case status
  when 'todo'        then 'created'
  when 'in_progress' then 'development'
  when 'completed'   then 'done'
  when 'cancelled'   then 'done'
  else 'created'
end
where stage = 'created';

create index if not exists idx_tasks_stage on tasks(stage);
