-- ============================================================
-- 0024_superglobal_role.sql
-- Adds a platform role tier below Owner.
--   • Owner       = profiles.global_role = 'admin'  (top; unchanged)
--   • Superglobal = profiles.global_role = 'superglobal' (new, just below)
--
-- Superglobal has all the broad platform access an Owner has — it is granted
-- by widening is_global_admin() to match BOTH roles, so every existing policy
-- that trusts is_global_admin() (orgs, spaces, tasks, org_members, profiles,
-- comments, notifications, attachments, activity, admin reads…) now also
-- covers superglobal automatically.
--
-- Owner-only capabilities are gated on the new is_platform_owner():
--   • creating / editing / deleting CLIENTS
--   • promoting anyone to Owner / modifying an Owner (enforced in the edge fn)
--
-- Storage/portability: plain SQL + SECURITY DEFINER helpers; no enum/check on
-- global_role, so the new value stores as-is. Travels to Azure Postgres.
-- ============================================================

-- Owner-only predicate (top tier).
create or replace function public.is_platform_owner()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists(select 1 from profiles where id = auth.uid() and global_role = 'admin');
$$;

-- Widen "global admin" to mean any platform staff (Owner OR Superglobal).
create or replace function public.is_global_admin()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists(select 1 from profiles where id = auth.uid() and global_role in ('admin','superglobal'));
$$;

-- Client management becomes Owner-only. (Superglobal can still SELECT clients
-- via clients_select, which uses the now-widened is_global_admin().)
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert with check (is_platform_owner() and created_by = auth.uid());

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update using (is_platform_owner()) with check (is_platform_owner());

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
  for delete using (is_platform_owner());
