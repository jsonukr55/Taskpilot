-- ============================================================
-- 0029_global_role_allow_superglobal.sql
-- The Superglobal role (0024) couldn't actually be saved: profiles carried a
-- leftover CHECK (global_role = 'admin') from before the tier existed, so
-- setting 'superglobal' failed with a 500. Widen the check to the real set.
-- (NULL still passes a CHECK, so a regular user with no platform role is fine.)
-- ============================================================

alter table public.profiles drop constraint if exists profiles_global_role_check;
alter table public.profiles
  add constraint profiles_global_role_check
  check (global_role is null or global_role in ('admin', 'superglobal'));
