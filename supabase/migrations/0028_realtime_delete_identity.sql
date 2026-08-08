-- ============================================================
-- 0028_realtime_delete_identity.sql
-- Make DELETE reflect instantly on the board for all viewers.
--
-- Supabase Realtime only delivers a *filtered* change event if it can match
-- the filter against the row. For DELETE, the default replica identity sends
-- just the primary key, so a `space_id=eq.<id>` subscription can't match a
-- deleted row's space_id and the event is dropped — sections/columns kept
-- showing until a manual reload. REPLICA IDENTITY FULL includes the whole old
-- row in the DELETE event so the filter matches and the client refetches.
--
-- (The acting user also gets an optimistic client-side removal; this covers
-- other users watching the same board.)
-- Portable: standard PostgreSQL; travels via pg_dump.
-- ============================================================

alter table public.space_groups  replica identity full;
alter table public.space_columns replica identity full;
