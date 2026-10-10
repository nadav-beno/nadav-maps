import { hereBboxOk, hereIncidentCategory, hereIncidentsUrl, hereMagnitude, herePassPoints, hereRouteUrl, incidentCategory, type BBox, type LngLat } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';
import type { TrafficIncident, TrafficTime } from './tomtom.ts';

/** HERE Traffic API v7 /incidents with locationReferencing=shape (only the fields we read). */
export interface HereIncidentItem {
  location?: {
    description?: string;
    length?: number;
    shape?: { links?: { points?: { lat: number; lng: number }[]; length?: number }[] };
  };
  incidentDetails?: {
    id?: string;
    originalId?: string;
    type?: string;
    criticality?: string;
    roadClosed?: boolean;
    startTime?: string;
    endTime?: string;
    description?: { value?: string };
    summary?: { value?: string };
    descriptionParts?: { roadName?: string; intersectingRoadName?: string; endIntersectingRoadName?: string; endRoadName?: string };
  };
}

export const HERE_NO_KEY_MESSAGE = 'מידע על תנועה בזמן אמת לא הוגדר כאן (חסר מפתח HERE).';

function requireKey(ctx: ToolContext): string {
  const key = ctx.config.hereKey;
  if (!key) throw new ProviderError(HERE_NO_KEY_MESSAGE, 503, 'here');
  return key;
}

/** HERE errors may echo the request (and the apiKey); never pass their text on. */
async function here<T>(ctx: ToolContext, url: string): Promise<T> {
  try {
    return await getJson<T>(ctx, url, {}, 'here', 10000);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    const s = e.status;
    const msg =
      s === 403 || s === 401
        ? 'מפתח HERE לא תקין או לא מורשה לשירות הזה.'
        : s === 429
          ? 'חרגנו ממכסת הבקשות של HERE. נסו שוב מאוחר יותר.'
          : s === 400
            ? 'HERE דחה את הבקשה.'
            : 'שירות התנועה של HERE לא זמין כרגע.';
    throw new ProviderError(msg, s, 'here');
  }
}

/** One v7 incident in our model. Delay is not part of v7 incidents, so it stays empty. */
export function parseHereIncident(raw: HereIncidentItem, i = 0): TrafficIncident | null {
  const d = raw.incidentDetails ?? {};
  const first = raw.location?.shape?.links?.find((l) => l.points?.length)?.points?.[0];
  if (!first || !Number.isFinite(first.lat) || !Number.isFinite(first.lng)) return null;
  const cat = incidentCategory(hereIncidentCategory(d.type, d.roadClosed));
  const parts = d.descriptionParts ?? {};
  const description = (d.description?.value || d.summary?.value || '').trim();
  return {
    id: d.id ?? d.originalId ?? `here-${i}`,
    type: cat.id,
    typeLabel: cat.label,
    description: description || cat.label,
    magnitude: hereMagnitude(d.criticality, d.roadClosed),
    lengthM: raw.location?.length != null ? Math.round(raw.location.length) : undefined,
    from: parts.intersectingRoadName || undefined,
    to: parts.endIntersectingRoadName || parts.endRoadName || undefined,
    roads: parts.roadName ? [parts.roadName] : [],
    start: d.startTime,
    end: d.endTime,
    point: [first.lng, first.lat],
  };
}

const LANGS: Record<string, string> = { he: 'he-IL', en: 'en-GB', ar: 'ar', ru: 'ru-RU', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

export async function hereIncidents(ctx: ToolContext, bbox: BBox, limit = 50): Promise<TrafficIncident[]> {
  const key = requireKey(ctx);
  if (!hereBboxOk(bbox)) throw new ProviderError('האזור גדול מדי לבדיקת תנועה. התקרבו במפה ונסו שוב.', 400, 'here');
  const data = await here<{ results?: HereIncidentItem[] }>(ctx, hereIncidentsUrl(key, bbox, LANGS[ctx.lang] ?? 'en-GB'));
  const out = (data.results ?? []).map(parseHereIncident).filter((x): x is TrafficIncident => x !== null);
  out.sort((a, b) => b.magnitude - a.magnitude || (b.lengthM ?? 0) - (a.lengthM ?? 0));
  return out.slice(0, limit);
}

/** Routing v8 summary (per section; pass-through vias keep it to one, stops would add more). */
export interface HereRouteResponse {
  routes?: { sections?: { summary?: { duration: number; length: number; baseDuration?: number; typicalDuration?: number } }[] }[];
}

export function hereRouteSummary(data: HereRouteResponse): TrafficTime | null {
  const sections = data.routes?.[0]?.sections ?? [];
  if (!sections.length || sections.some((s) => !s.summary)) return null;
  let duration = 0;
  let base = 0;
  let length = 0;
  let hasBase = true;
  for (const { summary: s } of sections) {
    duration += s!.duration;
    length += s!.length;
    if (s!.baseDuration === undefined) hasBase = false;
    else base += s!.baseDuration;
  }
  return {
    durationS: Math.round(duration),
    noTrafficS: hasBase ? Math.round(base) : undefined,
    delayS: hasBase ? Math.max(0, Math.round(duration - base)) : 0,
    distanceM: Math.round(length),
  };
}

/**
 * Live-traffic travel time for a car route, leaving now. With `geometry` (the route we show),
 * HERE is led along it by pass-through points so it times that very line.
 */
export async function hereTrafficTime(ctx: ToolContext, waypoints: LngLat[], geometry?: LngLat[]): Promise<TrafficTime | null> {
  const key = requireKey(ctx);
  const line = geometry && geometry.length >= 2 ? geometry : undefined;
  const origin = line ? line[0] : waypoints[0];
  const destination = line ? line[line.length - 1] : waypoints[waypoints.length - 1];
  const via = line ? herePassPoints(line, waypoints.slice(1, -1)) : waypoints.slice(1, -1);
  const data = await here<HereRouteResponse>(ctx, hereRouteUrl(key, origin, destination, via));
  return hereRouteSummary(data);
}
