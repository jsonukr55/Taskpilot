-- ============================================================
-- Board sections ("Groups" in Monday). Distinct from the legacy
-- collaborative `groups` table. A Space renders as an ordered list of
-- space_groups, each holding tasks (ordered by position).
-- ============================================================
create table if not exists space_groups (
  id         text primary key default gen_random_uuid()::text,
  space_id   text not null references spaces(id) on delete cascade,
  name       text not null default 'New group',
  color      text not null default '#6366f1',
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_space_groups_space on space_groups(space_id);
create trigger trg_space_groups_updated before update on space_groups
  for each row execute function set_updated_at();

-- Tasks: which board section they sit in + order within it.
-- on delete set null → deleting a section leaves its tasks ungrouped (safe).
alter table tasks add column if not exists position int not null default 0;

-- RLS: mirror space task rules (members read, editors write).
alter table space_groups enable row level security;
create policy sg_select on space_groups for select using (is_space_member(space_id));
create policy sg_insert on space_groups for insert with check (can_edit_space(space_id));
create policy sg_update on space_groups for update using (can_edit_space(space_id)) with check (can_edit_space(space_id));
create policy sg_delete on space_groups for delete using (can_edit_space(space_id));

alter publication supabase_realtime add table space_groups;
