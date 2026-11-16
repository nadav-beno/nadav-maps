-- "אנשים": sharing your location with friends (packages/features/people).
--
-- Model (one row = one direction):
--   people_profiles   who you are: a name, an emoji and a colour (no photo, no phone, no email).
--   people_shares     owner shares their location with viewer, until a time or for ever.
--   people_requests   from_id asks to_id to share their location with them.
--   people_invites    a link someone sent: whoever opens it gets the sender's location (and is asked to share back).
--   people_locations  each person's LAST position only (no history), kept only while they share with someone.
--   people_alerts     "tell me when X arrives at / leaves a place", checked on the watcher's device.
--
-- Nobody can touch the tables directly: RLS is on with no policies and the client roles have no
-- table rights. Everything goes through the security definer functions below, which only ever
-- act as auth.uid() and only reveal a position to someone it is being shared with right now.

create table if not exists public.people_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  color smallint not null default 0 check (color between 0 and 11),
  code text not null unique,
  paused boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.people_shares (
  owner uuid not null references public.people_profiles (id) on delete cascade,
  viewer uuid not null references public.people_profiles (id) on delete cascade,
  until timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner, viewer),
  check (owner <> viewer)
);
create index if not exists people_shares_viewer on public.people_shares (viewer);

create table if not exists public.people_requests (
  from_id uuid not null references public.people_profiles (id) on delete cascade,
  to_id uuid not null references public.people_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists people_requests_to on public.people_requests (to_id);

create table if not exists public.people_invites (
  token text primary key,
  owner uuid not null references public.people_profiles (id) on delete cascade,
  -- How long the owner shares with whoever opens it, counted from when they open it (null = for ever).
  share_seconds integer check (share_seconds is null or share_seconds > 0),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table if not exists public.people_locations (
  user_id uuid primary key references public.people_profiles (id) on delete cascade,
  lng double precision not null check (lng between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  accuracy real,
  heading real,
  speed real,
  battery real check (battery is null or battery between 0 and 1),
  charging boolean,
  updated_at timestamptz not null default now()
);

create table if not exists public.people_alerts (
  id uuid primary key default gen_random_uuid(),
  watcher uuid not null references public.people_profiles (id) on delete cascade,
  subject uuid not null references public.people_profiles (id) on delete cascade,
  kind text not null check (kind in ('arrive', 'leave')),
  lng double precision not null,
  lat double precision not null,
  radius real not null default 150 check (radius between 50 and 5000),
  label text check (label is null or char_length(label) <= 60),
  repeat boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists people_alerts_watcher on public.people_alerts (watcher);
create index if not exists people_alerts_subject on public.people_alerts (subject);

alter table public.people_profiles enable row level security;
alter table public.people_shares enable row level security;
alter table public.people_requests enable row level security;
alter table public.people_invites enable row level security;
alter table public.people_locations enable row level security;
alter table public.people_alerts enable row level security;
revoke all on public.people_profiles, public.people_shares, public.people_requests, public.people_invites,
  public.people_locations, public.people_alerts from anon, authenticated;

-- ---------- helpers ----------

-- A short code people can read out loud: no 0/O, 1/I/L.
create or replace function public.people_new_code(len integer default 6) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out text := '';
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

create or replace function public.people_me() returns uuid
language plpgsql stable set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.people_profiles where id = uid) then
    raise exception 'no profile' using errcode = 'P0002';
  end if;
  return uid;
end $$;

-- Are two people connected at all (a share or a request either way)?
create or replace function public.people_connected(a uuid, b uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.people_shares where (owner = a and viewer = b) or (owner = b and viewer = a))
      or exists (select 1 from public.people_requests where (from_id = a and to_id = b) or (from_id = b and to_id = a));
$$;

-- ---------- profile ----------

create or replace function public.people_profile_save(p_name text, p_emoji text, p_color integer)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n text := btrim(coalesce(p_name, ''));
  c text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if char_length(n) < 1 or char_length(n) > 40 then raise exception 'bad name' using errcode = '22023'; end if;
  if exists (select 1 from public.people_profiles where id = uid) then
    update public.people_profiles set name = n, emoji = nullif(btrim(p_emoji), ''), color = greatest(0, least(11, coalesce(p_color, 0)))
      where id = uid;
  else
    loop
      c := public.people_new_code();
      exit when not exists (select 1 from public.people_profiles where code = c);
    end loop;
    insert into public.people_profiles (id, name, emoji, color, code)
      values (uid, n, nullif(btrim(p_emoji), ''), greatest(0, least(11, coalesce(p_color, 0))), c);
  end if;
  return (select json_build_object('id', id, 'name', name, 'emoji', emoji, 'color', color, 'code', code, 'paused', paused)
    from public.people_profiles where id = uid);
end $$;

-- "Hide my location": viewers keep the share but see nothing until it is switched back on.
create or replace function public.people_set_paused(p_paused boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.people_me();
begin
  update public.people_profiles set paused = coalesce(p_paused, false) where id = uid;
  if p_paused then delete from public.people_locations where user_id = uid; end if;
end $$;

-- Deletes everything about me, including the sign-in itself.
create or replace function public.people_delete_me() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.people_profiles where id = uid;
  delete from auth.users where id = uid;
end $$;

-- ---------- everything the app shows, in one call ----------

create or replace function public.people_snapshot() returns json
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me json;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select json_build_object('id', id, 'name', name, 'emoji', emoji, 'color', color, 'code', code, 'paused', paused)
    into me from public.people_profiles where id = uid;
  if me is null then return json_build_object('me', null, 'people', '[]'::json, 'now', now()); end if;

  -- Shares that ran out are gone for good.
  delete from public.people_shares where (owner = uid or viewer = uid) and until is not null and until <= now();

  return json_build_object(
    'me', me,
    'now', now(),
    'people', coalesce((
      with others as (
        select viewer as id from public.people_shares where owner = uid
        union select owner from public.people_shares where viewer = uid
        union select to_id from public.people_requests where from_id = uid
        union select from_id from public.people_requests where to_id = uid
      )
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'emoji', p.emoji, 'color', p.color,
        -- They share with me (and until when).
        'theyShare', (select json_build_object('until', s.until, 'since', s.created_at) from public.people_shares s where s.owner = p.id and s.viewer = uid),
        -- I share with them.
        'iShare', (select json_build_object('until', s.until, 'since', s.created_at) from public.people_shares s where s.owner = uid and s.viewer = p.id),
        'askedMe', exists (select 1 from public.people_requests r where r.from_id = p.id and r.to_id = uid),
        'iAsked', exists (select 1 from public.people_requests r where r.from_id = uid and r.to_id = p.id),
        'paused', p.paused and exists (select 1 from public.people_shares s where s.owner = p.id and s.viewer = uid),
        'location', (
          select json_build_object('lng', l.lng, 'lat', l.lat, 'accuracy', l.accuracy, 'heading', l.heading, 'speed', l.speed,
                                   'battery', l.battery, 'charging', l.charging, 'at', l.updated_at)
          from public.people_locations l
          where l.user_id = p.id and not p.paused
            and exists (select 1 from public.people_shares s where s.owner = p.id and s.viewer = uid)
        ),
        -- Alerts others set about me, so I always know who gets told about my movements.
        'alertsAboutMe', coalesce((select json_agg(json_build_object('id', a.id, 'kind', a.kind, 'label', a.label))
          from public.people_alerts a where a.watcher = p.id and a.subject = uid), '[]'::json),
        'myAlerts', coalesce((select json_agg(json_build_object('id', a.id, 'kind', a.kind, 'lng', a.lng, 'lat', a.lat,
                                                                'radius', a.radius, 'label', a.label, 'repeat', a.repeat))
          from public.people_alerts a where a.watcher = uid and a.subject = p.id), '[]'::json)
      ) order by p.name)
      from public.people_profiles p join others o on o.id = p.id
    ), '[]'::json)
  );
end $$;

-- ---------- my position ----------

-- Stores my last position only while I share with someone and am not hidden; otherwise drops it.
-- Returns how many people can see it now.
create or replace function public.people_publish(
  p_lng double precision, p_lat double precision, p_accuracy real, p_heading real, p_speed real, p_battery real, p_charging boolean
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.people_me();
  viewers integer;
begin
  select count(*) into viewers from public.people_shares where owner = uid and (until is null or until > now());
  if viewers = 0 or (select paused from public.people_profiles where id = uid) then
    delete from public.people_locations where user_id = uid;
    return 0;
  end if;
  insert into public.people_locations (user_id, lng, lat, accuracy, heading, speed, battery, charging, updated_at)
    values (uid, p_lng, p_lat, p_accuracy, p_heading, p_speed, p_battery, p_charging, now())
    on conflict (user_id) do update set lng = excluded.lng, lat = excluded.lat, accuracy = excluded.accuracy,
      heading = excluded.heading, speed = excluded.speed, battery = excluded.battery, charging = excluded.charging,
      updated_at = excluded.updated_at;
  return viewers;
end $$;

-- ---------- connecting ----------

-- Someone typed my code: they ask to see my location, and may share theirs with me right away.
create or replace function public.people_add_by_code(p_code text, p_share boolean, p_until timestamptz)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.people_me();
  other public.people_profiles;
begin
  select * into other from public.people_profiles where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if other.id is null then raise exception 'no such code' using errcode = 'P0002'; end if;
  if other.id = uid then raise exception 'that is you' using errcode = '22023'; end if;
  -- Ask to follow only if they don't already share with me.
  if not exists (select 1 from public.people_shares where owner = other.id and viewer = uid) then
    insert into public.people_requests (from_id, to_id) values (uid, other.id) on conflict do nothing;
  end if;
  if p_share then
    insert into public.people_shares (owner, viewer, until) values (uid, other.id, p_until)
      on conflict (owner, viewer) do update set until = excluded.until;
    delete from public.people_requests where from_id = other.id and to_id = uid;
  end if;
  return json_build_object('id', other.id, 'name', other.name, 'emoji', other.emoji, 'color', other.color);
end $$;

-- Share my location with someone I'm connected to (also answers their request). Null until = for ever.
create or replace function public.people_share(p_viewer uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.people_me();
begin
  if not public.people_connected(uid, p_viewer) then raise exception 'not connected' using errcode = '42501'; end if;
  if p_until is not null and p_until <= now() then raise exception 'bad time' using errcode = '22023'; end if;
  insert into public.people_shares (owner, viewer, until) values (uid, p_viewer, p_until)
    on conflict (owner, viewer) do update set until = excluded.until;
  delete from public.people_requests where from_id = p_viewer and to_id = uid;
end $$;

create or replace function public.people_stop_sharing(p_viewer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.people_me();
begin
  delete from public.people_shares where owner = uid and viewer = p_viewer;
  -- Their alerts about me go too: they can't see me any more.
  delete from public.people_alerts where watcher = p_viewer and subject = uid;
  if not exists (select 1 from public.people_shares where owner = uid and (until is null or until > now())) then
    delete from public.people_locations where user_id = uid;
  end if;
end $$;

-- Ask someone I'm connected to (again) to share their location with me.
create or replace function public.people_ask(p_other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.people_me();
begin
  if not public.people_connected(uid, p_other) then raise exception 'not connected' using errcode = '42501'; end if;
  if exists (select 1 from public.people_shares where owner = p_other and viewer = uid and (until is null or until > now())) then return; end if;
  insert into public.people_requests (from_id, to_id) values (uid, p_other)
    on conflict (from_id, to_id) do update set created_at = now();
end $$;

create or replace function public.people_decline(p_from uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.people_me();
begin
  delete from public.people_requests where from_id = p_from and to_id = uid;
end $$;

-- Removes a person completely, both ways.
create or replace function public.people_remove(p_other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.people_me();
begin
  delete from public.people_shares where (owner = uid and viewer = p_other) or (owner = p_other and viewer = uid);
  delete from public.people_requests where (from_id = uid and to_id = p_other) or (from_id = p_other and to_id = uid);
  delete from public.people_alerts where (watcher = uid and subject = p_other) or (watcher = p_other and subject = uid);
  if not exists (select 1 from public.people_shares where owner = uid and (until is null or until > now())) then
    delete from public.people_locations where user_id = uid;
  end if;
end $$;

-- ---------- invite links ----------

create or replace function public.people_invite_create(p_share_seconds integer) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.people_me();
  t text;
begin
  delete from public.people_invites where owner = uid and expires_at < now();
  if (select count(*) from public.people_invites where owner = uid) >= 50 then
    raise exception 'too many invites' using errcode = '54000';
  end if;
  t := public.people_new_code(12);
  insert into public.people_invites (token, owner, share_seconds) values (t, uid, p_share_seconds);
  return t;
end $$;

-- Who sent this link (for the "X invites you" card). Works before I have a profile.
create or replace function public.people_invite_peek(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return (select json_build_object('name', p.name, 'emoji', p.emoji, 'color', p.color, 'shareSeconds', i.share_seconds, 'self', p.id = auth.uid())
    from public.people_invites i join public.people_profiles p on p.id = i.owner
    where i.token = p_token and i.expires_at > now());
end $$;

-- Opening the link: the sender shares with me; I may share back right away.
create or replace function public.people_invite_accept(p_token text, p_share boolean, p_until timestamptz) returns json
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.people_me();
  inv public.people_invites;
  other public.people_profiles;
begin
  select * into inv from public.people_invites where token = p_token and expires_at > now();
  if inv.token is null then raise exception 'invite expired' using errcode = 'P0002'; end if;
  if inv.owner = uid then raise exception 'that is you' using errcode = '22023'; end if;
  insert into public.people_shares (owner, viewer, until)
    values (inv.owner, uid, case when inv.share_seconds is null then null else now() + make_interval(secs => inv.share_seconds) end)
    on conflict (owner, viewer) do update set until = excluded.until;
  delete from public.people_requests where from_id = uid and to_id = inv.owner;
  if p_share then
    insert into public.people_shares (owner, viewer, until) values (uid, inv.owner, p_until)
      on conflict (owner, viewer) do update set until = excluded.until;
  else
    -- The sender clearly wants to see me too: leave them a request to answer later.
    insert into public.people_requests (from_id, to_id) values (inv.owner, uid) on conflict do nothing;
  end if;
  select * into other from public.people_profiles where id = inv.owner;
  return json_build_object('id', other.id, 'name', other.name, 'emoji', other.emoji, 'color', other.color);
end $$;

-- ---------- arrive / leave alerts ----------

create or replace function public.people_alert_set(
  p_subject uuid, p_kind text, p_lng double precision, p_lat double precision, p_radius real, p_label text, p_repeat boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.people_me();
  id uuid;
begin
  if not exists (select 1 from public.people_shares where owner = p_subject and viewer = uid and (until is null or until > now())) then
    raise exception 'not shared with you' using errcode = '42501';
  end if;
  if (select count(*) from public.people_alerts where watcher = uid) >= 30 then
    raise exception 'too many alerts' using errcode = '54000';
  end if;
  insert into public.people_alerts (watcher, subject, kind, lng, lat, radius, label, repeat)
    values (uid, p_subject, p_kind, p_lng, p_lat, coalesce(p_radius, 150), nullif(btrim(p_label), ''), coalesce(p_repeat, false))
    returning people_alerts.id into id;
  return id;
end $$;

create or replace function public.people_alert_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.people_me();
begin
  -- The watcher removes their alert; the subject may remove an alert about them.
  delete from public.people_alerts where id = p_id and (watcher = uid or subject = uid);
end $$;

-- ---------- rights ----------

revoke all on function public.people_new_code(integer), public.people_me(), public.people_connected(uuid, uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'people_profile_save(text, text, integer)', 'people_set_paused(boolean)', 'people_delete_me()', 'people_snapshot()',
    'people_publish(double precision, double precision, real, real, real, real, boolean)',
    'people_add_by_code(text, boolean, timestamptz)', 'people_share(uuid, timestamptz)', 'people_stop_sharing(uuid)',
    'people_ask(uuid)', 'people_decline(uuid)', 'people_remove(uuid)', 'people_invite_create(integer)',
    'people_invite_peek(text)', 'people_invite_accept(text, boolean, timestamptz)',
    'people_alert_set(uuid, text, double precision, double precision, real, text, boolean)', 'people_alert_delete(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
