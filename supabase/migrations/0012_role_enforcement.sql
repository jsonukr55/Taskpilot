-- ============================================================
-- Epic 9 — Roles & Permissions enforcement (RLS)
-- ------------------------------------------------------------
-- Two-tier roles stay as-is (org: owner/admin/member/viewer,
-- space: owner/editor/viewer). This migration closes the
-- enforcement gaps so the roles actually govern access:
--
--   1. Org VIEWERS are read-only → cannot create spaces.
--   2. Org MANAGERS (owner/admin, + global admin) can see and
--      manage membership of every space in their org — so "admin
--      manages" is real even for spaces they didn't join.
--
-- All changes are ADDITIVE (existing member access is preserved).
-- Standard PostgreSQL → Azure-portable.
-- ============================================================

-- Org edit right = any non-viewer org role (or platform admin).
-- Used to gate actions a read-only viewer must not perform.
create or replace function can_edit_org(o text) returns boolean
  language sql security definer stable set search_path = public as $$
  select is_global_admin() or exists(
    select 1 from org_members
    where org_id = o and user_id = auth.uid() and role in ('owner','admin','member')
  );
$$;

-- ---- Spaces: creation blocked for viewers; managers oversee all ----
drop policy if exists spaces_insert on spaces;
create policy spaces_insert on spaces for insert
  with check (can_edit_org(org_id) and owner_id = auth.uid());

drop policy if exists spaces_select on spaces;
create policy spaces_select on spaces for select
  using (is_space_member(id) or can_admin_org(org_id));

drop policy if exists spaces_update on spaces;
create policy spaces_update on spaces for update
  using (can_edit_space(id) or is_org_owner(org_id) or can_admin_org(org_id))
  with check (can_edit_space(id) or is_org_owner(org_id) or can_admin_org(org_id));

drop policy if exists spaces_delete on spaces;
create policy spaces_delete on spaces for delete
  using (is_space_owner(id) or is_org_owner(org_id) or can_admin_org(org_id));

-- ---- Space members: managed by space owner, space editors,
--      OR the org's managers (owner/admin/global admin) ----------
drop policy if exists sm_insert on space_members;
create policy sm_insert on space_members for insert
  with check (is_space_owner(space_id) or can_edit_space(space_id)
              or is_org_owner(space_org(space_id)) or can_admin_org(space_org(space_id)));

drop policy if exists sm_update on space_members;
create policy sm_update on space_members for update
  using (can_edit_space(space_id) or is_org_owner(space_org(space_id)) or can_admin_org(space_org(space_id)))
  with check (can_edit_space(space_id) or is_org_owner(space_org(space_id)) or can_admin_org(space_org(space_id)));

drop policy if exists sm_delete on space_members;
create policy sm_delete on space_members for delete
  using (can_edit_space(space_id) or is_org_owner(space_org(space_id))
         or can_admin_org(space_org(space_id)) or user_id = auth.uid());
