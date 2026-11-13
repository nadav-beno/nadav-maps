import type { Departure, LngLat } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

/**
 * Live arrival predictions at Israeli stops, the same data Moovit shows: the Ministry of
 * Transport's SIRI stop monitoring (SIRI-SM), read through curlbus (curlbus.app, Elad Alfassa,
 * free, no key). The Ministry's own API needs registration and a static IP, so we use curlbus's
 * JSON front end instead. It sends no CORS headers, so the web app reads it through our relay.
 *
 * Field names follow curlbus's source (curlbus/siri.py `SIRIStopVisit`, gtfs/utils.py).
 */

export interface CurlbusStop {
  code: string;
  name?: { HE?: string; EN?: string; AR?: string } | string | null;
  distance?: number;
  location?: { lat: number; lon: number };
}

export interface CurlbusVisit {
  stop_code: string;
  line_name?: string | null;
  line_id?: string | number | null;
  operator_id?: string | number | null;
  vehicle_ref?: string | null;
  /** "2026-11-13 07:52:00+02:00" (Python str of an aware datetime). */
  eta?: string | null;
  timestamp?: string | null;
  location?: { lat: number | string; lon: number | string } | null;
  static_info?: {
    route?: {
      destination?: { name?: { HE?: string; EN?: string } | null; address?: { city?: { HE?: string; EN?: string } } | null } | null;
      agency?: { name?: { HE?: string; EN?: string } } | null;
      headsign?: { HE?: string; EN?: string } | null;
    } | null;
  } | null;
}

export interface CurlbusResponse {
  errors?: string[] | null;
  visits?: Record<string, CurlbusVisit[]>;
}

/** curlbus answers `/nearby` only for these radii (m). */
export function curlbusRadius(m: number): number {
  if (m <= 5) return 5;
  if (m <= 10) return 10;
  return Math.min(1000, Math.max(50, Math.ceil(m / 50) * 50));
}

/** Python's str(datetime) has a space where ISO has a T. */
export function curlbusTime(s?: string | null): number {
  if (!s) return NaN;
  return Date.parse(String(s).trim().replace(' ', 'T'));
}

const he = (n?: { HE?: string; EN?: string } | string | null) => (typeof n === 'string' ? n : n?.HE || n?.EN || '');

/** curlbus's route endpoint takes digits only (municipal "TA…" stops come from another feed). */
const queryable = (code: string) => /^\d+$/.test(code);

/** Visits at the given stops as departures, soonest first; passed buses dropped. */
export function curlbusDepartures(res: CurlbusResponse, stops: CurlbusStop[], now: number): Departure[] {
  const byCode = new Map(stops.map((s) => [String(s.code), s]));
  const out: Departure[] = [];
  for (const [code, visits] of Object.entries(res.visits ?? {})) {
    const stop = byCode.get(code);
    for (const v of visits ?? []) {
      const t = curlbusTime(v.eta);
      if (!Number.isFinite(t) || t < now - 60_000 || !v.line_name) continue;
      const route = v.static_info?.route;
      const dest = he(route?.headsign) || he(route?.destination?.name);
      const city = he(route?.destination?.address?.city);
      const lat = Number(v.location?.lat);
      const lng = Number(v.location?.lon);
      const iso = new Date(t).toISOString();
      out.push({
        stop: { name: he(stop?.name) || code, lng: stop?.location?.lon ?? 0, lat: stop?.location?.lat ?? 0, stopId: `il-stop:${code}` },
        mode: 'bus',
        line: String(v.line_name).trim(),
        headsign: [dest, city && !dest.includes(city) ? city : ''].filter(Boolean).join(', '),
        time: iso,
        scheduledTime: iso,
        realtime: true,
        predicted: true,
        cancelled: false,
        agency: he(route?.agency?.name) || undefined,
        vehicle: Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { id: v.vehicle_ref ? `openbus:${v.vehicle_ref}` : undefined, lng, lat } : undefined,
      });
    }
  }
  return out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** Stops around a point, nearest first (curlbus's own GTFS copy, so the codes are ones it knows). */
export async function curlbusNearby(ctx: ToolContext, at: LngLat, radiusM: number): Promise<CurlbusStop[]> {
  const base = ctx.config.curlbusUrl.replace(/\/$/, '');
  if (!base) throw new ProviderError('זמני הגעה בזמן אמת לא מוגדרים בשרת הזה.', undefined, 'curlbus');
  const q = new URLSearchParams({ lat: at[1].toFixed(5), lon: at[0].toFixed(5), radius: String(curlbusRadius(radiusM)) });
  const stops = await getJson<CurlbusStop[]>(ctx, `${base}/nearby?${q}`, { headers: { accept: 'application/json' } }, 'curlbus', 8000);
  return (Array.isArray(stops) ? stops : []).filter((s) => s && s.code != null).sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
}

/**
 * Live arrivals at the stops around a point (at most `maxStops` stops, curlbus allows 30).
 * Null when curlbus knows no stop there (then the timetable is all we have).
 */
export async function curlbusArrivals(ctx: ToolContext, at: LngLat, radiusM: number, now = Date.now(), maxStops = 8): Promise<Departure[] | null> {
  const stops = (await curlbusNearby(ctx, at, radiusM)).filter((s) => queryable(String(s.code))).slice(0, maxStops);
  if (!stops.length) return null;
  const base = ctx.config.curlbusUrl.replace(/\/$/, '');
  const res = await getJson<CurlbusResponse>(ctx, `${base}/${stops.map((s) => s.code).join('+')}`, { headers: { accept: 'application/json' } }, 'curlbus', 10000);
  if (!res?.visits) throw new ProviderError(`curlbus: ${(res?.errors ?? []).join('; ') || 'no visits'}`, undefined, 'curlbus');
  return curlbusDepartures(res, stops, now);
}
