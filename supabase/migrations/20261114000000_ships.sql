-- Live ships cache for the "ships" Edge Function (packages/tools/src/ships-relay.ts).
-- Only the function (service role) touches these tables; no one else can read or write.

create table if not exists public.ships (
  mmsi integer primary key,
  lng double precision,
  lat double precision,
  sog real,
  cog smallint,
  hdg smallint,
  nav smallint,
  at timestamptz,
  name text,
  callsign text,
  imo integer,
  type smallint,
  len smallint,
  beam smallint,
  draught real,
  dest text,
  eta text,
  seen_at timestamptz not null default now()
);
create index if not exists ships_pos on public.ships (lat, lng);
create index if not exists ships_seen on public.ships (seen_at);

-- One point every 3 minutes per moving ship, kept 12 hours.
create table if not exists public.ship_track (
  mmsi integer not null,
  at timestamptz not null,
  lng double precision not null,
  lat double precision not null,
  primary key (mmsi, at)
);
create index if not exists ship_track_at on public.ship_track (at);

-- 10-degree tiles someone looked at recently (id = row * 36 + col).
create table if not exists public.ship_tiles (id integer primary key, wanted_at timestamptz not null);

-- Who is streaming from aisstream now: one stream at a time for everyone.
create table if not exists public.ship_lease (id integer primary key, until timestamptz);
insert into public.ship_lease (id, until) values (1, null) on conflict (id) do nothing;

alter table public.ships enable row level security;
alter table public.ship_track enable row level security;
alter table public.ship_tiles enable row level security;
alter table public.ship_lease enable row level security;
revoke all on public.ships, public.ship_track, public.ship_tiles, public.ship_lease from anon, authenticated;

-- Ships in a box (recent enough to still be there), marking the box's tiles as wanted. With
-- `stream`, also tries to take the stream lease; on success `boxes` lists the tiles to stream.
create or replace function public.ships_get(w double precision, s double precision, e double precision, n double precision, max_rows integer, tiles integer[], max_tiles integer, stream boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  got integer;
  boxes jsonb;
  rows jsonb;
begin
  if coalesce(array_length(tiles, 1), 0) > 0 then
    insert into ship_tiles (id, wanted_at) select unnest(tiles), now()
      on conflict (id) do update set wanted_at = excluded.wanted_at;
  end if;
  if stream then
    update ship_lease set until = now() + interval '45 seconds'
      where id = 1 and (until is null or until < now()) returning 1 into got;
    if got is not null then
      select jsonb_agg(jsonb_build_array((id % 36) * 10 - 180, (id / 36) * 10 - 90, (id % 36) * 10 - 170, (id / 36) * 10 - 80))
        into boxes
        from (select id from ship_tiles where wanted_at > now() - interval '3 minutes' order by wanted_at desc, id limit max_tiles) t;
      if boxes is null then
        update ship_lease set until = null where id = 1;
      end if;
    end if;
  end if;
  select jsonb_agg(jsonb_build_array(mmsi, lng, lat, sog, cog, hdg, nav, extract(epoch from at)::bigint, name, type, len, beam, draught, dest, eta, imo, callsign))
    into rows
    from (
      select * from ships
      where lat between s and n and lng between w and e and at is not null
        and (at > now() - interval '30 minutes' or (coalesce(sog, 0) < 0.5 and at > now() - interval '6 hours'))
      order by at desc
      limit max_rows
    ) x;
  return jsonb_build_object('ships', coalesce(rows, '[]'::jsonb), 'boxes', boxes);
end;
$$;

-- Stores what one stream heard: [{ mmsi, lng?, lat?, sog?, cog?, hdg?, nav?, at? (unix s), name?, callsign?,
-- imo?, type?, a?, b?, c?, d?, draught?, dest?, eta? }]. `done` ends the stream lease.
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
  select r.mmsi, to_timestamp(r.at - r.at % 180), r.lng, r.lat
  from jsonb_to_recordset(rows) as r(mmsi integer, lng double precision, lat double precision, sog real, at bigint)
  where r.mmsi is not null and r.at is not null and r.lng is not null and coalesce(r.sog, 0) >= 0.5
  on conflict do nothing;

  if done then
    update ship_lease set until = null where id = 1;
  end if;
  -- Now and then, forget ships not heard for a day and track points older than 12 hours.
  if random() < 0.05 then
    delete from ships where seen_at < now() - interval '1 day';
    delete from ship_track where at < now() - interval '12 hours';
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
  from ship_track where mmsi = ship and at > now() - interval '12 hours';
$$;

revoke execute on function public.ships_get(double precision, double precision, double precision, double precision, integer, integer[], integer, boolean) from public, anon, authenticated;
revoke execute on function public.ships_put(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.ships_track(integer) from public, anon, authenticated;
grant execute on function public.ships_get(double precision, double precision, double precision, double precision, integer, integer[], integer, boolean) to service_role;
grant execute on function public.ships_put(jsonb, boolean) to service_role;
grant execute on function public.ships_track(integer) to service_role;
