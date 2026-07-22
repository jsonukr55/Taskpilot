-- ============================================================
-- Clients / Customers — top-level tenant created by the global
-- super-admin. Organizations (and their spaces/tasks) nest under a
-- client. Groups and personal tasks are unaffected (parallel layer).
-- ============================================================

create table if not exists clients (
  id          text primary key,            -- slugId from the client app
  name        text not null,
  description text,
  icon        text not null default '🏢',
  color       text not null default '#6366f1',
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_clients_updated before update on clients
  for each row execute function set_updated_at();

-- Organizations belong to a client (nullable so legacy/ETL rows can be
-- back-filled; the app always sets it on create).
alter table organizations add column if not exists client_id text references clients(id) on delete cascade;
create index if not exists idx_orgs_client on organizations(client_id);

-- ---- Membership helper: am I in any org under this client? -----------
create or replace function is_client_member(c text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from org_members om
    join organizations o on o.id = om.org_id
    where o.client_id = c and om.user_id = auth.uid()
  );
$$;

-- ---- RLS: super-admin manages; org members can read their client -----
alter table clients enable row level security;
create policy clients_select on clients for select using (is_global_admin() or is_client_member(id));
create policy clients_insert on clients for insert with check (is_global_admin() and created_by = auth.uid());
create policy clients_update on clients for update using (is_global_admin()) with check (is_global_admin());
create policy clients_delete on clients for delete using (is_global_admin());

-- Stream client changes to subscribed clients.
alter publication supabase_realtime add table clients;
