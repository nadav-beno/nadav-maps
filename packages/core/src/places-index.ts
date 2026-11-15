/**
 * Search index for our own places (businesses from Overture, scripts/places): every place by
 * the first two letters of each word of its name and brand, so typing "ארומה" finds every
 * branch in the country, not only those in the map tiles already loaded. Built in CI next to
 * places.pmtiles (scripts/places/search-index.ts) and read by the search tool
 * (packages/tools/src/providers/places-index.ts).
 */
import { distance } from './geo.ts';
import { fuzzyScore, prepareQuery } from './fuzzy.ts';
import { keyTokens, searchKey, tokenAliases } from './geoindex.ts';
import { closeness } from './local-search.ts';
import type { LngLat, Place } from './types.ts';

export const PLACES_INDEX_VERSION = 1;
export const PLACES_INDEX_DIR = 'places-search';

/**
 * One place: [overture id, name (or "name|other-language name"), lng×1e5, lat×1e5, category
 * index or -1, brand index or -1, prominence 0..2, town index or -1, street address or ""].
 */
export type PlacesIndexRow = [string, string, number, number, number, number, number, number, string];

export interface PlacesIndexShard {
  v: number;
  /** Category names, referenced by index from the rows. */
  c: string[];
  /** Brand names, referenced by index from the rows. */
  b: string[];
  /** Town names, referenced by index from the rows. */
  l: string[];
  r: PlacesIndexRow[];
}

/** The shard a word lives in: its first two letters. */
export function placesShardKey(token: string): string | null {
  const t = [...token];
  return t.length >= 2 ? t.slice(0, 2).join('') : null;
}

/** A file name for a shard key that any server and URL handle: the letters' code points in hex. */
export function placesShardFile(key: string): string {
  return `${[...key].map((c) => c.codePointAt(0)!.toString(16)).join('-')}.json`;
}

/** The words a place is found by: every word of its names and brand (with and without ה), 2+ letters. */
export function placeTokens(names: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    const toks = keyTokens(searchKey(n));
    for (const t of toks) for (const a of tokenAliases(t)) if ([...a].length >= 2) out.add(a);
    // "סופר פארם" is also typed "סופרפארם".
    if (toks.length > 1 && toks.length <= 3) out.add(toks.join(''));
  }
  return [...out];
}

export interface PlaceInput {
  id: string;
  name: string;
  altName?: string;
  lng: number;
  lat: number;
  category?: string;
  brand?: string;
  /** First map zoom the place shows at (13 = prominent, 15 = everything else). */
  mz?: number;
  closed?: boolean;
  street?: string;
  town?: string;
}

/** Shards above this many places split by one more letter ("בי" into "בית", "ביס"...). */
export const PLACES_SHARD_MAX = 3000;

/** Group places into shards (used by the builder; pure, so it is unit tested). */
export function buildPlacesIndex(places: Iterable<PlaceInput>, maxRows = PLACES_SHARD_MAX): Map<string, PlacesIndexShard> {
  const items = [...places].filter((p) => !p.closed && p.name).map((p) => ({ p, toks: placeTokens([p.name, p.altName, p.brand]) }));
  // Which key each token goes to: two letters, or more where a shard is too big.
  const keyLen = new Map<string, number>();
  const keysOf = (toks: string[]) => {
    const out = new Set<string>();
    for (const t of toks) {
      const chars = [...t];
      let n = 2;
      while (keyLen.get(chars.slice(0, n).join('')) && chars.length > n) n++;
      if (chars.length >= 2) out.add(chars.slice(0, n).join(''));
    }
    return out;
  };
  for (let round = 0; round < 3; round++) {
    const counts = new Map<string, number>();
    for (const it of items) for (const k of keysOf(it.toks)) counts.set(k, (counts.get(k) ?? 0) + 1);
    let split = false;
    for (const [k, n] of counts) {
      if (n > maxRows && !keyLen.has(k)) {
        keyLen.set(k, [...k].length + 1);
        split = true;
      }
    }
    if (!split) break;
  }
  const shards = new Map<string, PlacesIndexShard & { ci: Map<string, number>; bi: Map<string, number>; li: Map<string, number> }>();
  const idx = (v: string | undefined, list: string[], map: Map<string, number>) => {
    if (!v) return -1;
    let i = map.get(v);
    if (i === undefined) map.set(v, (i = list.push(v) - 1));
    return i;
  };
  for (const { p, toks } of items) {
    for (const k of keysOf(toks)) {
      let s = shards.get(k);
      if (!s) shards.set(k, (s = { v: PLACES_INDEX_VERSION, c: [], b: [], l: [], r: [], ci: new Map(), bi: new Map(), li: new Map() }));
      const name = p.altName && p.altName !== p.name ? `${p.name}|${p.altName}` : p.name;
      s.r.push([p.id, name, Math.round(p.lng * 1e5), Math.round(p.lat * 1e5), idx(p.category, s.c, s.ci), idx(p.brand, s.b, s.bi), 15 - (p.mz ?? 15), idx(p.town, s.l, s.li), p.street ?? '']);
    }
  }
  const out = new Map<string, PlacesIndexShard>();
  for (const [k, { v, c, b, l, r }] of shards) out.set(k, { v, c, b, l, r });
  return out;
}

