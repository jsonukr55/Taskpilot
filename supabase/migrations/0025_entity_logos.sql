-- ============================================================
-- Entity logos — uploaded images for client / org / space / group / category
-- ------------------------------------------------------------
-- Each entity already carries an `icon` emoji. This adds an optional
-- `icon_url`: when set, the UI renders the uploaded image instead of the
-- emoji. The emoji stays as the fallback, so nothing breaks if an upload
-- is removed.
--
-- Objects live in a PUBLIC "logos" bucket under {kind}/{entityId}/{file}.
-- Public on purpose: logos render in lists, the sidebar and invite pages,
-- where per-object signed URLs would mean an async refresh on every row.
-- The stored URL is unguessable (uuid filename) but not access-controlled —
-- do not put anything confidential in this bucket. WRITES are still gated
-- per entity by can_manage_logo() below.
--
-- Portability: columns are plain PostgreSQL and travel via pg_dump. Storage
-- calls stay isolated in StorageService, so the Azure Blob swap is confined
-- to that one file (same arrangement as Epic 6 attachments).
-- ============================================================

alter table clients       add column if not exists icon_url text;
alter table organizations add column if not exists icon_url text;
alter table spaces        add column if not exists icon_url text;
alter table groups        add column if not exists icon_url text;
alter table categories    add column if not exists icon_url text;

-- ---- Bucket ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152,                      -- 2 MB per logo
        array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---- Write permission, resolved per entity kind ----
-- Mirrors each table's own UPDATE policy so uploading a logo needs exactly
-- the same rights as renaming the entity.
create or replace function can_manage_logo(kind text, entity_id text)
  returns boolean language plpgsql stable security definer
  set search_path = public as $$
begin
  case kind
    when 'clients'       then return is_platform_owner();  -- client edits are Owner-only (0024)
    when 'organizations' then return can_manage_org(entity_id);
    when 'spaces'        then return exists (
      select 1 from spaces s
       where s.id = entity_id
         and (can_edit_space(s.id) or is_org_owner(s.org_id) or can_admin_org(s.org_id)));
    when 'groups'        then return is_group_owner(entity_id);
    when 'categories'    then return exists (
      select 1 from categories c where c.id = entity_id and c.user_id = auth.uid());
    else return false;
  end case;
end $$;

-- ---- Storage object access (path = {kind}/{entityId}/{file}) ----
drop policy if exists logo_read   on storage.objects;
drop policy if exists logo_insert on storage.objects;
drop policy if exists logo_update on storage.objects;
drop policy if exists logo_delete on storage.objects;

create policy logo_read on storage.objects for select
  using (bucket_id = 'logos');

create policy logo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'logos'
    and can_manage_logo((storage.foldername(name))[1], (storage.foldername(name))[2]));

create policy logo_update on storage.objects for update to authenticated
  using (bucket_id = 'logos'
    and can_manage_logo((storage.foldername(name))[1], (storage.foldername(name))[2]));

create policy logo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'logos'
    and can_manage_logo((storage.foldername(name))[1], (storage.foldername(name))[2]));
