import { israelHeadsign, type BBox, type LiveVehicle } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

/**
 * Measured bus positions in Israel from the Open Bus Stride API (Hasadna, public, no key): it
 * archives the Ministry of Transport's SIRI feed, so each row is a GPS fix a bus reported. The
 * SIRI line ref is the Ministry's line id; GTFS routes of the day give the line number, the
 * operator and the destination.
 */

export interface StrideVehicleLocation {
  id: number;
  recorded_at_time: string;
  lon: number;
  lat: number;
  bearing?: number | null;
  velocity?: number | null;
  siri_route__line_ref?: number | null;
  siri_route__operator_ref?: number | null;
  siri_ride__id?: number | null;
  siri_ride__vehicle_ref?: string | null;
  siri_ride__scheduled_start_time?: string | null;
}

export interface StrideGtfsRoute {
  line_ref: number;
  operator_ref?: number;
  route_short_name?: string | null;
  route_long_name?: string | null;
  agency_name?: string | null;
  route_type?: string | null;
}

/** Fixes older than this are not shown: the bus has moved on, or stopped reporting. */
export const MAX_FIX_AGE_MS = 6 * 60_000;

/** The date in Israel (GTFS routes are per service day). */
export function israelDate(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/** Stride times come without a zone in some rows; they are UTC. */
const utc = (s: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

/** The newest fix of each bus, joined with its route; old fixes dropped. */
export function strideVehicles(rows: StrideVehicleLocation[], routes: StrideGtfsRoute[], now: number): LiveVehicle[] {
  const route = new Map<number, StrideGtfsRoute>();
  for (const r of routes) if (!route.has(r.line_ref)) route.set(r.line_ref, r);
  const newest = new Map<string, StrideVehicleLocation>();
  for (const r of rows) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number' || !r.recorded_at_time) continue;
    const t = utc(r.recorded_at_time);
    if (!Number.isFinite(t) || now - t > MAX_FIX_AGE_MS || t - now > 60_000) continue;
    const key = r.siri_ride__vehicle_ref || `ride:${r.siri_ride__id ?? r.id}`;
    const seen = newest.get(key);
    if (!seen || utc(seen.recorded_at_time) < t) newest.set(key, r);
  }
  return [...newest.entries()].map(([key, r]) => {
    const g = r.siri_route__line_ref != null ? route.get(r.siri_route__line_ref) : undefined;
    return {
      id: `openbus:${key}`,
      mode: 'bus' as const,
      line: (g?.route_short_name ?? '').trim() || (r.siri_route__line_ref != null ? String(r.siri_route__line_ref) : ''),
      headsign: israelHeadsign(g?.route_long_name ?? undefined),
      agency: g?.agency_name ?? undefined,
      source: 'gps' as const,
      lng: r.lon,
      lat: r.lat,
      bearing: typeof r.bearing === 'number' ? r.bearing : undefined,
      speedKph: typeof r.velocity === 'number' ? r.velocity : undefined,
      at: new Date(utc(r.recorded_at_time)).toISOString(),
    };
  });
}

export async function openBusVehicles(ctx: ToolContext, bbox: BBox, now = Date.now()): Promise<LiveVehicle[]> {
  const base = ctx.config.openBusUrl.replace(/\/$/, '');
  if (!base) throw new ProviderError('מיקומי אוטובוסים לא מוגדרים בשרת הזה.', undefined, 'openbus');
  const [w, s, e, n] = bbox;
  const q = new URLSearchParams({
    lon__greater_or_equal: w.toFixed(5),
    lon__lower_or_equal: e.toFixed(5),
    lat__greater_or_equal: s.toFixed(5),
    lat__lower_or_equal: n.toFixed(5),
    recorded_at_time_from: new Date(now - MAX_FIX_AGE_MS).toISOString(),
    // Stride holds a few rows stamped in 2038; newest-first they would crowd out the real ones.
    recorded_at_time_to: new Date(now + 60_000).toISOString(),
    order_by: 'recorded_at_time desc',
    limit: '2000',
  });
  const rows = await getJson<StrideVehicleLocation[]>(ctx, `${base}/siri_vehicle_locations/list?${q}`, {}, 'openbus', 15000);
  const list = Array.isArray(rows) ? rows : [];
  const refs = [...new Set(list.map((r) => r.siri_route__line_ref).filter((x): x is number => typeof x === 'number'))];
  let routes: StrideGtfsRoute[] = [];
  if (refs.length) {
    const day = israelDate(now);
    // Line numbers are nice to have: without them we still show the buses.
    routes = await Promise.all(
      chunks(refs, 150).map((part) =>
        getJson<StrideGtfsRoute[]>(ctx, `${base}/gtfs_routes/list?${new URLSearchParams({ line_refs: part.join(','), date_from: day, date_to: day, limit: '1000' })}`, {}, 'openbus', 15000).catch(
          () => [] as StrideGtfsRoute[],
        ),
      ),
    ).then((x) => x.flat());
  }
  return strideVehicles(list, routes, now);
}

function chunks<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
