-- Run once in Supabase Dashboard → SQL Editor.
-- New accounts receive exactly three free cheatsheet credits.
alter table public.profiles alter column credits set default 3;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, credits) values (new.id, 3);
  return new;
end;
$$ language plpgsql security definer;
