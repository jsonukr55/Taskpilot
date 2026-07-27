-- ============================================================
-- Epic 7 (partial) — Task activity log
-- ------------------------------------------------------------
-- A per-task audit feed. Rows are written SERVER-SIDE by a trigger on
-- tasks, so every change (from any client path) is captured with the
-- acting user. Only real user actions are logged (auth.uid() present),
-- so ETL / service writes don't create noise.
-- Visibility mirrors the task (can_view_task). Standard PostgreSQL.
-- ============================================================

create table if not exists task_activity (
  id         text primary key default gen_random_uuid()::text,
  task_id    text not null references tasks(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  actor_name text,
  action     text not null,          -- 'created' | 'updated'
  field      text,                   -- which field changed (null for 'created')
  detail     text not null,          -- human-readable summary
  client_id  text references clients(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_activity_task    on task_activity(task_id);
create index if not exists idx_task_activity_created  on task_activity(created_at desc);

create or replace function log_task_activity() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  nm text;
begin
  -- Only record real, attributable user actions (skip ETL / service writes).
  if actor is null then return coalesce(new, old); end if;
  select display_name into nm from profiles where id = actor;

  if TG_OP = 'INSERT' then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'created', null, 'created this task', new.client_id);
    return new;
  end if;

  if new.title is distinct from old.title then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'title', 'renamed to “' || new.title || '”', new.client_id);
  end if;
  if new.stage is distinct from old.stage then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'status', 'set status to ' || new.stage, new.client_id);
  end if;
  if new.priority is distinct from old.priority then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'priority', 'set priority to ' || new.priority, new.client_id);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'due_date',
            case when new.due_date is null then 'cleared the due date'
                 else 'set due date to ' || to_char(new.due_date, 'Mon DD, YYYY') end, new.client_id);
  end if;
  if new.start_date is distinct from old.start_date then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'start_date',
            case when new.start_date is null then 'cleared the start date'
                 else 'set start date to ' || to_char(new.start_date, 'Mon DD, YYYY') end, new.client_id);
  end if;
  if new.sprint is distinct from old.sprint then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'sprint',
            case when new.sprint is null then 'removed from sprint'
                 else 'moved to ' || new.sprint end, new.client_id);
  end if;
  if new.space_group_id is distinct from old.space_group_id then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'section', 'moved to another section', new.client_id);
  end if;
  if new.assignee_ids is distinct from old.assignee_ids then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'assignees', 'updated assignees', new.client_id);
  end if;
  if new.description is distinct from old.description then
    insert into task_activity(task_id, actor_id, actor_name, action, field, detail, client_id)
    values (new.id, actor, nm, 'updated', 'description', 'edited the description', new.client_id);
  end if;

  return new;
end $$;
revoke execute on function log_task_activity() from public, anon, authenticated;

drop trigger if exists trg_task_activity on tasks;
create trigger trg_task_activity
  after insert or update on tasks
  for each row execute function log_task_activity();

alter table task_activity enable row level security;
create policy ta_select on task_activity for select using (can_view_task(task_id));

alter publication supabase_realtime add table task_activity;