/**
 * The shard to read for a query: the longest key in `shards` (the index's list) that starts
 * the query's first word, so a split shard ("ביס") is read instead of its parent ("בי").
 */
export function placesQueryShard(query: string, shards?: ReadonlySet<string>): string | null {
  const first = keyTokens(searchKey(query))[0];
  if (!first || [...first].length < 2) return null;
  if (!shards) return placesShardKey(first);
  const chars = [...first];
  for (let n = Math.min(chars.length, 6); n >= 2; n--) {
    const k = chars.slice(0, n).join('');
    if (shards.has(k)) return k;
  }
  return null;
}

/**
 * Places in a shard that answer `query`, best first: every typed word starts a word of the name
 * (or the glued name), or a close spelling of it; then closeness to `near` and prominence.
 */
export function searchPlacesShard(shard: PlacesIndexShard, query: string, near: LngLat | undefined, limit = 10): Place[] {
  const qt = keyTokens(searchKey(query));
  if (!qt.length) return [];
  const glued = qt.join('');
  const pq = glued.length >= 3 ? prepareQuery(query) : null;
  const scored: { row: PlacesIndexRow; s: number }[] = [];
  for (const row of shard.r) {
    const names = row[1].split('|');
    const brand = row[5] >= 0 ? shard.b[row[5]] : undefined;
    let m = 0;
    for (const n of brand ? [...names, brand] : names) {
      const key = searchKey(n);
      const toks = keyTokens(key).flatMap(tokenAliases);
      const all = qt.every((q, i) => toks.some((t) => (i === qt.length - 1 ? t.startsWith(q) : t === q || t.startsWith(q))));
      if (all || key.replace(/ /g, '').startsWith(glued)) {
        m = Math.max(m, key === qt.join(' ') || key.replace(/ /g, '') === glued ? 1 : key.startsWith(qt[0]) ? 0.95 : 0.9);
      } else if (pq) {
        const f = fuzzyScore(pq, n);
        if (f >= 0.8) m = Math.max(m, f * 0.9);
      }
    }
    if (!m) continue;
    const at: LngLat = [row[2] / 1e5, row[3] / 1e5];
    const close = near ? closeness(distance(near, at)) : 0;
    scored.push({ row, s: 0.5 * m + 0.44 * close + 0.03 * row[6] });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(({ row }) => rowToPlace(shard, row));
}

function rowToPlace(shard: PlacesIndexShard, row: PlacesIndexRow): Place {
  const [id, names, lng, lat, ci, bi] = row;
  const category = ci >= 0 ? shard.c[ci] : undefined;
  const p: Place = { id: `ovt:${id}`, name: names.split('|')[0], lng: lng / 1e5, lat: lat / 1e5 };
  if (category) p.category = { key: 'overture', value: category };
  if (bi >= 0) p.brand = shard.b[bi];
  const street = row[8], town = row[7] >= 0 ? shard.l[row[7]] : undefined;
  const address = [street, town].filter(Boolean).join(', ');
  if (address) p.address = address;
  return p;
}
