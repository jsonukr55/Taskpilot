-- Epic 2 (extension) — add a 'member' custom column type.
-- The cell value stores a member's profile uid in tasks.custom_fields.
alter table space_columns drop constraint if exists space_columns_type_check;
alter table space_columns add constraint space_columns_type_check
  check (type in ('text','number','date','dropdown','member'));
