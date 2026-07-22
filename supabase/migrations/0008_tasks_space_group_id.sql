-- Board-section membership uses a DISTINCT column (group_id already means the
-- legacy collaborative group). space_group_id → the Monday-style board section.
alter table tasks add column if not exists space_group_id text references space_groups(id) on delete set null;
create index if not exists idx_tasks_space_group on tasks(space_group_id);
