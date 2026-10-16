/**
 * Our own static geodata ("geoindex"): search, addresses, reverse geocoding and place details
 * built from raw OpenStreetMap extracts in CI (scripts/geodata/build.ts) and served as plain
 * JSON files next to the site (`<GEODATA_URL><region>/...`). This file defines the formats and the
 * pure helpers both the builder and the app use, so the two can never disagree on a key.
 *
 * Layout of one dataset (e.g. data/il/):
 *   manifest.json         GeoManifest: version, build time, shard counts, which prefixes are split
 *   names.json            NameEntry[]: unique searchable names, by weight (spell correction)
 *   places.json           PlaceRecord[]: settlements and neighbourhoods (reverse geocoding fallback)
 *   s/<prefix>.json       SearchRecord[]: every record having a name token with that prefix
 *   a/<n>.json            AddressShard: housenumbers of streets, by hash of the street's address key
 *   d/<n>.json            DetailShard: OSM tags of places/streets/POIs, by hash of the OSM id
 *   r/<x>_<y>.json        ReverseTile: addresses, street lines and POIs of one grid cell
 * Imports must stay type-only (or .ts files without runtime deps): the builder runs this file
 * with `node --experimental-strip-types`.
 */
import { normalizeQuery } from './hebrew.ts';
import type { BBox, LngLat, Place } from './types.ts';

/** Bump when a file format changes; the app ignores datasets with another version. */
export const GEODATA_VERSION = 1;

export type GeoKind =
  | 'region'
  | 'city'
  | 'town'
  | 'village'
  | 'hamlet'
  | 'suburb'
  | 'neighbourhood'
  | 'locality'
  | 'street'
  | 'poi'
  | 'natural'
  | 'transit';

export interface GeoManifest {
  v: number;
  region: string;
  /** ISO time of the build; also used as a cache-busting query on every shard. */
  built: string;
  /** Where the OSM data came from (e.g. the Geofabrik extract URL). */
  source: string;
  country: string;
  bbox: BBox;
  /** Search shard prefixes that were split into longer prefixes (see shardPrefix). */
  split: string[];
  /** Every search shard prefix that exists (a query word whose shard is missing matches nothing). */
  shards: string[];
  addrShards: number;
  detailShards: number;
  /** Reverse geocoding grid cell size in degrees. */
  revCell: number;
  counts: Record<string, number>;
  /** Bytes per file group, for the docs and for sanity checks. */
  bytes?: Record<string, number>;
}

/** names.json entry: a unique name with its kind, weight and (for streets/POIs) city. */
export interface NameEntry {
  n: string;
  k: GeoKind;
  w: number;
  c?: string;
}

export interface SearchRecord {
  /** Short OSM id ("n123", "w456", "r789"); absent for streets known only from addresses. */
  i?: string;
  /** name=* (or the best name we have). */
  n: string;
  he?: string;
  en?: string;
  ar?: string;
  k: GeoKind;
  /** OSM category "key=value". */
  t?: string;
  /** [lng, lat], 5 decimals. */
  l: LngLat;
  c?: string;
  /** addr:street / addr:housenumber of a POI. */
  s?: string;
  h?: string;
  /** Extent of an area or a street, 4 decimals. */
  b?: BBox;
  w: number;
  /** Address key of a street that has housenumbers (see addrShardOf). */
  a?: string;
}

/** Street address key -> [housenumber, lngE5, latE5][] */
export type AddressShard = Record<string, [string, number, number][]>;

export interface DetailRecord {
  /** OSM tags (minus noise like source=*). */
  t: Record<string, string>;
  l: LngLat;
  c?: string;
}
/** Short OSM id ("n123") -> details */
export type DetailShard = Record<string, DetailRecord>;

/** Settlements and neighbourhoods: [lngE5, latE5, name, kind, short OSM id or "", city or ""] */
export type PlaceRecord = [number, number, string, GeoKind, string, string];

/**
 * One reverse geocoding cell. Coordinates are integers in 1e-5 degrees relative to the cell's
 * south-west corner (cellOrigin), which keeps the files small.
 */
