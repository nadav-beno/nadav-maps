/**
 * Search helpers that work on what the map already shows: matching typed text against
 * businesses in the loaded Overture tiles, and deciding when the map has moved far enough
 * from a result list to offer "search this area".
 */
import { distance } from './geo.ts';
import { isHebrew, normalizeQuery, queryVariants } from './hebrew.ts';
import { overturePlace } from './overture.ts';
import type { LngLat, Place } from './types.ts';

/** Lower-case, no punctuation, single spaces: "Café  Noga's" -> "café nogas". */
export function matchText(s: string): string {
  return normalizeQuery(s)
    .toLowerCase()
    .replace(/['"`.,\-–־()]/g, (c) => (c === '-' || c === '–' || c === '־' ? ' ' : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does `name` match the typed query? Every query word must start a word of the name (or the name contains the whole query). */
export function nameMatches(name: string, query: string): boolean {
  const n = matchText(name);
  if (!n) return false;
  const tryOne = (q: string) => {
    const qq = matchText(q);
    if (qq.length < 2) return false;
    if (n.includes(qq)) return true;
    // Name words also count without a glued Hebrew article/preposition ("הכרמל" ~ "כרמל").
    const words = n.split(' ').flatMap((w) => (w.length > 3 && 'הובלמשכ'.includes(w[0]) ? [w, w.slice(1)] : [w]));
    return qq.split(' ').every((w) => words.some((x) => x.startsWith(w)));
  };
  return tryOne(query) || (isHebrew(query) && queryVariants(query).some(tryOne));
}

/** A feature from the Overture tiles: its properties and position. */
export interface LocalFeature {
  properties: Record<string, unknown>;
  lng: number;
  lat: number;
}

/** Same place in two sources? Similar name and closer than `maxM` metres. */
export function samePlace(a: Pick<Place, 'name' | 'lng' | 'lat'>, b: Pick<Place, 'name' | 'lng' | 'lat'>, maxM = 80): boolean {
  if (distance([a.lng, a.lat], [b.lng, b.lat]) >= maxM) return false;
  const x = matchText(a.name);
  const y = matchText(b.name);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Businesses from the loaded Overture tiles whose name matches `query`, nearest to `center`
 * first, minus duplicates of `existing` (e.g. Photon results) and closed or low-confidence ones.
 */
export function matchLocalPlaces(features: LocalFeature[], query: string, center: LngLat, existing: Place[] = [], limit = 3): Place[] {
  if (matchText(query).length < 2) return [];
  const seen = new Set<string>();
  const out: { place: Place; d: number }[] = [];
  for (const f of features) {
    const pr = f.properties;
    const id = String(pr.id ?? '');
    const name = String(pr['@name'] ?? '');
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    if (pr.operating_status === 'permanently_closed') continue;
    if (typeof pr.confidence === 'number' && pr.confidence < 0.5) continue;
    if (!nameMatches(name, query)) continue;
    const place = overturePlace(pr, f.lng, f.lat);
    if (existing.some((e) => samePlace(e, place))) continue;
    out.push({ place, d: distance(center, [f.lng, f.lat]) });
  }
  return out
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.place);
}

/**
 * Suggestions list: local businesses whose name starts with the query lead (they are what
 * people type on a map), the rest go after the first few search results.
 */
export function mergeSuggestions(remote: Place[], local: Place[], query: string): Place[] {
  const q = matchText(query);
  const lead = local.filter((p) => matchText(p.name).startsWith(q));
  const rest = local.filter((p) => !lead.includes(p));
  const remoteOnly = remote.filter((r) => !local.some((l) => l.id === r.id));
  return [...lead, ...remoteOnly.slice(0, 3), ...rest, ...remoteOnly.slice(3)];
}

export interface Camera {
  center: LngLat;
  zoom: number;
}

/** Web-mercator pixel position at a zoom (512 px tiles, like MapLibre). */
function project([lng, lat]: LngLat, zoom: number): [number, number] {
  const size = 512 * 2 ** zoom;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

/**
 * Has the map moved far enough from where a result list was shown to offer "search this
 * area"? The centre moved more than `fraction` of the viewport, or the zoom changed by a level.
 */
export function movedEnough(from: Camera, to: Camera, viewport: { width: number; height: number }, fraction = 0.3): boolean {
  if (Math.abs(to.zoom - from.zoom) >= 1) return true;
  const a = project(from.center, to.zoom);
  const b = project(to.center, to.zoom);
  return Math.abs(a[0] - b[0]) > viewport.width * fraction || Math.abs(a[1] - b[1]) > viewport.height * fraction;
}
