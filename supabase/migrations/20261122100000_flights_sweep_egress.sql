-- The once-a-minute sweep (world-cells.ts, sweepCells) only needs the cells it claims, but
-- flight_cells_claim also sent back every fresh aircraft in the world (~1.8 MB) on each call,
-- 6 times a minute: ~12 GB a day of egress, over the Free Plan's 5.5 GB a month.
-- `with_cells => false` returns the claim alone. Without it, a call that asks for the whole
-- world with the full budget (only the sweep does: the map asks for at most MAX_REFRESH = 8 <
-- BUDGET = 9) is treated as the sweep too, so this fix works even before the function is redeployed.

drop function if exists public.flight_cells_claim(integer[], integer, integer, integer, integer, integer);

create or replace function public.flight_cells_claim(ids integer[], max_claim integer, busy_s integer, empty_s integer, claim_s integer, budget integer, with_cells boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed integer[];
  cells jsonb := '[]'::jsonb;
  unknown integer := 0;
  room integer;
begin
  if with_cells is null then
    with_cells := not (cardinality(ids) >= 1000 and max_claim >= budget);
  end if;
  insert into flight_cells (id) select unnest(ids) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(4207);
  select greatest(0, least(max_claim, budget - count(*))) into room from flight_cells
    where claimed_at > now() - interval '10 seconds' or fetched_at > now() - interval '10 seconds';
  with c as (
    select id from flight_cells
    where id = any(ids)
      and (claimed_at is null or claimed_at < now() - make_interval(secs => claim_s))
      and (fetched_at is null or fetched_at < now() - make_interval(secs => case when n > 0 then busy_s else empty_s end))
    -- Never fetched first, then the most overdue (age over its refresh interval).
    order by fetched_at is null desc,
      extract(epoch from now() - fetched_at) / (case when n > 0 then busy_s else empty_s end) desc
    limit room
    for update skip locked
  ), u as (
    update flight_cells f set claimed_at = now() from c where f.id = c.id returning f.id
  )
  select coalesce(array_agg(id), '{}') into claimed from u;
  if with_cells then
    select coalesce(jsonb_agg(jsonb_build_array(id, extract(epoch from fetched_at), data)), '[]'::jsonb)
      into cells from flight_cells where id = any(ids) and n > 0 and fetched_at > now() - interval '15 minutes';
    select count(*) into unknown from flight_cells where id = any(ids) and fetched_at is null;
  end if;
  return jsonb_build_object('cells', cells, 'claim', to_jsonb(claimed), 'unknown', unknown);
end;
$$;

revoke execute on function public.flight_cells_claim(integer[], integer, integer, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.flight_cells_claim(integer[], integer, integer, integer, integer, integer, boolean) to service_role;

notify pgrst, 'reload schema';
