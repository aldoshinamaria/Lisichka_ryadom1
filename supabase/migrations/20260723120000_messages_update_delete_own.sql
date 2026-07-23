-- Ученик может обновлять свои сообщения (upsert case_status/urgent) и удалять свои кейсы.
-- Сотрудник — любые сообщения.

drop policy if exists "messages_update_staff_only" on public.messages;
drop policy if exists "messages_update_own_or_staff" on public.messages;
create policy "messages_update_own_or_staff"
on public.messages for update
using (
  public.is_staff_or_admin()
  or exists (
    select 1 from public.students s
    where s.id = messages.student_id and s.auth_user_id = auth.uid()
  )
)
with check (
  public.is_staff_or_admin()
  or exists (
    select 1 from public.students s
    where s.id = messages.student_id and s.auth_user_id = auth.uid()
  )
);

drop policy if exists "messages_delete_own_or_staff" on public.messages;
create policy "messages_delete_own_or_staff"
on public.messages for delete
using (
  public.is_staff_or_admin()
  or exists (
    select 1 from public.students s
    where s.id = messages.student_id and s.auth_user_id = auth.uid()
  )
);
