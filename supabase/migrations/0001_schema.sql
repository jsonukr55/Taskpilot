-- ============================================================
-- TaskPilot — Postgres schema (Supabase)
-- Mirrors the current Firestore model 1:1 so services keep their
-- public API. Design choices:
--   • profiles.id = auth.users.id (uuid); all user refs are uuid.
--   • Domain entity ids are text (client keeps slug/nanoid ids for
--     groups/orgs/spaces; auto ids default to gen_random_uuid()::text).
--   • Memberships are proper join tables (the relational upgrade).
--   • Nested content stays JSONB (blocks, checklist, preferences, …).
--   • id-lists (assignees, categories, tags) stay Postgres arrays so
--     `= ANY(...)` / `@>` replace Firestore array-contains.
-- ============================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---- updated_at trigger helper --------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- profiles  (was users/{uid})
-- ============================================================
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null default 'User',
  photo_url    text,
  -- Platform role. null = normal user; 'admin' = global super-admin.
  global_role  text check (global_role in ('admin')),
  preferences  jsonb not null default '{}'::jsonb,
  stats        jsonb not null default '{}'::jsonb,
  calendar_integrations jsonb not null default '[]'::jsonb,
  seen_insight_ids      text[] not null default '{}',
  note_access  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- ============================================================
-- categories  (user-isolated)
-- ============================================================
create table if not exists categories (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null,
  description text,
  icon        text not null default '📁',
  color       text not null default '#6366f1',
  parent_id   text references categories(id) on delete set null,
  keywords    text[] not null default '{}',
  rules       jsonb not null default '{}'::jsonb,
  "order"     int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_categories_user on categories(user_id);
create trigger trg_categories_updated before update on categories
  for each row execute function set_updated_at();

-- ============================================================
-- groups  +  group_members
-- ============================================================
create table if not exists groups (
  id          text primary key,                       -- slugId from the client
  name        text not null,
  description text,
  icon        text not null default '👥',
  color       text not null default '#6366f1',
  owner_id    uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_groups_updated before update on groups
  for each row execute function set_updated_at();

create table if not exists group_members (
  group_id     text not null references groups(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         text not null default 'viewer' check (role in ('owner','editor','viewer')),
  display_name text not null default 'Member',
  photo_url    text,
  added_at     timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists idx_group_members_user on group_members(user_id);

-- ============================================================
-- organizations  +  org_members
-- ============================================================
create table if not exists organizations (
  id          text primary key,                       -- slugId from the client
  name        text not null,
  description text,
  icon        text not null default '🏢',
  color       text not null default '#6366f1',
  owner_id    uuid not null references profiles(id) on delete cascade,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_orgs_updated before update on organizations
  for each row execute function set_updated_at();

create table if not exists org_members (
  org_id       text not null references organizations(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  display_name text not null default 'Member',
  photo_url    text,
  added_at     timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists idx_org_members_user on org_members(user_id);

-- ============================================================
-- spaces  +  space_members
-- ============================================================
create table if not exists spaces (
  id          text primary key,                       -- slugId from the client
  org_id      text not null references organizations(id) on delete cascade,
  name        text not null,
  description text,
  icon        text not null default '📁',
  color       text not null default '#6366f1',
  owner_id    uuid not null references profiles(id) on delete cascade,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_spaces_org on spaces(org_id);
create trigger trg_spaces_updated before update on spaces
  for each row execute function set_updated_at();

create table if not exists space_members (
  space_id     text not null references spaces(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         text not null default 'editor' check (role in ('owner','editor','viewer')),
  display_name text not null default 'Member',
  photo_url    text,
  added_at     timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists idx_space_members_user on space_members(user_id);

-- ============================================================
-- tasks  (personal | group | space; subtasks via parent_id)
-- ============================================================
create table if not exists tasks (
  id             text primary key default gen_random_uuid()::text,
  user_id        uuid not null references profiles(id) on delete cascade,
  group_id       text references groups(id) on delete cascade,
  org_id         text references organizations(id) on delete cascade,
  space_id       text references spaces(id) on delete cascade,
  assignee_ids   uuid[] not null default '{}',
  title          text not null,
  description    text,
  status         text not null default 'todo' check (status in ('todo','in_progress','completed','cancelled')),
  priority       text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  start_date     timestamptz,
  due_date       timestamptz,
  due_time       text,
  completed_at   timestamptz,
  estimated_hours numeric,
  actual_hours   numeric,
  parent_id      text references tasks(id) on delete cascade,
  category_ids   text[] not null default '{}',
  tags           text[] not null default '{}',
  checklist      jsonb not null default '[]'::jsonb,
  time_blocks    jsonb not null default '[]'::jsonb,
  recurrence     jsonb,
  is_scheduled   boolean not null default false,
  ai_metadata    jsonb,
  image_url      text,
  reminders      jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_tasks_user     on tasks(user_id);
create index if not exists idx_tasks_group    on tasks(group_id);
create index if not exists idx_tasks_space    on tasks(space_id);
create index if not exists idx_tasks_parent   on tasks(parent_id);
create index if not exists idx_tasks_assignees on tasks using gin (assignee_ids);
create trigger trg_tasks_updated before update on tasks
  for each row execute function set_updated_at();

-- ============================================================
-- notes  +  note_comments   (personal: owner_id; group: group_id)
-- ============================================================
create table if not exists notes (
  id          text primary key default gen_random_uuid()::text,
  group_id    text references groups(id) on delete cascade,   -- null = personal
  owner_id    uuid references profiles(id) on delete cascade, -- set on personal
  title       text not null default 'Untitled',
  icon        text default '📄',
  blocks      jsonb not null default '[]'::jsonb,
  created_by  uuid not null references profiles(id),
  updated_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_notes_owner on notes(owner_id);
create index if not exists idx_notes_group on notes(group_id);
create trigger trg_notes_updated before update on notes
  for each row execute function set_updated_at();

create table if not exists note_comments (
  id           text primary key default gen_random_uuid()::text,
  note_id      text not null references notes(id) on delete cascade,
  block_id     text not null,
  author_id    uuid not null references profiles(id) on delete cascade,
  author_name  text not null,
  author_photo text,
  body         text not null,
  resolved     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_note_comments_note on note_comments(note_id);
create trigger trg_note_comments_updated before update on note_comments
  for each row execute function set_updated_at();

-- ============================================================
-- schedules  (user-isolated time-blocks)
-- ============================================================
create table if not exists schedules (
  id               text primary key default gen_random_uuid()::text,
  user_id          uuid not null references profiles(id) on delete cascade,
  task_id          text references tasks(id) on delete cascade,
  start_time       timestamptz not null,
  end_time         timestamptz not null,
  auto_scheduled   boolean not null default false,
  calendar_event_id text,
  provider         text,
  has_conflict     boolean not null default false,
  conflict_with    text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_schedules_user on schedules(user_id);
create trigger trg_schedules_updated before update on schedules
  for each row execute function set_updated_at();

-- ============================================================
-- insights  (user-scoped; written by Edge Functions only)
-- ============================================================
create table if not exists insights (
  id         text primary key default gen_random_uuid()::text,
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null,
  icon       text,
  severity   text not null default 'info',
  read       boolean not null default false,
  dismissed  boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists idx_insights_user on insights(user_id, created_at desc);

-- ============================================================
-- daily_reports  +  daily_entries
-- ============================================================
create table if not exists daily_reports (
  id            text primary key default gen_random_uuid()::text,
  group_id      text not null references groups(id) on delete cascade,
  date          text not null,                 -- 'YYYY-MM-DD' working day
  plan_for_date text not null,
  status        text not null default 'draft' check (status in ('draft','locked')),
  locked_by     uuid,
  locked_at     timestamptz,
  member_order  uuid[] not null default '{}',
  note_id       text references notes(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (group_id, date)
);
create trigger trg_daily_reports_updated before update on daily_reports
  for each row execute function set_updated_at();

create table if not exists daily_entries (
  report_id    text not null references daily_reports(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  display_name text not null,
  photo_url    text,
  progress     jsonb not null default '[]'::jsonb,
  plan         jsonb not null default '[]'::jsonb,
  on_leave     boolean not null default false,
  submitted    boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (report_id, user_id)
);
create trigger trg_daily_entries_updated before update on daily_entries
  for each row execute function set_updated_at();

-- ============================================================
-- invites (group)  +  org_invites   (token id IS the secret)
-- ============================================================
create table if not exists invites (
  token      text primary key,
  group_id   text not null references groups(id) on delete cascade,
  group_name text not null,
  group_icon text not null,
  role       text not null check (role in ('editor','viewer')),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked    boolean not null default false,
  max_uses   int,
  use_count  int not null default 0
);
create index if not exists idx_invites_group on invites(group_id);

create table if not exists org_invites (
  token      text primary key,
  org_id     text not null references organizations(id) on delete cascade,
  org_name   text not null,
  org_icon   text not null,
  role       text not null default 'member' check (role in ('member')),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked    boolean not null default false,
  max_uses   int,
  use_count  int not null default 0
);
create index if not exists idx_org_invites_org on org_invites(org_id);

-- ============================================================
-- settings (global, read-only)  +  usage_logs (server-written)
-- ============================================================
create table if not exists settings (
  key  text primary key,
  data jsonb not null default '{}'::jsonb
);

create table if not exists usage_logs (
  id         text primary key default gen_random_uuid()::text,
  user_id    uuid,
  type       text not null,
  created_at timestamptz not null default now()
);
