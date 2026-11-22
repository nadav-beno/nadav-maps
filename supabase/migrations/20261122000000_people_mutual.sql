-- "אנשים": sharing that answers a request is mutual.
-- When someone asked to see me and I share with them, they share with me too, for the same
-- time (asking means they want us to see each other). A longer share they already have stays.
-- Run once in the Supabase SQL editor, after 20261116000000_people.sql.

create or replace function public.people_share(p_viewer uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.people_me();
  asked boolean;
begin
  if not public.people_connected(uid, p_viewer) then raise exception 'not connected' using errcode = '42501'; end if;
  if p_until is not null and p_until <= now() then raise exception 'bad time' using errcode = '22023'; end if;
  asked := exists (select 1 from public.people_requests where from_id = p_viewer and to_id = uid);
  insert into public.people_shares (owner, viewer, until) values (uid, p_viewer, p_until)
    on conflict (owner, viewer) do update set until = excluded.until;
  delete from public.people_requests where from_id = p_viewer and to_id = uid;
  if asked then
    insert into public.people_shares (owner, viewer, until) values (p_viewer, uid, p_until)
      on conflict (owner, viewer) do update set until = case
        when public.people_shares.until is null or excluded.until is null then null
        else greatest(public.people_shares.until, excluded.until)
      end;
    -- Their own request to me (if any) is answered by this too.
    delete from public.people_requests where from_id = uid and to_id = p_viewer;
  end if;
end $$;

revoke all on function public.people_share(uuid, timestamptz) from public, anon;
grant execute on function public.people_share(uuid, timestamptz) to authenticated;
