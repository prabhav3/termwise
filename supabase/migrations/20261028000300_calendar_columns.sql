-- Google / Outlook connections: the dedicated "Termwise" calendar and task list ids are
-- server-managed.
--
-- calendar-sync writes into, and deletes leftover entries from, whatever calendar or list
-- external_calendar_id / task_list_id name, using the connection's own OAuth tokens. The app must
-- not be able to point them at another calendar the account can write to (its main calendar, or
-- a calendar someone shared with it): calendar-sync (service role) records the container it found
-- or created, and calendar-oauth-finish (service role) clears them when the account changes.
--
-- A column privilege can't express this: Apple connections keep the same columns for the
-- on-device sync, which the app writes. So a trigger refuses, for the anon / authenticated roles
-- only, any value on a Google / Microsoft row that the server didn't set. Students still change
-- delivery, sync_plan_blocks and everything else on their rows as before.
create or replace function public.guard_cloud_calendar_containers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or new.provider not in ('google', 'microsoft') then
    return new;
  end if;
  if tg_op = 'INSERT' or old.provider is distinct from new.provider then
    -- A cloud row the app creates (or turns an Apple row into) starts with no container.
    if new.external_calendar_id is not null or new.task_list_id is not null then
      raise exception 'calendar container ids are managed by Termwise' using errcode = '42501';
    end if;
  elsif new.external_calendar_id is distinct from old.external_calendar_id
     or new.task_list_id is distinct from old.task_list_id then
    raise exception 'calendar container ids are managed by Termwise' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_cloud_calendar_containers() from public, anon, authenticated;

create trigger calendar_connections_guard_containers
  before insert or update on public.calendar_connections
  for each row execute function public.guard_cloud_calendar_containers();
