-- ============================================================
-- 0023_org_members_admin_visibility.sql
-- Fix: the admin panel derives a client's users from org_members,
-- but om_select only exposed rows for orgs the caller is a member of.
-- So a platform (global) admin saw all ORGANIZATION rows yet an empty
-- member list for orgs they don't personally belong to, and org
-- owners/admins couldn't enumerate their org's members here.
--
-- Fix: also let anyone who can administer the org (owner / org admin /
-- global admin, via can_admin_org) read its membership rows.
-- Portable: plain SQL + existing SECURITY DEFINER helper.
-- ============================================================

drop policy if exists om_select on public.org_members;
create policy om_select on public.org_members
  for select using (
    is_org_member(org_id)
    or user_id = auth.uid()
    or can_admin_org(org_id)
  );
