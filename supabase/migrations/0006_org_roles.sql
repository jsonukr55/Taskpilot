-- Expand org member roles to owner / admin / member / viewer
alter table org_members drop constraint if exists org_members_role_check;
alter table org_members add constraint org_members_role_check
  check (role in ('owner','admin','member','viewer'));

-- Org admins = owner OR role 'admin'. They manage members + invites
-- (but NOT org delete/settings, which stay owner/global-admin only).
create or replace function is_org_admin(o text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from org_members
    where org_id = o and user_id = auth.uid() and role in ('owner','admin'));
$$;
create or replace function can_admin_org(o text) returns boolean
  language sql security definer stable set search_path = public as $$
  select is_org_owner(o) or is_global_admin() or is_org_admin(o);
$$;

-- Member management → org admins (role changes, adds, removes)
drop policy if exists om_insert on org_members;
create policy om_insert on org_members for insert with check (can_admin_org(org_id));
drop policy if exists om_update on org_members;
create policy om_update on org_members for update using (can_admin_org(org_id)) with check (can_admin_org(org_id));
drop policy if exists om_delete on org_members;
create policy om_delete on org_members for delete using (can_admin_org(org_id) or user_id = auth.uid());

-- Org invites → org admins
drop policy if exists oi_select on org_invites;
create policy oi_select on org_invites for select using (can_admin_org(org_id));
drop policy if exists oi_insert on org_invites;
create policy oi_insert on org_invites for insert with check (can_admin_org(org_id));
drop policy if exists oi_update on org_invites;
create policy oi_update on org_invites for update using (can_admin_org(org_id));
drop policy if exists oi_delete on org_invites;
create policy oi_delete on org_invites for delete using (can_admin_org(org_id));
