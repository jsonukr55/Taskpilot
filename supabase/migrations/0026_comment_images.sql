-- ============================================================
-- 0026_comment_images.sql
-- Images inside a comment post. The binaries reuse the private
-- "attachments" bucket (its RLS already gates by can_comment_task for
-- writes and can_view_task for reads); we only need somewhere on the
-- comment row to remember which objects belong to it.
--
-- image_paths holds object paths within the attachments bucket, laid out
-- at {taskId}/comments/{uuid}.{ext} so the existing storage policies apply
-- unchanged. The UI renders each via a short-lived signed URL.
--
-- Portable: a plain text[] column; travels via pg_dump.
-- ============================================================

alter table public.task_comments
  add column if not exists image_paths text[] not null default '{}';