export interface ReverseTile {
  /** Street / POI names and city names referenced by index. */
  n: string[];
  c: string[];
  /** Addresses: [dx, dy, streetNameIdx, housenumber, cityIdx] */
  a: [number, number, number, string, number][];
  /** Street lines clipped to the cell: [nameIdx, cityIdx, short OSM id, highway value, dx0, dy0, dx1, dy1, ...] */
  s: (number | string)[][];
  /** Named POIs: [dx, dy, nameIdx, cityIdx, short OSM id, "key=value"] */
  p: [number, number, number, number, string, string][];
}

// ---------------------------------------------------------------- keys

const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/**
 * The normalized form every index key and every query goes through: normalizeQuery (niqqud,
 * quotes, abbreviations, קרית/קריית), lower case, no diacritics, Hebrew final letters folded to
 * their regular form, punctuation as spaces.
 */
export function searchKey(s: string): string {
  return normalizeQuery(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/['"`״׳ـ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function keyTokens(key: string): string[] {
  return key ? key.split(' ').filter(Boolean) : [];
}

/** A Hebrew word that starts with the article ה also matches without it ("הכרמל" ~ "כרמל"). */
export function tokenAliases(token: string): string[] {
  return token.length >= 4 && token[0] === 'ה' && /[א-ת]/.test(token[1]) ? [token, token.slice(1)] : [token];
}

/** Tokens a record is indexed under: every word of every name, with aliases, 2+ characters. */
export function indexTokens(names: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    for (const t of keyTokens(searchKey(n))) for (const a of tokenAliases(t)) if (a.length >= 2) out.add(a);
  }
  return [...out];
}

/**
 * The shard a token lives in: its first 2 characters, or longer when that prefix was split
 * because it was too big. A token that ends inside a split prefix goes to "<prefix>$".
 */
export function shardPrefix(token: string, split: ReadonlySet<string>): string {
  const chars = [...token];
  let n = Math.min(2, chars.length);
  let p = chars.slice(0, n).join('');
  while (split.has(p)) {
    if (n >= chars.length) return `${p}$`;
    n++;
    p = chars.slice(0, n).join('');
  }
  return p;
}

/** File name of a shard prefix: hex code points, so URLs and file systems stay ASCII. */
export function shardFile(prefix: string): string {
  return `s/${[...prefix].map((c) => c.codePointAt(0)!.toString(16)).join('-')}.json`;
}

/** FNV-1a 32-bit, for hash shards. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function addrShardOf(addrKey: string, shards: number): string {
  return `a/${hash32(addrKey) % shards}.json`;
}

export function detailShardOf(shortId: string, shards: number): string {
  return `d/${hash32(shortId) % shards}.json`;
}

export function cellOf(lng: number, lat: number, cell: number): [number, number] {
  // Round first so 34.80 / 0.02 doesn't land in cell 1739 because of floating point.
  return [Math.floor(Math.round((lng / cell) * 1e6) / 1e6), Math.floor(Math.round((lat / cell) * 1e6) / 1e6)];
}

export function cellOrigin(x: number, y: number, cell: number): LngLat {
  return [Math.round(x * cell * 1e5) / 1e5, Math.round(y * cell * 1e5) / 1e5];
}

export function revTileFile(x: number, y: number): string {
  return `r/${x}_${y}.json`;
}

/** Address key of a street: its OSM id when it has one, else "name|city" keys. */
export function streetAddrKey(id: string | undefined, name: string, city: string | undefined): string {
  return id ?? `${searchKey(name)}|${searchKey(city ?? '')}`;
}

/** "12א", "12 א", "12-A" -> "12א" / "12a". */
export function normHouse(h: string): string {
  return searchKey(h).replace(/\s+/g, '');
}

/** Split "דיזנגוף 50 תל אביב" into the housenumber and the other words. */
export function parseHouseQuery(key: string): { number?: string; rest: string[] } {
  const toks = keyTokens(key);
  // "50 א" typed with a space: glue a single Hebrew letter to the number before it.
  for (let i = 0; i < toks.length - 1; i++) {
    if (/^\d{1,4}$/.test(toks[i]) && /^[א-ת]$/.test(toks[i + 1])) toks.splice(i, 2, toks[i] + toks[i + 1]);
  }
  const idx = toks.findIndex((t, i) => /^\d{1,4}[א-תa-z]?$/.test(t) && i > 0);
  if (idx < 0) return { rest: toks };
  return { number: toks[idx], rest: toks.filter((_, i) => i !== idx) };
}

// ---------------------------------------------------------------- ranking

export interface QueryInfo {
  key: string;
  tokens: string[];
}

export function queryInfo(q: string): QueryInfo {
  const key = searchKey(q);
  return { key, tokens: keyTokens(key) };
}

const tokenSet = (key: string) => {
  const out: string[] = [];
  for (const t of keyTokens(key)) out.push(...tokenAliases(t));
  return out;
};

/** Distance bonus scale: about 2 km at zoom 16, 8 km at zoom 14, 130 km at zoom 10. */
function distanceScaleKm(zoom = 12): number {
  return Math.min(200, Math.max(1, 2 * 2 ** (16 - zoom)));
}

function approxKm(a: LngLat, b: LngLat): number {
  const dx = (a[0] - b[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = (a[1] - b[1]) * 110.57;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface Scored {
  rec: SearchRecord;
  score: number;
  /** The query is a prefix of the name, or it names every word of it (not just one word of a longer name). */
  complete: boolean;
}

/**
 * How well a record answers the query, or null when it doesn't. Every query word must match a
 * word of one of the record's names (exact or as a prefix) or of its city; at least one must
 * match the name. Then: exact > prefix, whole-name matches, the record's own weight (kind,
 * population, importance) and closeness to the map centre.
 */
export function scoreRecord(rec: SearchRecord, q: QueryInfo, opts: { near?: LngLat; zoom?: number } = {}): Scored | null {
  if (!q.tokens.length) return null;
  const cityToks = rec.c ? tokenSet(searchKey(rec.c)) : [];
  let best: number | null = null;
  let complete = false;
  for (const name of new Set([rec.n, rec.he, rec.en, rec.ar])) {
    if (!name) continue;
    const nameKey = searchKey(name);
    const words = keyTokens(nameKey);
    const toks = tokenSet(nameKey);
    let exact = 0;
    let prefix = 0;
    let city = 0;
    let ok = true;
    const used = new Set<string>();
    for (let i = 0; i < q.tokens.length; i++) {
      const qt = q.tokens[i];
      // One letter is a fine prefix for the word being typed ("דיזנגוף ס"), not for the others.
      const canPrefix = qt.length >= 2 || i === q.tokens.length - 1;
      if (toks.includes(qt)) {
        exact++;
        used.add(qt);
      } else if (canPrefix && toks.some((t) => t.startsWith(qt))) {
        prefix++;
        used.add(toks.find((t) => t.startsWith(qt))!);
      } else if (cityToks.includes(qt) || (canPrefix && cityToks.some((t) => t.startsWith(qt)))) city++;
      else {
        ok = false;
        break;
      }
    }
    if (!ok || exact + prefix === 0) continue;
    const coveredWords = words.filter((w) => tokenAliases(w).some((a) => used.has(a))).length;
    let s = rec.w + exact * 12 + prefix * 6 + city * 10;
    s += 25 * (coveredWords / Math.max(1, words.length));
    if (nameKey === q.key) s += 60;
    else if (nameKey.startsWith(q.key)) s += 35;
    s -= 2 * Math.max(0, words.length - coveredWords);
    if (best === null || s > best) best = s;
    if (nameKey.startsWith(q.key) || coveredWords === words.length) complete = true;
  }
  if (best === null) return null;
  if (opts.near) best += 45 * Math.exp(-approxKm(opts.near, rec.l) / distanceScaleKm(opts.zoom));
  return { rec, score: best, complete };
}

/** Rank records (deduplicated by id) for a query. */
export function rankRecords(
  recs: SearchRecord[],
  q: QueryInfo,
  opts: { near?: LngLat; zoom?: number; bbox?: BBox; kinds?: GeoKind[] } = {},
): Scored[] {
  const seen = new Set<string>();
  const out: Scored[] = [];
  for (const r of recs) {
    const id = r.i ?? `${r.n}|${r.c ?? ''}|${r.k}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (opts.kinds && !opts.kinds.includes(r.k)) continue;
    if (opts.bbox) {
      const [w, s, e, n] = opts.bbox;
      if (r.l[0] < w || r.l[0] > e || r.l[1] < s || r.l[1] > n) continue;
    }
    const sc = scoreRecord(r, q, opts);
    if (sc) out.push(sc);
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- to app types

const PLACE_KINDS = new Set<GeoKind>(['region', 'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality']);

export function displayName(rec: Pick<SearchRecord, 'n' | 'he' | 'en' | 'ar'>, lang: string): string {
  const byLang = lang === 'he' ? rec.he : lang === 'en' ? rec.en : lang === 'ar' ? rec.ar : undefined;
  return byLang ?? (lang === 'he' ? rec.n : (rec.en ?? rec.n));
}

const LETTER_TYPE = { n: 'node', w: 'way', r: 'relation' } as const;

export function shortIdToOsm(i: string): { type: 'node' | 'way' | 'relation'; id: number } | undefined {
  const m = /^([nwr])(\d+)$/.exec(i);
  return m ? { type: LETTER_TYPE[m[1] as 'n' | 'w' | 'r'], id: Number(m[2]) } : undefined;
}

const pointId = (l: LngLat) => `pt:${l[0].toFixed(5)},${l[1].toFixed(5)}`;

export function recordToPlace(rec: SearchRecord, lang: string, country: string): Place {
  const name = displayName(rec, lang);
  const streetLine = rec.s ? `${rec.s}${rec.h ? ` ${rec.h}` : ''}` : undefined;
  const parts = [streetLine, PLACE_KINDS.has(rec.k) && rec.k !== 'suburb' && rec.k !== 'neighbourhood' ? undefined : rec.c].filter(
    (x): x is string => !!x && x !== name,
  );
  const osm = rec.i ? shortIdToOsm(rec.i) : undefined;
  const place: Place = {
    id: osm ? `osm:${rec.i}` : pointId(rec.l),
    name,
    lng: rec.l[0],
    lat: rec.l[1],
    address: parts.join(', ') || undefined,
    countryCode: country,
  };
  if (rec.t) {
    const eq = rec.t.indexOf('=');
    place.category = { key: rec.t.slice(0, eq), value: rec.t.slice(eq + 1) };
  }
  if (osm) place.osm = osm;
  if (rec.b) place.extent = rec.b;
  return place;
}

/** A resolved address ("דיזנגוף 50") as a place; its id is the point, like a dropped pin. */
export function addressPlace(street: string, house: string, city: string | undefined, l: LngLat, country: string): Place {
  return {
    id: pointId(l),
    name: `${street} ${house}`,
    lng: l[0],
    lat: l[1],
    address: city,
    category: { key: 'place', value: 'house' },
    countryCode: country,
  };
}

// ---------------------------------------------------------------- reverse geocoding

function metersBetween(a: LngLat, b: LngLat): number {
  return approxKm(a, b) * 1000;
}

function distToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  const k = Math.cos(p[1] * (Math.PI / 180));
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * 110_900;
}

export interface ReverseHit {
  kind: 'address' | 'poi' | 'street' | 'place';
  place: Place;
  meters: number;
}

/** Limits for reverse geocoding: an address within 35 m wins, then a POI within 20 m, then a street within 70 m. */
export const REVERSE_LIMITS = { address: 35, poi: 20, street: 70 };

/**
 * Answer "what is here?" from the cells around the point (and the settlements list as a
 * fallback). Returns null when nothing is close enough.
 */
export function reverseLookup(
  p: LngLat,
  tiles: { x: number; y: number; tile: ReverseTile }[],
  cell: number,
  places: PlaceRecord[],
  country: string,
): ReverseHit | null {
  let addr: ReverseHit | null = null;
  let poi: ReverseHit | null = null;
  let street: ReverseHit | null = null;
  for (const { x, y, tile } of tiles) {
    const [ox, oy] = cellOrigin(x, y, cell);
    const at = (dx: number, dy: number): LngLat => [Math.round((ox + dx / 1e5) * 1e5) / 1e5, Math.round((oy + dy / 1e5) * 1e5) / 1e5];
    for (const [dx, dy, si, num, ci] of tile.a) {
      const l = at(dx, dy);
      const m = metersBetween(p, l);
      if (m <= REVERSE_LIMITS.address && (!addr || m < addr.meters)) {
        addr = { kind: 'address', meters: m, place: addressPlace(tile.n[si], num, tile.c[ci] || undefined, l, country) };
      }
    }
    for (const [dx, dy, ni, ci, id, cat] of tile.p) {
      const l = at(dx, dy);
      const m = metersBetween(p, l);
      if (m <= REVERSE_LIMITS.poi && (!poi || m < poi.meters)) {
        const eq = cat.indexOf('=');
        const osm = id ? shortIdToOsm(id) : undefined;
        poi = {
          kind: 'poi',
          meters: m,
          place: {
            id: osm ? `osm:${id}` : pointId(l),
            name: tile.n[ni],
            lng: l[0],
            lat: l[1],
            address: tile.c[ci] || undefined,
            category: eq > 0 ? { key: cat.slice(0, eq), value: cat.slice(eq + 1) } : undefined,
            osm,
            countryCode: country,
          },
        };
      }
    }
    for (const line of tile.s) {
      const [ni, ci, id, hw] = line as [number, number, string, string];
      let bestM = Infinity;
      let bestPt: LngLat = p;
      for (let i = 4; i + 3 < line.length; i += 2) {
        const a = at(line[i] as number, line[i + 1] as number);
        const b = at(line[i + 2] as number, line[i + 3] as number);
        const m = distToSegmentM(p, a, b);
        if (m < bestM) {
          bestM = m;
          bestPt = a;
        }
      }
      if (line.length === 6) {
        bestPt = at(line[4] as number, line[5] as number);
        bestM = metersBetween(p, bestPt);
      }
      if (bestM <= REVERSE_LIMITS.street && (!street || bestM < street.meters)) {
        const osm = id ? shortIdToOsm(id) : undefined;
        street = {
          kind: 'street',
          meters: bestM,
          place: {
            id: osm ? `osm:${id}` : pointId(bestPt),
            name: tile.n[ni],
            lng: p[0],
            lat: p[1],
            address: tile.c[ci] || undefined,
            category: { key: 'highway', value: hw || 'road' },
            osm,
            countryCode: country,
          },
        };
      }
    }
  }
  if (addr) return addr;
  if (poi) return poi;
  if (street) return street;
  return nearestPlace(p, places, country);
}

/** Radius (m) within which a settlement or neighbourhood is "where you are". */
const PLACE_RADIUS_M: Partial<Record<GeoKind, number>> = {
  city: 7000,
  town: 4000,
  village: 2000,
  hamlet: 1200,
  suburb: 1500,
  neighbourhood: 900,
  locality: 800,
};

export function nearestPlace(p: LngLat, places: PlaceRecord[], country: string): ReverseHit | null {
  let best: { rec: PlaceRecord; m: number; rel: number } | null = null;
  for (const rec of places) {
    const r = PLACE_RADIUS_M[rec[3]];
    if (!r) continue;
    const l: LngLat = [rec[0] / 1e5, rec[1] / 1e5];
    const m = metersBetween(p, l);
    if (m > r) continue;
    // Prefer the most local thing (a neighbourhood over its city), then the closest.
    const rel = m / r + (rec[3] === 'suburb' || rec[3] === 'neighbourhood' ? -1 : 0);
    if (!best || rel < best.rel) best = { rec, m, rel };
  }
  if (!best) return null;
  const [x, y, name, kind, id, city] = best.rec;
  const osm = id ? shortIdToOsm(id) : undefined;
  return {
    kind: 'place',
    meters: best.m,
    place: {
      id: osm ? `osm:${id}` : pointId([x / 1e5, y / 1e5]),
      name,
      lng: p[0],
      lat: p[1],
      address: city || undefined,
      category: { key: 'place', value: kind },
      osm,
      countryCode: country,
    },
  };
}

/** Cells to read for a point: its own, plus neighbours when it is near an edge. */
export function cellsAround(lng: number, lat: number, cell: number, marginDeg = 0.0015): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (const dx of [-marginDeg, 0, marginDeg]) {
    for (const dy of [-marginDeg, 0, marginDeg]) {
      const c = cellOf(lng + dx, lat + dy, cell);
      out.set(`${c[0]}_${c[1]}`, c);
    }
  }
  return [...out.values()];
}
