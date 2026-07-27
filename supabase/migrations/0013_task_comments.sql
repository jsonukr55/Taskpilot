-- ============================================================
-- Epic 5 — Threaded comments on tasks (text-first)
-- ------------------------------------------------------------
-- A task carries a flat set of comments; each comment may reference a
-- parent comment (parent_id) to form a one-level post → replies thread.
-- Image attachments arrive later with the file-storage epic (Epic 6).
--
-- Tenancy: client_id auto-stamped from the parent task (Epic 11 pattern).
-- Visibility mirrors the task itself; posting requires task edit rights
-- so org/space VIEWERS stay read-only (Epic 9).
-- Standard PostgreSQL → Azure-portable.
-- ============================================================

create table if not exists task_comments (
  id           text primary key default gen_random_uuid()::text,
  task_id      text not null references tasks(id) on delete cascade,
  parent_id    text references task_comments(id) on delete cascade,  -- null = top-level post
  author_id    uuid not null references profiles(id),
  author_name  text not null,
  author_photo text,
  body         text not null,
  client_id    text references clients(id) on delete cascade,        -- auto-stamped
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_task_comments_task   on task_comments(task_id);
create index if not exists idx_task_comments_parent on task_comments(parent_id);
create index if not exists idx_task_comments_client on task_comments(client_id);
create trigger trg_task_comments_updated before update on task_comments
  for each row execute function set_updated_at();

-- ---- Tenant auto-stamp (trigger-only, not RPC-callable) ----
create or replace function stamp_client_task_comment() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  select client_id into new.client_id from tasks where id = new.task_id;
  return new;
end $$;
revoke execute on function stamp_client_task_comment() from public, anon, authenticated;

create trigger trg_task_comments_client before insert or update of task_id on task_comments
  for each row execute function stamp_client_task_comment();

-- ---- Access helpers (mirror the task select / update predicates) ----
-- Can the caller SEE this task (and therefore its comments)?
create or replace function can_view_task(t text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from tasks
    where id = t and (
      user_id = auth.uid()
      or (group_id is not null and is_group_member(group_id))
      or (space_id is not null and is_space_member(space_id))
      or auth.uid() = any(assignee_ids)
    )
  );
$$;

-- Can the caller CONTRIBUTE to this task (post a comment)? Excludes viewers.
create or replace function can_comment_task(t text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from tasks
    where id = t and (
      user_id = auth.uid()
      or (group_id is not null and can_edit_group(group_id))
      or (space_id is not null and can_edit_space(space_id))
      or auth.uid() = any(assignee_ids)
    )
  );
$$;

-- ---- RLS ----
alter table task_comments enable row level security;
create policy tc_select on task_comments for select using (can_view_task(task_id));
create policy tc_insert on task_comments for insert with check (can_comment_task(task_id) and author_id = auth.uid());
create policy tc_update on task_comments for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy tc_delete on task_comments for delete using (author_id = auth.uid());

alter publication supabase_realtime add table task_comments;
