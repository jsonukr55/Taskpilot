-- Default board column "PM/PO" — the responsible project manager / product
-- owner (a person field, admin-ish). Stored on the task as a profile uid.
alter table tasks add column if not exists pm_po uuid references profiles(id) on delete set null;
create index if not exists idx_tasks_pm_po on tasks(pm_po);
