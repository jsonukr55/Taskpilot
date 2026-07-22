-- Allow users to create/update/delete their OWN insights (dashboard generates
-- them client-side, best-effort). Reads were already covered by insights_select.
create policy insights_insert on insights for insert with check (user_id = auth.uid());
create policy insights_update on insights for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy insights_delete on insights for delete using (user_id = auth.uid());

-- Stream settings changes (working calendar) to clients.
alter publication supabase_realtime add table settings;
