-- ============================================================
-- 0031_task_archive.sql
-- Soft-delete + 30-day retention for tasks. Deleting a task now sets
-- deleted_at (app queries exclude those); it stays restorable from the Admin
-- "Archived" list, then a scheduled job hard-deletes it after 30 days
-- (cascading to its subtasks/comments/attachments via existing FKs).
--
-- Portable: pg_cron is available on Azure Database for PostgreSQL too, so the
-- retention job travels; the column/index are standard SQL.
-- ============================================================

alter table public.tasks add column if not exists deleted_at timestamptz;
create index if not exists idx_tasks_deleted_at on public.tasks(deleted_at) where deleted_at is not null;

-- Daily purge of tasks archived more than 30 days ago.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('purge-archived-tasks');
exception when others then null;   -- not scheduled yet
end $$;

select cron.schedule(
  'purge-archived-tasks',
  '0 3 * * *',   -- 03:00 UTC daily
  $$ delete from public.tasks where deleted_at is not null and deleted_at < now() - interval '30 days' $$
);
