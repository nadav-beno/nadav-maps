-- Shared cache of live aircraft per world cell (packages/tools/src/world-cells.ts).
-- Only the "flights" Edge Function (service role) touches it; no one else can read or write.
create table if not exists public.flight_cells (
  id integer primary key,
  fetched_at timestamptz,
  claimed_at timestamptz,
  n integer not null default 0,
  data jsonb not null default '[]'::jsonb
);
alter table public.flight_cells enable row level security;
revoke all on public.flight_cells from anon, authenticated;

-- Returns the cached cells among `ids` and claims up to `max_claim` stale ones for the caller.
-- At most `budget` cells are claimed per 10 s across all callers (the feeds rate-limit by IP).
create or replace function public.flight_cells_claim(ids integer[], max_claim integer, busy_s integer, empty_s integer, claim_s integer, budget integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed integer[];
  cells jsonb;
  unknown integer;
  room integer;
begin
  insert into flight_cells (id) select unnest(ids) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(4207);
  select greatest(0, least(max_claim, budget - count(*))) into room from flight_cells
    where claimed_at > now() - interval '10 seconds' or fetched_at > now() - interval '10 seconds';
  with c as (
    select id from flight_cells
    where id = any(ids)
      and (claimed_at is null or claimed_at < now() - make_interval(secs => claim_s))
      and (fetched_at is null or fetched_at < now() - make_interval(secs => case when n > 0 then busy_s else empty_s end))
    -- Never fetched first, then busy cells, then empty ones; oldest first.
    order by fetched_at is null desc, (n > 0) desc, fetched_at
    limit room
    for update skip locked
  ), u as (
    update flight_cells f set claimed_at = now() from c where f.id = c.id returning f.id
  )
  select coalesce(array_agg(id), '{}') into claimed from u;
  select coalesce(jsonb_agg(jsonb_build_array(id, extract(epoch from fetched_at), data)), '[]'::jsonb)
    into cells from flight_cells where id = any(ids) and n > 0 and fetched_at is not null;
  select count(*) into unknown from flight_cells where id = any(ids) and fetched_at is null;
  return jsonb_build_object('cells', cells, 'claim', to_jsonb(claimed), 'unknown', unknown);
end;
$$;

-- Stores freshly fetched cells: [{ id, rows }].
create or replace function public.flight_cells_put(cells jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into flight_cells (id, fetched_at, claimed_at, n, data)
  select (c->>'id')::integer, now(), null, jsonb_array_length(c->'rows'), c->'rows'
  from jsonb_array_elements(cells) c
  on conflict (id) do update set fetched_at = excluded.fetched_at, claimed_at = null, n = excluded.n, data = excluded.data;
$$;

revoke execute on function public.flight_cells_claim(integer[], integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.flight_cells_put(jsonb) from public, anon, authenticated;
grant execute on function public.flight_cells_claim(integer[], integer, integer, integer, integer, integer) to service_role;
grant execute on function public.flight_cells_put(jsonb) to service_role;
