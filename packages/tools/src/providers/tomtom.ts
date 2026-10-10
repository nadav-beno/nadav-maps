import { bboxAreaKm2, incidentCategory, incidentDetailsUrl, samplePoints, trafficRouteUrl, type BBox, type LngLat } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

export interface TrafficIncident {
  id: string;
  /** Stable category id ("accident", "road_works", "jam", ...). */
  type: string;
  /** Hebrew category name. */
  typeLabel: string;
  /** TomTom's text, in the requested language when available. */
  description: string;
  /** 0 unknown, 1 minor, 2 moderate, 3 major, 4 indefinite (closures). */
  magnitude: number;
  /** Extra time compared with free flow, seconds (absent for closures). */
  delayS?: number;
  lengthM?: number;
  from?: string;
  to?: string;
  roads: string[];
  start?: string;
  end?: string;
  /** A point to show the incident at ([lng, lat]): the first point of its line. */
  point: LngLat;
}

interface TomTomIncident {
  type?: string;
  geometry?: { type: 'Point' | 'LineString'; coordinates: LngLat | LngLat[] };
  properties?: {
    id?: string;
    iconCategory?: number;
    magnitudeOfDelay?: number;
    events?: { description?: string; code?: number; iconCategory?: number }[];
    startTime?: string | null;
    endTime?: string | null;
    from?: string | null;
    to?: string | null;
    length?: number | null;
    delay?: number | null;
    roadNumbers?: string[] | null;
  };
}

export const NO_KEY_MESSAGE = 'מידע על תנועה בזמן אמת לא הוגדר כאן (חסר מפתח TomTom).';

function requireKey(ctx: ToolContext): string {
  const key = ctx.config.tomtomKey;
  if (!key) throw new ProviderError(NO_KEY_MESSAGE, 503, 'tomtom');
  return key;
}

/** TomTom errors may echo the request; never pass their text (or our key) on. */
async function tomtom<T>(ctx: ToolContext, url: string, init?: RequestInit): Promise<T> {
  try {
    return await getJson<T>(ctx, url, init, 'tomtom', 10000);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    const s = e.status;
    const msg =
      s === 403 || s === 401
        ? 'מפתח TomTom לא תקין או לא מורשה לשירות הזה.'
        : s === 429
          ? 'חרגנו ממכסת הבקשות של TomTom. נסו שוב מאוחר יותר.'
          : s === 400
            ? 'TomTom דחה את הבקשה.'
            : 'שירות התנועה של TomTom לא זמין כרגע.';
    throw new ProviderError(msg, s, 'tomtom');
  }
}

export function parseIncident(raw: TomTomIncident, i = 0): TrafficIncident | null {
  const p = raw.properties ?? {};
  const g = raw.geometry;
  if (!g) return null;
  const point = (g.type === 'Point' ? g.coordinates : (g.coordinates as LngLat[])[0]) as LngLat | undefined;
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const cat = incidentCategory(p.iconCategory);
  const description = [...new Set((p.events ?? []).map((e) => e.description?.trim()).filter((d): d is string => !!d))].join(' · ');
  return {
    id: p.id ?? `tt-${i}`,
    type: cat.id,
    typeLabel: cat.label,
    description: description || cat.label,
    magnitude: p.magnitudeOfDelay ?? 0,
    delayS: p.delay ?? undefined,
    lengthM: p.length != null ? Math.round(p.length) : undefined,
    from: p.from ?? undefined,
    to: p.to ?? undefined,
    roads: p.roadNumbers ?? [],
    start: p.startTime ?? undefined,
    end: p.endTime ?? undefined,
    point: [point[0], point[1]],
  };
}

const LANGS: Record<string, string> = { he: 'he-IL', en: 'en-GB', ar: 'ar', ru: 'ru-RU', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

export async function tomtomIncidents(ctx: ToolContext, bbox: BBox, limit = 50): Promise<TrafficIncident[]> {
  const key = requireKey(ctx);
  if (bboxAreaKm2(bbox) > 10_000) throw new ProviderError('האזור גדול מדי לבדיקת תנועה. התקרבו במפה ונסו שוב.', 400, 'tomtom');
  const data = await tomtom<{ incidents?: TomTomIncident[] }>(ctx, incidentDetailsUrl(key, bbox, LANGS[ctx.lang] ?? 'en-GB'));
  const out = (data.incidents ?? []).map(parseIncident).filter((x): x is TrafficIncident => x !== null);
  // Worst first: closures and major delays, then by delay.
  out.sort((a, b) => b.magnitude - a.magnitude || (b.delayS ?? 0) - (a.delayS ?? 0));
  return out.slice(0, limit);
}

export interface TrafficTime {
  /** Travel time with live and historic traffic, seconds. */
  durationS: number;
  /** The same route with no traffic, seconds (when TomTom reports it). */
  noTrafficS?: number;
  /** Delay caused by traffic, seconds. */
  delayS: number;
  distanceM: number;
}

interface CalcRouteResponse {
  routes?: { summary: { lengthInMeters: number; travelTimeInSeconds: number; trafficDelayInSeconds?: number; noTrafficTravelTimeInSeconds?: number } }[];
}

/**
 * Live-traffic travel time for a car route. With `geometry` (the route we show), TomTom
 * reconstructs that very route from supporting points instead of choosing its own.
 */
export async function tomtomTrafficTime(ctx: ToolContext, waypoints: LngLat[], geometry?: LngLat[]): Promise<TrafficTime | null> {
  const key = requireKey(ctx);
  const url = trafficRouteUrl(key, waypoints);
  const pts = geometry && geometry.length >= 2 ? samplePoints(geometry, 150) : undefined;
  const data = await tomtom<CalcRouteResponse>(
    ctx,
    url,
    pts
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supportingPoints: pts.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) }) }
      : undefined,
  );
  const s = data.routes?.[0]?.summary;
  if (!s) return null;
  return {
    durationS: Math.round(s.travelTimeInSeconds),
    noTrafficS: s.noTrafficTravelTimeInSeconds !== undefined ? Math.round(s.noTrafficTravelTimeInSeconds) : undefined,
    delayS: Math.round(s.trafficDelayInSeconds ?? 0),
    distanceM: Math.round(s.lengthInMeters),
  };
}
