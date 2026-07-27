-- Per-task custom columns: a column may belong to a specific top-level task
-- (task_id set) or be board-wide (task_id null). A task's own columns show
-- for that task and its subtasks; board-wide columns show everywhere.
alter table space_columns add column if not exists task_id text references tasks(id) on delete cascade;
create index if not exists idx_space_columns_task on space_columns(task_id);
