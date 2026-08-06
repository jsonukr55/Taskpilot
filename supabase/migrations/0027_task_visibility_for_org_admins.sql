-- ============================================================
-- 0027_task_visibility_for_org_admins.sql
-- Fix: activity / comments / attachments were invisible to org owners &
-- admins who aren't space MEMBERS. 0022 taught the board (tasks, groups,
-- columns) to show for anyone who can_view_space(), but the task-scoped
-- helpers stayed space-membership-only:
--   • can_view_task()    gates SELECT on task_activity, task_comments, task_attachments
--   • can_comment_task() gates INSERT/DELETE on comments & attachments
-- So an org admin opened a task and saw an empty Activity/Comments/Files
-- even when rows existed.
--
-- Fix: align both with the space's own visibility/edit model —
--   view    → can_view_space (space member OR org admin OR global admin)
--   comment → space editor OR org admin (can_admin_org, which includes global)
-- Portable: plain SQL over existing SECURITY DEFINER helpers.
-- ============================================================

create or replace function public.can_view_task(t text)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists(
    select 1 from tasks
    where id = t and (
      user_id = auth.uid()
      or (group_id is not null and is_group_member(group_id))
      or (space_id is not null and can_view_space(space_id))
      or auth.uid() = any(assignee_ids)
    )
  );
$$;

create or replace function public.can_comment_task(t text)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists(
    select 1 from tasks tk
    left join spaces s on s.id = tk.space_id
    where tk.id = t and (
      tk.user_id = auth.uid()
      or (tk.group_id is not null and can_edit_group(tk.group_id))
      or (tk.space_id is not null and (can_edit_space(tk.space_id) or can_admin_org(s.org_id)))
      or auth.uid() = any(tk.assignee_ids)
    )
  );
$$;
