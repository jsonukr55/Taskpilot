-- ============================================================
-- TaskPilot — Row-Level Security (mirrors the Firestore rules)
-- Helper functions are SECURITY DEFINER + STABLE so policies that
-- read membership tables don't recurse into their own RLS.
-- service_role (Edge Functions) bypasses RLS entirely.
-- ============================================================

-- ---- Membership / role helpers --------------------------------------
create or replace function is_global_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and global_role = 'admin');
$$;

create or replace function is_group_member(g text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from group_members where group_id = g and user_id = auth.uid());
$$;
create or replace function can_edit_group(g text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from group_members where group_id = g and user_id = auth.uid() and role in ('owner','editor'));
$$;
create or replace function is_group_owner(g text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from groups where id = g and owner_id = auth.uid());
$$;

create or replace function is_org_member(o text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from org_members where org_id = o and user_id = auth.uid());
$$;
create or replace function is_org_owner(o text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from organizations where id = o and owner_id = auth.uid());
$$;
create or replace function can_manage_org(o text) returns boolean
  language sql security definer stable set search_path = public as $$
  select is_org_owner(o) or is_global_admin();
$$;

create or replace function is_space_member(s text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from space_members where space_id = s and user_id = auth.uid());
$$;
create or replace function can_edit_space(s text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from space_members where space_id = s and user_id = auth.uid() and role in ('owner','editor'));
$$;
create or replace function is_space_owner(s text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from spaces where id = s and owner_id = auth.uid());
$$;
create or replace function space_org(s text) returns text
  language sql security definer stable set search_path = public as $$
  select org_id from spaces where id = s;
$$;

create or replace function note_owner(n text) returns uuid
  language sql security definer stable set search_path = public as $$
  select owner_id from notes where id = n;
$$;
create or replace function note_group(n text) returns text
  language sql security definer stable set search_path = public as $$
  select group_id from notes where id = n;
$$;
create or replace function report_group(r text) returns text
  language sql security definer stable set search_path = public as $$
  select group_id from daily_reports where id = r;
$$;
create or replace function report_locked(r text) returns boolean
  language sql security definer stable set search_path = public as $$
  select status = 'locked' from daily_reports where id = r;
$$;

-- ---- Guard: only the server (service_role) may set global_role -------
create or replace function guard_global_role() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if TG_OP = 'INSERT' then
      new.global_role := null;
    elsif TG_OP = 'UPDATE' and new.global_role is distinct from old.global_role then
      new.global_role := old.global_role;   -- silently ignore client attempts
    end if;
  end if;
  return new;
end $$;
create trigger trg_profiles_guard_role before insert or update on profiles
  for each row execute function guard_global_role();

-- ---- Invite preview RPCs (get-by-token without enabling enumeration) --
create or replace function preview_invite(p_token text)
  returns table(group_name text, group_icon text, role text)
  language sql security definer stable set search_path = public as $$
  select group_name, group_icon, role from invites
  where token = p_token and not revoked
    and (expires_at is null or expires_at > now());
$$;
create or replace function preview_org_invite(p_token text)
  returns table(org_name text, org_icon text)
  language sql security definer stable set search_path = public as $$
  select org_name, org_icon from org_invites
  where token = p_token and not revoked
    and (expires_at is null or expires_at > now());
$$;
grant execute on function preview_invite(text)     to authenticated;
grant execute on function preview_org_invite(text) to authenticated;

-- ============================================================
-- Enable RLS + policies
-- ============================================================
alter table profiles       enable row level security;
alter table categories     enable row level security;
alter table groups         enable row level security;
alter table group_members  enable row level security;
alter table organizations  enable row level security;
alter table org_members    enable row level security;
alter table spaces         enable row level security;
alter table space_members  enable row level security;
alter table tasks          enable row level security;
alter table notes          enable row level security;
alter table note_comments  enable row level security;
alter table schedules      enable row level security;
alter table insights       enable row level security;
alter table daily_reports  enable row level security;
alter table daily_entries  enable row level security;
alter table invites        enable row level security;
alter table org_invites    enable row level security;
alter table settings       enable row level security;
alter table usage_logs     enable row level security;

-- ---- profiles: self only (global_role protected by trigger) ---------
create policy profiles_select on profiles for select using (id = auth.uid());
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- categories / schedules: user-isolated --------------------------
create policy categories_all on categories for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy schedules_all  on schedules  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- insights: read own; writes via service role only ---------------
create policy insights_select on insights for select using (user_id = auth.uid());

-- ---- groups + members ----------------------------------------------
create policy groups_select on groups for select using (is_group_member(id));
create policy groups_insert on groups for insert with check (owner_id = auth.uid());
create policy groups_update on groups for update using (is_group_owner(id)) with check (is_group_owner(id));
create policy groups_delete on groups for delete using (is_group_owner(id));

create policy gm_select on group_members for select using (is_group_member(group_id) or user_id = auth.uid());
create policy gm_insert on group_members for insert with check (is_group_owner(group_id));
create policy gm_update on group_members for update using (is_group_owner(group_id)) with check (is_group_owner(group_id));
create policy gm_delete on group_members for delete using (is_group_owner(group_id) or user_id = auth.uid());

-- ---- organizations + members ---------------------------------------
create policy orgs_select on organizations for select using (is_org_member(id) or is_global_admin());
create policy orgs_insert on organizations for insert with check (is_global_admin() and owner_id = auth.uid());
create policy orgs_update on organizations for update using (can_manage_org(id)) with check (can_manage_org(id));
create policy orgs_delete on organizations for delete using (can_manage_org(id));

