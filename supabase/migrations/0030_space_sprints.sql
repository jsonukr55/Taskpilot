-- ============================================================
-- 0030_space_sprints.sql
-- Managed sprint names per space. Sprints were free-typed strings on tasks
-- with no way to define them; this stores the space's sprint list so the
-- Sprint view shows managed columns and the Sprint field picks from them.
-- Stored as a text[] on the space (reuses the space's existing RLS + realtime).
-- Portable: plain column; travels via pg_dump.
-- ============================================================

alter table public.spaces
  add column if not exists sprints text[] not null default '{}';
