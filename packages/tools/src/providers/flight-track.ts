import type { LngLat } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

/**
 * The whole path an aircraft has flown on this flight, from takeoff until now (or until it
 * landed), from adsb.lol's public trace files: the readsb "globe history" every tar1090 map
 * draws its trails from. `trace_full` holds the last day and is rewritten every few minutes;
 * `trace_recent` holds the last minutes, so the two together reach up to about now.
 * Only the aircraft's ICAO hex is sent.
 */

export interface TrackPoint {
  lngLat: LngLat;
  /** ms since epoch */
  t: number;
  /** Meters above sea level (barometric), null when unknown; 0 with onGround. */
  altitudeM: number | null;
  onGround: boolean;
}

export interface FlightTrack {
  hex: string;
  /** Where this flight's track starts (the takeoff, or the first position received of it). */
  points: TrackPoint[];
  /** True when the last position is on the ground after the flight: it has landed. */
  landed: boolean;
  /** ms since epoch of the first point of the leg. */
  startedAt: number | null;
}

const FT = 0.3048;
/** Points kept for the map; long-haul days have many thousands. */
export const MAX_POINTS = 2500;
/** Ground positions kept after touchdown (the landing roll and taxi to the gate). */
const TAXI_AFTER_MS = 10 * 60_000;
/** A silence this long that starts and ends low (below LOW_M) splits two flights. */
const NEW_FLIGHT_GAP_MS = 45 * 60_000;
const LOW_M = 2000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const validHex = (hex: string) => /^[0-9a-f]{6}$/.test(hex);

export function traceUrls(base: string, hex: string): [full: string, recent: string] {
  const b = base.endsWith('/') ? base : `${base}/`;
  return [`${b}${hex.slice(-2)}/trace_full_${hex}.json`, `${b}${hex.slice(-2)}/trace_recent_${hex}.json`];
}

type RawPoint = TrackPoint;

/**
 * One trace file: `{ timestamp, trace: [[secondsAfter, lat, lon, alt|"ground"|null, gs, track, flags, …], …] }`.
 */
export function parseTrace(json: unknown): RawPoint[] {
  const root = (json ?? {}) as { timestamp?: unknown; trace?: unknown };
  const base = num(root.timestamp);
  if (base === null || !Array.isArray(root.trace)) return [];
  const out: RawPoint[] = [];
  for (const p of root.trace) {
    if (!Array.isArray(p)) continue;
    const dt = num(p[0]), lat = num(p[1]), lon = num(p[2]);
    if (dt === null || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const onGround = p[3] === 'ground';
    const ft = num(p[3]);
    out.push({ lngLat: [lon, lat], t: Math.round((base + dt) * 1000), altitudeM: onGround ? 0 : ft === null ? null : Math.round(ft * FT), onGround });
  }
  return out;
}

/** The day's trace and the recent one together, in time order, without repeats. */
export function mergeTraces(full: RawPoint[], recent: RawPoint[]): RawPoint[] {
  const last = full.length ? full[full.length - 1].t : -Infinity;
  return [...full, ...recent.filter((p) => p.t > last)].sort((a, b) => a.t - b.t);
}

/**
 * The current flight out of a day of positions: from the last takeoff (or, where that wasn't
 * received, a long silence on the ground) to now. When the aircraft has landed, from that flight's takeoff to the landing roll; a
 * plane that has sat at the gate since has nothing to show.
 */
export function currentFlight(points: RawPoint[], now = Date.now()): { points: TrackPoint[]; landed: boolean } {
  if (!points.length) return { points: [], landed: false };
  // The last airborne point: everything after it is the landing roll or the gate.
  let lastAir = -1;
  for (let i = points.length - 1; i >= 0; i--) if (!points[i].onGround) { lastAir = i; break; }
  if (lastAir < 0) return { points: [], landed: false };
  // Walk back from there to where this flight began: the takeoff run, or, where the takeoff
  // wasn't received, a long silence that began and ended low (it landed and left out of range).
  // readsb's own leg markers are not used: it also sets them after long gaps over the ocean.
  let start = 0;
  for (let i = lastAir; i > 0; i--) {
    const p = points[i], prev = points[i - 1];
    const gap = p.t - prev.t > NEW_FLIGHT_GAP_MS;
    const low = (q: RawPoint) => q.onGround || (q.altitudeM !== null && q.altitudeM < LOW_M);
    if (gap && low(prev) && low(p)) { start = i; break; }
    if (prev.onGround && !p.onGround) { start = i - 1; break; }
  }
  const landed = points[points.length - 1].onGround;
  let end = points.length - 1;
  if (landed) {
    const touchdown = points[lastAir + 1]?.t ?? points[lastAir].t;
    while (end > lastAir + 1 && points[end].t - touchdown > TAXI_AFTER_MS) end--;
    // Landed long ago and parked since: that was an earlier flight.
    if (now - points[end].t > 6 * 3600_000) return { points: [], landed: true };
  }
  const leg = points.slice(start, end + 1);
  return { points: thin(leg, MAX_POINTS), landed };
}

/** At most `max` points, always keeping the first and the last. */
export function thin<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const step = (list.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)]);
  return out;
}

export async function flightTrack(ctx: ToolContext, hex: string): Promise<FlightTrack> {
  const id = hex.trim().toLowerCase().replace(/^~/, '');
  const empty: FlightTrack = { hex: id, points: [], landed: false, startedAt: null };
  if (!ctx.config.tracesUrl || !validHex(id)) return empty;
  const [fullUrl, recentUrl] = traceUrls(ctx.config.tracesUrl, id);
  // 404 = nothing recorded today for this aircraft: an empty track, not an error.
  const get = (url: string) =>
    getJson<unknown>(ctx, url, {}, 'traces', 15000).catch((e) => {
      if (e instanceof ProviderError && e.status === 404) return null;
      throw e;
    });
  const [full, recent] = await Promise.allSettled([get(fullUrl), get(recentUrl)]);
  if (full.status === 'rejected' && recent.status === 'rejected') throw full.reason;
  const all = mergeTraces(parseTrace(full.status === 'fulfilled' ? full.value : null), parseTrace(recent.status === 'fulfilled' ? recent.value : null));
  const flight = currentFlight(all);
  return { hex: id, points: flight.points, landed: flight.landed, startedAt: flight.points[0]?.t ?? null };
}
