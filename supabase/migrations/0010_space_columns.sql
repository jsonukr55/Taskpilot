-- Custom columns per space (Monday-style user-defined fields).
create table if not exists space_columns (
  id         text primary key default gen_random_uuid()::text,
  space_id   text not null references spaces(id) on delete cascade,
  name       text not null default 'Column',
  type       text not null default 'text' check (type in ('text','number','date','dropdown')),
  options    jsonb not null default '[]'::jsonb,   -- dropdown: array of label strings
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_space_columns_space on space_columns(space_id);
create trigger trg_space_columns_updated before update on space_columns
  for each row execute function set_updated_at();

-- Per-task values, keyed by column id.
alter table tasks add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table space_columns enable row level security;
create policy sc_select on space_columns for select using (is_space_member(space_id));
create policy sc_insert on space_columns for insert with check (can_edit_space(space_id));
create policy sc_update on space_columns for update using (can_edit_space(space_id)) with check (can_edit_space(space_id));
create policy sc_delete on space_columns for delete using (can_edit_space(space_id));

alter publication supabase_realtime add table space_columns;
