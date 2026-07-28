-- Epic 10 — Admin panel: global admins can read across the platform for the
-- users list, all-tasks overview and per-client data footprint. Additive
-- (member access unchanged). organizations_select already allows global admin.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (id = auth.uid() or is_global_admin());

drop policy if exists spaces_select on spaces;
create policy spaces_select on spaces for select using (is_space_member(id) or can_admin_org(org_id) or is_global_admin());

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select using (
  user_id = auth.uid()
  or (group_id is not null and is_group_member(group_id))
  or (space_id is not null and is_space_member(space_id))
  or auth.uid() = any(assignee_ids)
  or is_global_admin()
);