create policy om_select on org_members for select using (is_org_member(org_id) or user_id = auth.uid());
create policy om_insert on org_members for insert with check (is_org_owner(org_id));
create policy om_update on org_members for update using (can_manage_org(org_id)) with check (can_manage_org(org_id));
create policy om_delete on org_members for delete using (can_manage_org(org_id) or user_id = auth.uid());

-- ---- spaces + members ----------------------------------------------
create policy spaces_select on spaces for select using (is_space_member(id));
create policy spaces_insert on spaces for insert with check (is_org_member(org_id) and owner_id = auth.uid());
create policy spaces_update on spaces for update using (can_edit_space(id) or is_org_owner(org_id)) with check (can_edit_space(id) or is_org_owner(org_id));
create policy spaces_delete on spaces for delete using (is_space_owner(id) or is_org_owner(org_id));

create policy sm_select on space_members for select using (is_space_member(space_id) or user_id = auth.uid());
create policy sm_insert on space_members for insert with check (is_space_owner(space_id) or can_edit_space(space_id) or is_org_owner(space_org(space_id)));
create policy sm_update on space_members for update using (can_edit_space(space_id) or is_org_owner(space_org(space_id)));
create policy sm_delete on space_members for delete using (can_edit_space(space_id) or is_org_owner(space_org(space_id)) or user_id = auth.uid());

-- ---- tasks: personal | group | space | assigned --------------------
create policy tasks_select on tasks for select using (
  user_id = auth.uid()
  or (group_id is not null and is_group_member(group_id))
  or (space_id is not null and is_space_member(space_id))
  or (auth.uid() = any(assignee_ids))
);
create policy tasks_insert on tasks for insert with check (
  user_id = auth.uid()
  and (group_id is null or can_edit_group(group_id))
  and (space_id is null or can_edit_space(space_id))
);
create policy tasks_update on tasks for update using (
  user_id = auth.uid()
  or (group_id is not null and can_edit_group(group_id))
  or (space_id is not null and can_edit_space(space_id))
  or (auth.uid() = any(assignee_ids))
);
create policy tasks_delete on tasks for delete using (
  user_id = auth.uid()
  or (group_id is not null and can_edit_group(group_id))
  or (space_id is not null and can_edit_space(space_id))
);

-- ---- notes: personal (owner) | group (members read, editors write) --
create policy notes_select on notes for select using (
  owner_id = auth.uid() or (group_id is not null and is_group_member(group_id))
);
create policy notes_insert on notes for insert with check (
  (group_id is null and owner_id = auth.uid()) or (group_id is not null and can_edit_group(group_id))
);
create policy notes_update on notes for update using (
  owner_id = auth.uid() or (group_id is not null and can_edit_group(group_id))
);
create policy notes_delete on notes for delete using (
  owner_id = auth.uid() or (group_id is not null and can_edit_group(group_id))
);

-- ---- note comments --------------------------------------------------
create policy nc_select on note_comments for select using (
  note_owner(note_id) = auth.uid()
  or (note_group(note_id) is not null and is_group_member(note_group(note_id)))
);
create policy nc_insert on note_comments for insert with check (
  author_id = auth.uid() and (
    note_owner(note_id) = auth.uid()
    or (note_group(note_id) is not null and is_group_member(note_group(note_id)))
  )
);
create policy nc_update on note_comments for update using (
  author_id = auth.uid()
  or note_owner(note_id) = auth.uid()
  or (note_group(note_id) is not null and is_group_owner(note_group(note_id)))
);
create policy nc_delete on note_comments for delete using (
  author_id = auth.uid()
  or note_owner(note_id) = auth.uid()
  or (note_group(note_id) is not null and is_group_owner(note_group(note_id)))
);

-- ---- daily reports + entries ---------------------------------------
create policy dr_select on daily_reports for select using (is_group_member(group_id));
create policy dr_insert on daily_reports for insert with check (is_group_member(group_id) and status = 'draft');
create policy dr_update on daily_reports for update using (is_group_owner(group_id)) with check (is_group_owner(group_id));
create policy dr_delete on daily_reports for delete using (is_group_owner(group_id));

create policy de_select on daily_entries for select using (is_group_member(report_group(report_id)));
create policy de_insert on daily_entries for insert with check (
  not report_locked(report_id)
  and (user_id = auth.uid() or is_group_owner(report_group(report_id)))
);
create policy de_update on daily_entries for update using (
  not report_locked(report_id)
  and (user_id = auth.uid() or is_group_owner(report_group(report_id)))
);
create policy de_delete on daily_entries for delete using (is_group_owner(report_group(report_id)));

-- ---- invites: editors/owners list & manage; preview via RPC ---------
create policy inv_select on invites for select using (can_edit_group(group_id));
create policy inv_insert on invites for insert with check (can_edit_group(group_id));
create policy inv_update on invites for update using (can_edit_group(group_id));
create policy inv_delete on invites for delete using (can_edit_group(group_id));

create policy oi_select on org_invites for select using (can_manage_org(org_id));
create policy oi_insert on org_invites for insert with check (can_manage_org(org_id));
create policy oi_update on org_invites for update using (can_manage_org(org_id));
create policy oi_delete on org_invites for delete using (can_manage_org(org_id));

-- ---- settings: global read-only -------------------------------------
create policy settings_select on settings for select using (auth.uid() is not null);

-- usage_logs: no client policies → clients denied; service role writes.
