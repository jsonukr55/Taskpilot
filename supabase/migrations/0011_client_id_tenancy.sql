-- ============================================================
-- Epic 11 — Multi-tenancy: client_id across the tenant tree
-- ------------------------------------------------------------
-- Scope decision (confirmed): tenancy applies to the
-- Org → Space → Task tree ONLY. The parallel personal / legacy
-- Groups layer (profiles, groups, group_members, invites, notes,
-- note_comments, daily_reports, daily_entries, categories,
-- insights, schedules, and *personal* tasks) is left untouched —
-- it is per-user, not per-tenant.
--
-- Every tenant-tree row carries its owning client so tenancy is
-- explicit (reporting, tenant-scoped queries, clean per-tenant
-- pg_dump for the Azure move). client_id is AUTO-STAMPED by
-- triggers that derive it from the parent, so NO app code changes
-- are needed — the service layer keeps its existing insert shape.
--
-- Isolation itself is already guaranteed by the existing
-- membership RLS (is_org_member / is_space_member): a user can only
-- ever be a member within one client's tree, so cross-tenant reads
-- are impossible. The client_id column makes that tenancy explicit
-- and enables tenant-scoped features on top.
--
-- Azure-portable: standard PostgreSQL columns, FKs, triggers and
-- indexes — travels as-is to Azure Database for PostgreSQL.
-- ============================================================

-- organizations.client_id already exists (migration 0005).

-- ---- 1. Add client_id to every tenant-tree table -----------
--    Nullable: children are populated by trigger/backfill;
--    tasks stay null for personal tasks.
alter table spaces        add column if not exists client_id text references clients(id) on delete cascade;
alter table space_groups  add column if not exists client_id text references clients(id) on delete cascade;
alter table space_columns add column if not exists client_id text references clients(id) on delete cascade;
alter table space_members add column if not exists client_id text references clients(id) on delete cascade;
alter table org_members   add column if not exists client_id text references clients(id) on delete cascade;
alter table org_invites   add column if not exists client_id text references clients(id) on delete cascade;
alter table tasks         add column if not exists client_id text references clients(id) on delete cascade;

create index if not exists idx_spaces_client        on spaces(client_id);
create index if not exists idx_space_groups_client  on space_groups(client_id);
create index if not exists idx_space_columns_client on space_columns(client_id);
create index if not exists idx_space_members_client on space_members(client_id);
create index if not exists idx_org_members_client   on org_members(client_id);
create index if not exists idx_org_invites_client   on org_invites(client_id);
create index if not exists idx_tasks_client         on tasks(client_id);

-- ---- 2. Auto-stamp triggers (derive client_id from parent) --
--    SECURITY DEFINER so the derivation can read the parent's
--    client_id regardless of the caller's row-level visibility.

-- Children of an organization: spaces, org_members, org_invites
create or replace function stamp_client_from_org() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  select client_id into new.client_id from organizations where id = new.org_id;
  return new;
end $$;

-- Children of a space: space_groups, space_columns, space_members
create or replace function stamp_client_from_space() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  select client_id into new.client_id from spaces where id = new.space_id;
  return new;
end $$;

-- Tasks: a space task inherits the space's client; else an org task
-- inherits the org's client; a personal task stays null.
create or replace function stamp_client_task() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.space_id is not null then
    select client_id into new.client_id from spaces where id = new.space_id;
  elsif new.org_id is not null then
    select client_id into new.client_id from organizations where id = new.org_id;
  else
    new.client_id := null;   -- personal task
  end if;
  return new;
end $$;

drop trigger if exists trg_spaces_client        on spaces;
drop trigger if exists trg_space_groups_client  on space_groups;
drop trigger if exists trg_space_columns_client on space_columns;
drop trigger if exists trg_space_members_client on space_members;
drop trigger if exists trg_org_members_client   on org_members;
drop trigger if exists trg_org_invites_client   on org_invites;
drop trigger if exists trg_tasks_client         on tasks;

create trigger trg_spaces_client        before insert or update of org_id            on spaces        for each row execute function stamp_client_from_org();
create trigger trg_org_members_client   before insert or update of org_id            on org_members   for each row execute function stamp_client_from_org();
create trigger trg_org_invites_client   before insert or update of org_id            on org_invites   for each row execute function stamp_client_from_org();
create trigger trg_space_groups_client  before insert or update of space_id          on space_groups  for each row execute function stamp_client_from_space();
create trigger trg_space_columns_client before insert or update of space_id          on space_columns for each row execute function stamp_client_from_space();
create trigger trg_space_members_client before insert or update of space_id          on space_members for each row execute function stamp_client_from_space();
create trigger trg_tasks_client         before insert or update of space_id, org_id  on tasks         for each row execute function stamp_client_task();

-- These are trigger-only functions: they fire as the table owner via the
-- triggers above and must NOT be directly callable. Revoke the default
-- PostgREST RPC execute grant so they aren't exposed at /rest/v1/rpc/*.
revoke execute on function stamp_client_from_org()   from public, anon, authenticated;
revoke execute on function stamp_client_from_space() from public, anon, authenticated;
revoke execute on function stamp_client_task()       from public, anon, authenticated;

-- ---- 3. Backfill existing rows from their parent ------------
update spaces s        set client_id = o.client_id from organizations o where o.id = s.org_id     and s.client_id is null;
update org_members m   set client_id = o.client_id from organizations o where o.id = m.org_id     and m.client_id is null;
update org_invites i   set client_id = o.client_id from organizations o where o.id = i.org_id     and i.client_id is null;
update space_groups g  set client_id = s.client_id from spaces s       where s.id = g.space_id    and g.client_id is null;
update space_columns c set client_id = s.client_id from spaces s       where s.id = c.space_id    and c.client_id is null;
update space_members m set client_id = s.client_id from spaces s       where s.id = m.space_id    and m.client_id is null;
update tasks t         set client_id = s.client_id from spaces s       where s.id = t.space_id    and t.client_id is null;
update tasks t         set client_id = o.client_id from organizations o where o.id = t.org_id      and t.space_id is null and t.client_id is null;
