-- ============================================================
-- Epic 8 — Notifications (in-app): notify a user when a task is
-- assigned to them.
-- ------------------------------------------------------------
-- A per-recipient feed. Rows are created SERVER-SIDE by a trigger on
-- tasks.assignee_ids so every assignment path (board, drawer, ETL,
-- future API) produces a notification without client cooperation.
-- Recipients read / mark-read / delete only their own rows (RLS).
-- Standard PostgreSQL → Azure-portable.
-- ============================================================

create table if not exists notifications (
  id         text primary key default gen_random_uuid()::text,
  user_id    uuid not null references profiles(id) on delete cascade,   -- recipient
  actor_id   uuid references profiles(id) on delete set null,           -- who triggered it
  type       text not null,                                             -- e.g. 'task_assigned'
  task_id    text references tasks(id) on delete cascade,
  title      text not null,
  body       text not null,
  read       boolean not null default false,
  client_id  text references clients(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user    on notifications(user_id);
create index if not exists idx_notifications_unread  on notifications(user_id, read);
create index if not exists idx_notifications_created on notifications(created_at desc);

-- ---- Assignment trigger ------------------------------------
-- Inserts one notification per NEWLY-added assignee (excluding the
-- actor assigning themselves). Runs as owner (SECURITY DEFINER) so it
-- can write rows for other users despite RLS.
create or replace function notify_task_assignment() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  added uuid[];
  u uuid;
  actor uuid := auth.uid();
  actor_name text;
begin
  if TG_OP = 'INSERT' then
    added := coalesce(new.assignee_ids, '{}');
  else
    added := array(
      select unnest(coalesce(new.assignee_ids, '{}'))
      except
      select unnest(coalesce(old.assignee_ids, '{}'))
    );
  end if;

  if added is null or array_length(added, 1) is null then
    return new;
  end if;

  select display_name into actor_name from profiles where id = actor;

  foreach u in array added loop
    if u is distinct from actor then
      insert into notifications(user_id, actor_id, type, task_id, title, body, client_id)
      values (u, actor, 'task_assigned', new.id,
              'New assignment',
              coalesce(actor_name, 'Someone') || ' assigned you to "' || new.title || '"',
              new.client_id);
    end if;
  end loop;

  return new;
end $$;
revoke execute on function notify_task_assignment() from public, anon, authenticated;

drop trigger if exists trg_task_assignment_notify on tasks;
create trigger trg_task_assignment_notify
  after insert or update of assignee_ids on tasks
  for each row execute function notify_task_assignment();

-- ---- RLS: recipients manage only their own notifications ----
-- (No insert policy: only the SECURITY DEFINER trigger creates rows.)
alter table notifications enable row level security;
create policy notif_select on notifications for select using (user_id = auth.uid());
create policy notif_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on notifications for delete using (user_id = auth.uid());

alter publication supabase_realtime add table notifications;
