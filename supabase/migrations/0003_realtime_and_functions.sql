-- ============================================================
-- Realtime publication + helper RPCs
-- ============================================================

-- Stream row changes to subscribed clients (RLS still filters per user).
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table groups;
alter publication supabase_realtime add table group_members;
alter publication supabase_realtime add table organizations;
alter publication supabase_realtime add table org_members;
alter publication supabase_realtime add table spaces;
alter publication supabase_realtime add table space_members;
alter publication supabase_realtime add table notes;
alter publication supabase_realtime add table note_comments;
alter publication supabase_realtime add table daily_reports;
alter publication supabase_realtime add table daily_entries;
alter publication supabase_realtime add table schedules;
alter publication supabase_realtime add table insights;

-- ---- Category delete cascade (mirrors the old CategoryService.delete) --
-- Removes the category from the caller's tasks, deletes its direct
-- children, then the category itself. security invoker → RLS applies.
create or replace function remove_category(p_id text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update tasks
     set category_ids = array_remove(category_ids, p_id)
   where user_id = auth.uid() and category_ids @> array[p_id];
  delete from categories where parent_id = p_id;
  delete from categories where id = p_id;
end $$;
grant execute on function remove_category(text) to authenticated;
