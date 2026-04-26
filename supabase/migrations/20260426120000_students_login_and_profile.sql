-- Сопоставление с приложением: уникальный логин для поиска id при входе
alter table public.students
  add column if not exists login text;

create unique index if not exists students_login_key on public.students (login)
  where login is not null and login <> '';
