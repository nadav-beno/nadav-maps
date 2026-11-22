-- Ships worldwide (packages/tools/src/ships-relay.ts now streams the whole world, not only the
-- areas someone looked at). Two changes to 20261114000000_ships.sql:
-- 1. A world of moving ships would fill ship_track fast, so a track keeps one point every
--    10 minutes (was 3) for 8 hours (was 12): about a twentieth of the rows.
-- 2. A cron job pokes the relay once a minute, so the stream runs (half a minute of every minute)
--    and the map is full when someone opens it, not only after they wait.
-- Safe to run more than once.

create or replace function public.ships_put(rows jsonb, done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into ships as sh (mmsi, lng, lat, sog, cog, hdg, nav, at, name, callsign, imo, type, len, beam, draught, dest, eta, seen_at)
  select r.mmsi, r.lng, r.lat, r.sog, r.cog, r.hdg, r.nav, to_timestamp(r.at), r.name, r.callsign, nullif(r.imo, 0), nullif(r.type, 0),
    case when coalesce(r.a, 0) + coalesce(r.b, 0) between 1 and 499 then r.a + r.b end,
    case when coalesce(r.c, 0) + coalesce(r.d, 0) between 1 and 79 then r.c + r.d end,
    nullif(r.draught, 0), r.dest, r.eta, now()
  from jsonb_to_recordset(rows) as r(mmsi integer, lng double precision, lat double precision, sog real, cog integer, hdg integer, nav integer, at bigint,
    name text, callsign text, imo integer, type integer, a integer, b integer, c integer, d integer, draught real, dest text, eta text)
  where r.mmsi is not null
  on conflict (mmsi) do update set
    lng = case when excluded.at is not null and (sh.at is null or excluded.at >= sh.at) then excluded.lng else sh.lng end,
    lat = case when excluded.at is not null and (sh.at is null or excluded.at >= sh.at) then excluded.lat else sh.lat end,
    sog = case when excluded.at is not null and (sh.at is null or excluded.at >= sh.at) then excluded.sog else sh.sog end,
    cog = case when excluded.at is not null and (sh.at is null or excluded.at >= sh.at) then excluded.cog else sh.cog end,
    hdg = case when excluded.at is not null and (sh.at is null or excluded.at >= sh.at) then excluded.hdg else sh.hdg end,
    at = case when excluded.at is not null and (sh.at is null or excluded.at >= sh.at) then excluded.at else sh.at end,
    nav = coalesce(excluded.nav, sh.nav),
    name = coalesce(excluded.name, sh.name),
    callsign = coalesce(excluded.callsign, sh.callsign),
    imo = coalesce(excluded.imo, sh.imo),
    type = coalesce(excluded.type, sh.type),
    len = coalesce(excluded.len, sh.len),
    beam = coalesce(excluded.beam, sh.beam),
    draught = coalesce(excluded.draught, sh.draught),
    dest = coalesce(excluded.dest, sh.dest),
    eta = coalesce(excluded.eta, sh.eta),
    seen_at = now();

  insert into ship_track (mmsi, at, lng, lat)
  select r.mmsi, to_timestamp(r.at - r.at % 600), r.lng, r.lat
  from jsonb_to_recordset(rows) as r(mmsi integer, lng double precision, lat double precision, sog real, at bigint)
  where r.mmsi is not null and r.at is not null and r.lng is not null and coalesce(r.sog, 0) >= 0.5
  on conflict do nothing;

  if done then
    update ship_lease set until = null where id = 1;
  end if;
  -- Now and then, forget ships not heard for a day and track points older than 8 hours.
  if random() < 0.05 then
    delete from ships where seen_at < now() - interval '1 day';
    delete from ship_track where at < now() - interval '8 hours';
  end if;
end;
$$;

create or replace function public.ships_track(ship integer)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(lng, lat, extract(epoch from at)::bigint) order by at), '[]'::jsonb)
  from ship_track where mmsi = ship and at > now() - interval '8 hours';
$$;

-- Points from before the change, one every 3 minutes: keep one every 10.
delete from ship_track where extract(epoch from at)::bigint % 600 <> 0;

revoke execute on function public.ships_put(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.ships_track(integer) from public, anon, authenticated;
grant execute on function public.ships_put(jsonb, boolean) to service_role;
grant execute on function public.ships_track(integer) to service_role;

-- The minute poke: a tiny box, which marks one tile as wanted, so the relay streams the world.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('ships-keep-fresh') where exists (select 1 from cron.job where jobname = 'ships-keep-fresh');
select cron.schedule('ships-keep-fresh', '* * * * *', $cron$
  select net.http_post(
    url := 'https://wysmzvzpmtptckngegvo.supabase.co/functions/v1/ships',
    body := '{"box":[34.9,32.8,35.0,32.9]}'::jsonb,
    headers := '{"content-type":"application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
$cron$);
