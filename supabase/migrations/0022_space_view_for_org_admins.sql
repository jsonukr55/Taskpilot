-- ============================================================
-- 0022_space_view_for_org_admins.sql
-- Fix: board content differed between members. A space can be OPENED
-- by org owners/admins (spaces_select allows can_admin_org), but its
-- board CONTENT (groups, columns, tasks) was only visible to actual
-- space members (is_space_member). Result: an org admin who is not a
-- space member opens the space and sees an empty "Build your board".
--
-- Fix: make the read predicate for board content match the read
-- predicate for the space itself, via a can_view_space() helper.
-- Portable: plain SQL + SECURITY DEFINER, travels to Azure Postgres.
-- ============================================================

create or replace function public.can_view_space(s text)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select is_space_member(s)
      or can_admin_org((select org_id from spaces where id = s))
      or is_global_admin();
$$;

-- space_groups: sections/boards
drop policy if exists sg_select on public.space_groups;
create policy sg_select on public.space_groups
  for select using (can_view_space(space_id));

-- space_columns: per-space custom columns
drop policy if exists sc_select on public.space_columns;
create policy sc_select on public.space_columns
  for select using (can_view_space(space_id));

-- tasks: the space branch of the existing predicate now uses can_view_space
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    (user_id = auth.uid())
    or (group_id is not null and is_group_member(group_id))
    or (space_id is not null and can_view_space(space_id))
    or (auth.uid() = any (assignee_ids))
    or is_global_admin()
  );
