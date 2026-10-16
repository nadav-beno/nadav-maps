/**
 * Search helpers that work on what the map already shows: matching typed text against
 * businesses in the loaded Overture tiles, and deciding when the map has moved far enough
 * from a result list to offer "search this area".
 */
import { distance } from './geo.ts';
import { fuzzyScore, makeIndex, prepareQuery, searchIndex, type NameIndex, type PreparedQuery } from './fuzzy.ts';
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

const nameTexts = new Map<string, { n: string; words: string[] }>();
function nameText(name: string) {
  let t = nameTexts.get(name);
  if (!t) {
    if (nameTexts.size > 20000) nameTexts.clear();
    const n = matchText(name);
    // Name words also count without a glued Hebrew article/preposition ("הכרמל" ~ "כרמל").
    const words = n.split(' ').flatMap((w) => (w.length > 3 && 'הובלמשכ'.includes(w[0]) ? [w, w.slice(1)] : [w]));
    nameTexts.set(name, (t = { n, words }));
  }
  return t;
}

/** A test for "every query word starts a word of the name, or the name contains the whole query". */
function exactMatcher(query: string): (name: string) => boolean {
  const qs = [query, ...(isHebrew(query) ? queryVariants(query) : [])].map(matchText).filter((q) => q.length >= 2);
  const parts = qs.map((q) => q.split(' '));
  return (name) => {
    const t = nameText(name);
    if (!t.n) return false;
    return qs.some((q, i) => t.n.includes(q) || parts[i].every((w) => t.words.some((x) => x.startsWith(w))));
  };
}

/** Does `name` match the typed query exactly: every query word starts a word of the name (or the name contains the whole query)? */
export function nameMatchesExactly(name: string, query: string): boolean {
  return exactMatcher(query)(name);
}

/** Fuzzy matches need this score (0..1): a typo or two, another script, a layout slip. */
export const FUZZY_NAME_SCORE = 0.76;

/**
 * Does `name` match the typed query? Exactly (see nameMatchesExactly), or with typos once
 * three letters are typed ("ביסטרי" finds "ביסטרו הכרמל", "bistro" finds "ביסטרו").
 */
export function nameMatches(name: string, query: string, prepared?: PreparedQuery): boolean {
  if (nameMatchesExactly(name, query)) return true;
  return matchText(query).replace(/ /g, '').length >= 3 && fuzzyScore(prepared ?? prepareQuery(query), name) >= FUZZY_NAME_SCORE;
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
  const exactly = exactMatcher(query);
  // Typo matches come from an index of the names on the map (rebuilt when they change).
  const fuzzy = new Map<string, number>();
  if (matchText(query).replace(/ /g, '').length >= 3) {
    const pq = prepareQuery(query);
    for (const m of searchIndex(localIndex(features), pq, { limit: 40, minScore: FUZZY_NAME_SCORE })) fuzzy.set(m.entry.n, m.score);
  }
  const out: { place: Place; d: number; exact: boolean; score: number }[] = [];
  for (const f of features) {
    const pr = f.properties;
    const id = String(pr.id ?? '');
    const name = String(pr['@name'] ?? '');
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    if (pr.operating_status === 'permanently_closed') continue;
    if (typeof pr.confidence === 'number' && pr.confidence < 0.5) continue;
    const exact = exactly(name);
    const score = exact ? 1 : fuzzy.get(name) ?? 0;
    if (!exact && score < FUZZY_NAME_SCORE) continue;
    const place = overturePlace(pr, f.lng, f.lat);
    if (existing.some((e) => samePlace(e, place))) continue;
    out.push({ place, d: distance(center, [f.lng, f.lat]), exact, score });
  }
  // Exact matches nearest first, then typo matches best first.
  return out
    .sort((a, b) => (a.exact !== b.exact ? (a.exact ? -1 : 1) : a.exact ? a.d - b.d : b.score - a.score || a.d - b.d))
    .slice(0, limit)
    .map((x) => x.place);
}

let local: { names: string[]; index: NameIndex } | null = null;
function localIndex(features: LocalFeature[]): NameIndex {
  const names = [...new Set(features.map((f) => String(f.properties['@name'] ?? '')).filter(Boolean))].sort();
  if (local && local.names.length === names.length && local.names.every((n, i) => n === names[i])) return local.index;
  local = { names, index: makeIndex(names) };
  return local.index;
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
