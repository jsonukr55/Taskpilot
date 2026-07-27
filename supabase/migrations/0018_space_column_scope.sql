-- Subitem-level columns (Monday-style): a space's board has an ITEM column
-- set and a separate SUBITEM column set. Existing columns default to 'item'.
alter table space_columns add column if not exists scope text not null default 'item'
  check (scope in ('item','subitem'));
create index if not exists idx_space_columns_scope on space_columns(space_id, scope);
