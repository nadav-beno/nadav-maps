-- Keeps the whole world's live flights fresh (packages/tools/src/world-cells.ts, sweepCells).
-- 1. flight_cells_claim: the most overdue cells first (empty cells were starved by busy ones),
--    and only positions from the last 15 minutes go back (older ones were dropped by the site anyway).
-- 2. A pg_cron job asks the "flights" Edge Function to sweep once a minute, so the zoomed-out
--    map has every aircraft even when no one has been watching.

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
    -- Never fetched first, then the most overdue (age over its refresh interval), so empty
    -- cells are still rechecked while busy ones are always due.
    order by fetched_at is null desc,
      extract(epoch from now() - fetched_at) / (case when n > 0 then busy_s else empty_s end) desc
    limit room
    for update skip locked
  ), u as (
    update flight_cells f set claimed_at = now() from c where f.id = c.id returning f.id
  )
  select coalesce(array_agg(id), '{}') into claimed from u;
  select coalesce(jsonb_agg(jsonb_build_array(id, extract(epoch from fetched_at), data)), '[]'::jsonb)
    into cells from flight_cells where id = any(ids) and n > 0 and fetched_at > now() - interval '15 minutes';
  select count(*) into unknown from flight_cells where id = any(ids) and fetched_at is null;
  return jsonb_build_object('cells', cells, 'claim', to_jsonb(claimed), 'unknown', unknown);
end;
$$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'flights-sweep';
select cron.schedule(
  'flights-sweep',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://wysmzvzpmtptckngegvo.supabase.co/functions/v1/flights',
    body := '{"sweep": true}'::jsonb,
    headers := '{"content-type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cron$
);
