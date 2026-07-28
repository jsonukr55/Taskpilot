-- ============================================================
-- Epic 6 — File & media uploads
-- ------------------------------------------------------------
-- Private "attachments" bucket + a task_attachments metadata table.
-- Files live under {taskId}/{uuid}-{name}. Access is gated by task
-- permissions (can_view_task / can_comment_task), both on the storage
-- objects and the metadata rows.
--
-- Portability: the metadata table is standard PostgreSQL. Storage calls
-- are isolated in StorageService (supabase-js .storage) — the Azure Blob
-- swap is confined to that one service.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)      -- 25 MB per file
on conflict (id) do nothing;

-- ---- Storage object access (path's first folder = task id) ----
drop policy if exists att_read   on storage.objects;
drop policy if exists att_insert on storage.objects;
drop policy if exists att_delete on storage.objects;
create policy att_read   on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and can_view_task((storage.foldername(name))[1]));
create policy att_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and can_comment_task((storage.foldername(name))[1]));
create policy att_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and can_comment_task((storage.foldername(name))[1]));

-- ---- Metadata ----
create table if not exists task_attachments (
  id            text primary key default gen_random_uuid()::text,
  task_id       text not null references tasks(id) on delete cascade,
  name          text not null,
  mime          text,
  size          bigint not null default 0,
  path          text not null,                       -- object path within the bucket
  uploader_id   uuid references profiles(id) on delete set null,
  uploader_name text,
  client_id     text references clients(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists idx_task_attachments_task   on task_attachments(task_id);
create index if not exists idx_task_attachments_client on task_attachments(client_id);

-- Tenant auto-stamp (trigger-only; not RPC-callable)
create or replace function stamp_client_attachment() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  select client_id into new.client_id from tasks where id = new.task_id;
  return new;
end $$;
revoke execute on function stamp_client_attachment() from public, anon, authenticated;
drop trigger if exists trg_task_attachments_client on task_attachments;
create trigger trg_task_attachments_client before insert or update of task_id on task_attachments
  for each row execute function stamp_client_attachment();

alter table task_attachments enable row level security;
create policy ta_att_select on task_attachments for select using (can_view_task(task_id));
create policy ta_att_insert on task_attachments for insert with check (can_comment_task(task_id) and uploader_id = auth.uid());
create policy ta_att_delete on task_attachments for delete using (uploader_id = auth.uid() or can_comment_task(task_id));

alter publication supabase_realtime add table task_attachments;
