#!/usr/bin/env node
/**
 * Builds our static geodata for one region from an OpenStreetMap export (GeoJSONSeq written by
 * `osmium export -f geojsonseq -a type,id`, see build-region.sh). Formats: packages/core/src/geoindex.ts.
 *
 *   node --experimental-strip-types scripts/geodata/build.ts --region il --input il.geojsonseq --out out/il
 *
 * The input is streamed line by line (a country is 1-2 GB of JSON); only what we index is kept in
 * memory (settlements, street segments, addresses and named POIs, with their tags trimmed).
 */
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  addrShardOf,
  cellOf,
  cellOrigin,
  detailShardOf,
  GEODATA_VERSION,
  indexTokens,
  revTileFile,
  searchKey,
  shardFile,
  shardPrefix,
  streetAddrKey,
  type AddressShard,
  type DetailShard,
  type GeoKind,
  type GeoManifest,
  type NameEntry,
  type PlaceRecord,
  type ReverseTile,
  type SearchRecord,
} from '../../packages/core/src/geoindex.ts';
import { REGIONS, type Region, type RegionGeodata } from '../../packages/core/src/region.ts';
import type { BBox, LngLat } from '../../packages/core/src/types.ts';

// ---------------------------------------------------------------- limits

/** GitHub Pages and browsers are happiest with small files; the build fails above this. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SEARCH_SHARD_BYTES = 300_000;
const HASH_SHARD_BYTES = 150_000;
const MAX_NAMES = 150_000;
const REV_CELL = 0.02;
/** Douglas-Peucker tolerance for street lines in the reverse grid (~4 m). */
const SIMPLIFY_DEG = 0.00004;

// ---------------------------------------------------------------- input

type Pos = [number, number];
type Geometry =
  | { type: 'Point'; coordinates: Pos }
  | { type: 'LineString'; coordinates: Pos[] }
  | { type: 'MultiLineString'; coordinates: Pos[][] }
  | { type: 'Polygon'; coordinates: Pos[][] }
  | { type: 'MultiPolygon'; coordinates: Pos[][][] };

export interface OsmFeature {
  /** Short id: n123 / w456 / r789 */
  sid: string;
  tags: Record<string, string>;
  geometry: Geometry;
}

const TYPE_LETTER: Record<string, string> = { node: 'n', way: 'w', relation: 'r', n: 'n', w: 'w', r: 'r' };

/** One GeoJSONSeq line (RFC 8142 record separators allowed) -> feature with its OSM id, or null. */
export function parseLine(line: string): OsmFeature | null {
  const s = line.replace(/^[\x1e\s]+/, '').trimEnd();
  if (!s || s[0] !== '{') return null;
  let f: { id?: string | number; properties?: Record<string, unknown>; geometry?: Geometry };
  try {
    f = JSON.parse(s);
  } catch {
    return null;
  }
  if (!f.geometry || !f.properties) return null;
  const props = f.properties;
  let sid: string | undefined;
  const t = TYPE_LETTER[String(props['@type'] ?? '')];
  if (t && props['@id'] !== undefined) sid = `${t}${props['@id']}`;
  else if (typeof f.id === 'string') {
    // --add-unique-id=type_id: n123 / w123 / r123, and a<area id> for areas (2*way or 2*relation+1).
    const m = /^([nwra])(\d+)$/.exec(f.id);
    if (m) {
      if (m[1] !== 'a') sid = `${m[1]}${m[2]}`;
      else {
        const n = Number(m[2]);
        sid = n % 2 === 0 ? `w${n / 2}` : `r${(n - 1) / 2}`;
      }
    }
  }
  if (!sid) return null;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) if (k[0] !== '@' && typeof v === 'string') tags[k] = v;
  return { sid, tags, geometry: f.geometry };
}

// ---------------------------------------------------------------- geometry

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function ringArea(ring: Pos[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

function polygons(g: Geometry): Pos[][][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
}

function allPositions(g: Geometry): Pos[] {
  switch (g.type) {
    case 'Point':
      return [g.coordinates];
    case 'LineString':
      return g.coordinates;
    case 'MultiLineString':
      return g.coordinates.flat();
    case 'Polygon':
      return g.coordinates[0] ?? [];
    case 'MultiPolygon':
      return g.coordinates.flatMap((p) => p[0] ?? []);
  }
}

function bboxOfPositions(ps: Pos[]): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ps) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

function pointInRings(p: Pos, rings: Pos[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(p: Pos, g: Geometry): boolean {
  return polygons(g).some((rings) => pointInRings(p, rings));
}

function lineMidpoint(line: Pos[]): Pos {
  if (line.length === 1) return line[0];
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let half = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] && seg[i] > 0) {
      const t = half / seg[i];
      return [line[i][0] + t * (line[i + 1][0] - line[i][0]), line[i][1] + t * (line[i + 1][1] - line[i][1])];
    }
    half -= seg[i];
  }
  return line[line.length - 1];
}

/** A point inside the polygon: the centroid when it is inside, else the middle of the widest scanline. */
function polygonPoint(rings: Pos[][]): Pos {
  const outer = rings[0];
  // Relative to the first vertex: small buildings at lng 34.78 would otherwise lose precision.
  const [x0, y0] = outer[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const xi = outer[i][0] - x0, yi = outer[i][1] - y0, xj = outer[j][0] - x0, yj = outer[j][1] - y0;
    const f = xj * yi - xi * yj;
    a += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  const c: Pos = a ? [x0 + cx / (3 * a), y0 + cy / (3 * a)] : outer[0];
  if (pointInRings(c, rings)) return c;
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > c[1] !== yj > c[1]) xs.push(((xj - xi) * (c[1] - yi)) / (yj - yi) + xi);
    }
  }
  xs.sort((p, q) => p - q);
  let best: Pos = outer[0];
  let width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > width) {
      width = xs[i + 1] - xs[i];
      best = [(xs[i] + xs[i + 1]) / 2, c[1]];
    }
  }
  return best;
}

export function representativePoint(g: Geometry): Pos {
  switch (g.type) {
    case 'Point':
      return g.coordinates;
    case 'LineString':
      return lineMidpoint(g.coordinates);
    case 'MultiLineString':
      return lineMidpoint(g.coordinates.reduce((a, b) => (b.length > a.length ? b : a), [] as Pos[]));
    default: {
      const polys = polygons(g);
      let best = polys[0];
      let area = -1;
      for (const p of polys) {
        const ar = Math.abs(ringArea(p[0] ?? []));
        if (ar > area) {
          area = ar;
          best = p;
        }
      }
      return polygonPoint(best);
    }
  }
}

function simplify(line: Pos[], tol: number): Pos[] {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    const [ax, ay] = line[a];
    const [bx, by] = line[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs(dy * line[i][0] - dx * line[i][1] + bx * ay - by * ax) / len : Math.hypot(line[i][0] - ax, line[i][1] - ay);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Squared-ish metres between two points (for "near" checks only). */
function meters(a: Pos, b: Pos): number {
  const dx = (a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110_570;
  return Math.hypot(dx, dy);
}

function bboxDistanceM(p: Pos, b: BBox): number {
  const x = Math.max(b[0], Math.min(p[0], b[2]));
  const y = Math.max(b[1], Math.min(p[1], b[3]));
  return meters(p, [x, y]);
}

// ---------------------------------------------------------------- classification

const PLACE_KIND: Record<string, GeoKind> = {
  state: 'region',
  province: 'region',
  region: 'region',
  district: 'region',
  city: 'city',
  town: 'town',
  village: 'village',
  hamlet: 'hamlet',
  isolated_dwelling: 'hamlet',
  suburb: 'suburb',
  quarter: 'suburb',
  borough: 'suburb',
  neighbourhood: 'neighbourhood',
  locality: 'locality',
};
const PLACE_WEIGHT: Partial<Record<GeoKind, number>> = {
  region: 70,
  city: 100,
  town: 80,
  village: 55,
  hamlet: 35,
  suburb: 50,
  neighbourhood: 40,
  locality: 25,
};
const SETTLEMENT = new Set<GeoKind>(['city', 'town', 'village', 'hamlet']);
const SETTLEMENT_RADIUS_M: Partial<Record<GeoKind, number>> = { city: 7000, town: 4000, village: 2000, hamlet: 1200 };

const ROADS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian',
  'service', 'track', 'road', 'footway', 'path', 'cycleway', 'steps', 'busway', 'bridleway',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
const ROAD_BONUS: Record<string, number> = {
  motorway: 12, trunk: 12, primary: 10, secondary: 8, tertiary: 6, residential: 3, unclassified: 3, living_street: 3, pedestrian: 3,
};

/** Order matters: the first key present is the place's category (same idea as the Overpass provider). */
const POI_KEYS = [
  'amenity', 'shop', 'tourism', 'leisure', 'historic', 'office', 'craft', 'healthcare', 'aeroway', 'railway', 'public_transport',
  'place', 'highway', 'natural', 'water', 'waterway', 'man_made', 'emergency', 'military', 'club', 'sport', 'landuse', 'building',
];
const RAIL_POI = new Set(['station', 'halt', 'tram_stop', 'subway_entrance']);
const LANDUSE_POI = new Set(['cemetery', 'forest', 'recreation_ground', 'religious', 'allotments', 'orchard', 'vineyard']);
const LINE_POI_KEYS = new Set(['waterway', 'natural']);

function poiCategory(tags: Record<string, string>, isLine: boolean): { key: string; value: string } | null {
  for (const key of POI_KEYS) {
    const value = tags[key];
    if (!value || value === 'no') continue;
    if (isLine && !LINE_POI_KEYS.has(key)) continue;
    if (key === 'railway' && !RAIL_POI.has(value)) continue;
    if (key === 'highway' && !['bus_stop', 'rest_area', 'services', 'pedestrian'].includes(value)) continue;
    if (key === 'public_transport' && value !== 'station') continue;
    if (key === 'landuse' && !LANDUSE_POI.has(value)) continue;
    if (key === 'place' && !['square', 'island', 'islet', 'farm', 'plot'].includes(value)) continue;
    if (key === 'waterway' && !['river', 'stream', 'canal', 'waterfall', 'wadi'].includes(value)) continue;
    return { key, value };
  }
  return null;
}

function poiKind(cat: { key: string; value: string }): GeoKind {
  if (['natural', 'water', 'waterway'].includes(cat.key) || (cat.key === 'place' && (cat.value === 'island' || cat.value === 'islet'))) return 'natural';
  if ((cat.key === 'highway' && cat.value === 'bus_stop') || (cat.key === 'railway' && cat.value !== 'station') || cat.key === 'public_transport') return 'transit';
  return 'poi';
}

function poiWeight(tags: Record<string, string>, cat: { key: string; value: string }, kind: GeoKind): number {
  if (kind === 'transit') return cat.key === 'railway' ? 30 : 8;
  let w = kind === 'natural' ? 25 : 15;
  if (tags.wikidata) w += 12;
  if (tags.wikipedia) w += 6;
  if (tags.brand) w += 2;
  const kv = `${cat.key}=${cat.value}`;
  const BONUS: Record<string, number> = {
    'aeroway=aerodrome': 25, 'railway=station': 20, 'shop=mall': 12, 'amenity=university': 12, 'amenity=hospital': 12,
    'amenity=college': 8, 'tourism=museum': 10, 'tourism=attraction': 10, 'tourism=zoo': 12, 'tourism=theme_park': 12,
    'leisure=stadium': 10, 'leisure=park': 5, 'leisure=nature_reserve': 8, 'historic=archaeological_site': 6, 'natural=peak': 5,
    'natural=beach': 8, 'amenity=place_of_worship': 2, 'tourism=hotel': 4, 'building=yes': -8,
  };
  w += BONUS[kv] ?? 0;
  if (tags.iata) w += 10;
  return w;
}

const NOISE_KEY = /^(source|note|fixme|todo|created_by|check_date|survey|is_in|import|history|attribution|tiger|gnis|nhd|not:|ref:|osmc|description:|old_ref|mapillary|lacounty|massgis|yh:)/i;
const KEEP_NAME_LANGS = new Set(['he', 'en', 'ar', 'ru', 'fr', 'de', 'es', 'it', 'am']);

function trimTags(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (NOISE_KEY.test(k)) continue;
    const m = /^(name|old_name|alt_name|short_name|official_name):(.+)$/.exec(k);
    if (m && !KEEP_NAME_LANGS.has(m[2])) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- collected data

interface Settlement {
  sid: string;
  name: string;
  tags: Record<string, string>;
  kind: GeoKind;
  point: Pos;
  bbox?: BBox;
  isArea: boolean;
}
interface Admin {
  name: string;
  geometry: Geometry;
  bbox: BBox;
  area: number;
}
interface Segment {
  sid: string;
  tags: Record<string, string>;
  line: Pos[];
  length: number;
}
interface Address {
  street: string;
  num: string;
  city?: string;
  point: Pos;
}
interface Poi {
  sid: string;
  tags: Record<string, string>;
  cat: { key: string; value: string };
  kind: GeoKind;
  point: Pos;
  bbox?: BBox;
}

/** The same housenumber twice within 30 m (an address node inside its building, a shop's address) is one address. */
function dedupeAddrs(addrs: Address[]): Address[] {
  const out: Address[] = [];
  for (const a of addrs) if (!out.some((b) => b.num === a.num && meters(a.point, b.point) < 30)) out.push(a);
  return out;
}

export interface BuildOptions {
  region: Region & { geodata: RegionGeodata };
  out: string;
  built: string;
  source?: string;
  /** Overrides for small fixtures (tests): shard sizes. */
  searchShardBytes?: number;
  hashShardBytes?: number;
}

export interface BuildReport {
  manifest: GeoManifest;
  files: number;
  totalBytes: number;
}

type LineSource = AsyncIterable<string> | Iterable<string>;

export async function buildGeodata(lines: LineSource, opts: BuildOptions): Promise<BuildReport> {
  const region = opts.region;
  const lang = region.languages[0] ?? 'en';
  const nameOf = (tags: Record<string, string>) => tags[`name:${lang}`] ?? tags.name;
  const inRegion = (p: Pos) => {
    const b = region.bbox;
    return !b || (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]);
  };

  const settlements: Settlement[] = [];
  const admins: Admin[] = [];
  const segments: Segment[] = [];
  const addresses: Address[] = [];
  const pois: Poi[] = [];
  const seen = { place: new Set<string>(), seg: new Set<string>(), addr: new Set<string>(), poi: new Set<string>(), admin: new Set<string>() };

  for await (const line of lines) {
    const f = parseLine(line);
    if (!f) continue;
    const { tags, geometry: g, sid } = f;
    const isArea = g.type === 'Polygon' || g.type === 'MultiPolygon';
    const isLine = g.type === 'LineString' || g.type === 'MultiLineString';
    const name = nameOf(tags);

    if (isArea && tags.boundary === 'administrative' && region.geodata.cityAdminLevels.includes(tags.admin_level ?? '') && name && !seen.admin.has(sid)) {
      seen.admin.add(sid);
      const bbox = bboxOfPositions(allPositions(g));
      admins.push({ name, geometry: g, bbox, area: polygons(g).reduce((a, p) => a + Math.abs(ringArea(p[0] ?? [])), 0) });
    }

    const point = representativePoint(g);
    if (!point || !Number.isFinite(point[0]) || !inRegion(point)) continue;

    const placeKind = tags.place ? PLACE_KIND[tags.place] : undefined;
    if (placeKind && name && !isLine && !seen.place.has(sid)) {
      seen.place.add(sid);
      settlements.push({ sid, name, tags: trimTags(tags), kind: placeKind, point, bbox: isArea ? bboxOfPositions(allPositions(g)) : undefined, isArea });
      continue;
    }

    if (tags.highway && ROADS.has(tags.highway) && name && g.type === 'LineString' && !seen.seg.has(sid)) {
      seen.seg.add(sid);
      let length = 0;
      for (let i = 1; i < g.coordinates.length; i++) length += meters(g.coordinates[i - 1], g.coordinates[i]);
      const keep: Record<string, string> = {};
      for (const [k, v] of Object.entries(trimTags(tags))) if (/^(name|highway|maxspeed|oneway|surface|lanes|lit|old_name|alt_name|wikidata|wikipedia)/.test(k)) keep[k] = v;
      segments.push({ sid, tags: keep, line: g.coordinates, length });
      continue;
    }

    const num = tags['addr:housenumber'];
    const street = tags['addr:street'] ?? tags['addr:place'];
    if (num && street && !isLine) {
      for (const n of num.split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
        const key = `${searchKey(street)}|${n}|${point[0].toFixed(4)},${point[1].toFixed(4)}`;
        if (seen.addr.has(key)) continue;
        seen.addr.add(key);
        addresses.push({ street, num: n, city: tags['addr:city'], point });
      }
    }

    if (name && !seen.poi.has(sid)) {
      const cat = poiCategory(tags, isLine);
      if (cat) {
        seen.poi.add(sid);
        pois.push({ sid, tags: trimTags(tags), cat, kind: poiKind(cat), point, bbox: isArea || isLine ? bboxOfPositions(allPositions(g)) : undefined });
      }
    }
  }

  // ---- cities: municipality polygons first, else the nearest settlement
  const GRID = 0.1;
  const gk = (x: number, y: number) => `${Math.floor(x / GRID)}:${Math.floor(y / GRID)}`;
  const adminGrid = new Map<string, Admin[]>();
  for (const a of admins) {
    for (let x = Math.floor(a.bbox[0] / GRID); x <= Math.floor(a.bbox[2] / GRID); x++)
      for (let y = Math.floor(a.bbox[1] / GRID); y <= Math.floor(a.bbox[3] / GRID); y++) {
        const k = `${x}:${y}`;
        (adminGrid.get(k) ?? adminGrid.set(k, []).get(k)!).push(a);
      }
  }
  for (const list of adminGrid.values()) list.sort((p, q) => p.area - q.area);
  const notCity = region.geodata.notCityPrefixes ?? [];

  // Merge a settlement node with its own area (place polygon or same-named municipality) for the extent.
  const nodes = settlements.filter((s) => !s.isArea);
  const areas = settlements.filter((s) => s.isArea);
  const merged: Settlement[] = [...nodes];
  for (const a of areas) {
    const twin = nodes.find((n) => n.kind === a.kind && searchKey(n.name) === searchKey(a.name) && a.bbox && bboxDistanceM(n.point, a.bbox) === 0);
    if (twin) twin.bbox ??= a.bbox;
    else merged.push(a);
  }
  for (const s of merged) {
    if (s.bbox || !SETTLEMENT.has(s.kind)) continue;
    const a = (adminGrid.get(gk(s.point[0], s.point[1])) ?? []).find((x) => searchKey(x.name) === searchKey(s.name) && pointInGeometry(s.point, x.geometry));
    if (a) s.bbox = a.bbox;
  }
  const settleGrid = new Map<string, Settlement[]>();
  for (const s of merged) {
    if (!SETTLEMENT.has(s.kind)) continue;
    const k = gk(s.point[0], s.point[1]);
    (settleGrid.get(k) ?? settleGrid.set(k, []).get(k)!).push(s);
  }
  // One spelling per city: addr:city ("Tel Aviv", "תל אביב-יפו") and municipality names ("תל־אביב–יפו")
  // map to the settlement's display name through any of its name tags.
  const canon = new Map<string, string>();
  const RANK: Partial<Record<GeoKind, number>> = { city: 0, town: 1, village: 2, hamlet: 3 };
  for (const s of [...merged].filter((x) => SETTLEMENT.has(x.kind)).sort((p, q) => (RANK[p.kind] ?? 9) - (RANK[q.kind] ?? 9)))
    for (const [k, v] of Object.entries(s.tags))
      if (/^(name|official_name|alt_name|old_name|short_name|int_name)(:|$)/.test(k))
        for (const one of v.split(';')) {
          const key = searchKey(one);
          if (key && !canon.has(key)) canon.set(key, s.name);
        }
  const canonCity = (raw: string | undefined): string | undefined => (raw ? (canon.get(searchKey(raw)) ?? raw) : undefined);

  const cityCache = new Map<string, string | undefined>();
  const cityAt = (p: Pos): string | undefined => {
    // Memoise per ~10 m cell: addresses of one building and segments of one street repeat points.
    const ck = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    if (cityCache.has(ck)) return cityCache.get(ck);
    let out: string | undefined;
    for (const a of adminGrid.get(gk(p[0], p[1])) ?? []) {
      if (a.bbox[0] > p[0] || a.bbox[2] < p[0] || a.bbox[1] > p[1] || a.bbox[3] < p[1]) continue;
      if (notCity.some((pre) => a.name.startsWith(pre))) continue;
      if (pointInGeometry(p, a.geometry)) {
        out = a.name;
        break;
      }
    }
    if (!out) {
      let best = Infinity;
      const cx = Math.floor(p[0] / GRID), cy = Math.floor(p[1] / GRID);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const s of settleGrid.get(`${cx + dx}:${cy + dy}`) ?? []) {
            const m = s.bbox && bboxDistanceM(p, s.bbox) === 0 ? 0 : meters(p, s.point);
            const rel = m / (SETTLEMENT_RADIUS_M[s.kind] ?? 1000);
            if (rel <= 1 && rel < best) {
              best = rel;
              out = s.name;
            }
          }
    }
    out = canonCity(out);
    if (cityCache.size > 2_000_000) cityCache.clear();
    cityCache.set(ck, out);
    return out;
  };

  // ---- records
  const records: SearchRecord[] = [];
  const details: { sid: string; rec: { t: Record<string, string>; l: LngLat; c?: string } }[] = [];
  const names = (tags: Record<string, string>) => {
    const n = tags.name ?? nameOf(tags)!;
    const v = (k: string) => (tags[`name:${k}`] && tags[`name:${k}`] !== n ? tags[`name:${k}`] : undefined);
    return { n, he: v('he'), en: v('en'), ar: v('ar') };
  };
  const clean = <T extends object>(o: T): T => {
    for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
    return o;
  };
  const ll = (p: Pos): LngLat => [r5(p[0]), r5(p[1])];
  const bb = (b: BBox): BBox => [r4(b[0]), r4(b[1]), r4(b[2]), r4(b[3])];

  const placeRecords: PlaceRecord[] = [];
  for (const s of merged) {
    const pop = Number((s.tags.population ?? '').replace(/[^\d]/g, ''));
    const city = SETTLEMENT.has(s.kind) || s.kind === 'region' ? undefined : cityAt(s.point);
    const w = (PLACE_WEIGHT[s.kind] ?? 30) + (pop > 0 ? Math.round(6 * Math.log10(pop)) : 0) + (s.tags.wikidata ? 3 : 0);
    records.push(clean({ i: s.sid, ...names(s.tags), k: s.kind, t: `place=${s.tags.place}`, l: ll(s.point), c: city, b: s.bbox ? bb(s.bbox) : undefined, w }));
    details.push({ sid: s.sid, rec: clean({ t: s.tags, l: ll(s.point), c: city }) });
    if (s.kind !== 'region') placeRecords.push([Math.round(s.point[0] * 1e5), Math.round(s.point[1] * 1e5), s.name, s.kind, s.sid, city ?? '']);
  }

  // Streets: one record per name and city (OSM splits a street into many ways).
  interface StreetGroup {
    name: string;
    city?: string;
    segs: Segment[];
    bbox: BBox;
    addrs: Address[];
    id?: string;
    point?: Pos;
  }
  const groups = new Map<string, StreetGroup>();
  const byName = new Map<string, StreetGroup[]>();
  const segCity = new Map<Segment, string | undefined>();
  for (const seg of segments) {
    const name = nameOf(seg.tags)!;
    const city = cityAt(lineMidpoint(seg.line));
    segCity.set(seg, city);
    const key = `${searchKey(name)}|${searchKey(city ?? '')}`;
    let g = groups.get(key);
    if (!g) {
      g = { name, city, segs: [], bbox: [Infinity, Infinity, -Infinity, -Infinity], addrs: [] };
      groups.set(key, g);
      const nk = searchKey(name);
      (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(g);
    }
    g.segs.push(seg);
    const b = bboxOfPositions(seg.line);
    g.bbox = [Math.min(g.bbox[0], b[0]), Math.min(g.bbox[1], b[1]), Math.max(g.bbox[2], b[2]), Math.max(g.bbox[3], b[3])];
  }
  // Addresses join the street with that name in their city, else the nearest one within 1.5 km.
  for (const a of addresses) {
    const nk = searchKey(a.street);
    const city = canonCity(a.city) ?? cityAt(a.point);
    const ck = searchKey(city ?? '');
    const cands = byName.get(nk) ?? [];
    let g = cands.find((c) => searchKey(c.city ?? '') === ck && bboxDistanceM(a.point, c.bbox) < 3000);
    if (!g) {
      let best = 1500;
      for (const c of cands) {
        const d = bboxDistanceM(a.point, c.bbox);
        if (d < best) {
          best = d;
          g = c;
        }
      }
    }
    if (!g) {
      const key = `${nk}|${ck}`;
      g = groups.get(key);
      if (!g) {
        g = { name: a.street, city, segs: [], bbox: [a.point[0], a.point[1], a.point[0], a.point[1]], addrs: [] };
        groups.set(key, g);
        (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(g);
      }
      g.bbox = [Math.min(g.bbox[0], a.point[0]), Math.min(g.bbox[1], a.point[1]), Math.max(g.bbox[2], a.point[0]), Math.max(g.bbox[3], a.point[1])];
    }
    g.addrs.push(a);
  }

  const addrShards = new Map<string, [string, number, number][]>();
  const segGroupId = new Map<Segment, string>();
  for (const g of groups.values()) {
    const longest = g.segs.reduce<Segment | undefined>((a, b) => (!a || b.length > a.length ? b : a), undefined);
    g.id = longest?.sid;
    // Reverse hits on any segment name the street's record, which is the one with details.
    for (const seg of g.segs) segGroupId.set(seg, g.id!);
    const point = longest ? lineMidpoint(longest.line) : g.addrs[Math.floor(g.addrs.length / 2)].point;
    g.point = point;
    const tags = longest?.tags ?? { name: g.name };
    const hw = g.segs.map((s) => s.tags.highway).sort((a, b) => (ROAD_BONUS[b] ?? 0) - (ROAD_BONUS[a] ?? 0))[0];
    const w = 30 + (ROAD_BONUS[hw ?? ''] ?? 0) + Math.min(20, Math.round(3 * Math.log2(1 + g.addrs.length)));
    const aKey = g.addrs.length ? streetAddrKey(g.id, g.name, g.city) : undefined;
    records.push(clean({ i: g.id, ...names(tags), k: 'street' as GeoKind, t: hw ? `highway=${hw}` : undefined, l: ll(point), c: g.city, b: bb(g.bbox), w, a: aKey }));
    if (g.id) details.push({ sid: g.id, rec: clean({ t: tags, l: ll(point), c: g.city }) });
    if (aKey) {
      const list = dedupeAddrs(g.addrs)
        .map((a): [string, number, number] => [a.num, Math.round(a.point[0] * 1e5), Math.round(a.point[1] * 1e5)])
        .sort((p, q) => (parseInt(p[0], 10) || 0) - (parseInt(q[0], 10) || 0) || p[0].localeCompare(q[0]));
      addrShards.set(aKey, list);
    }
  }

  for (const p of pois) {
    const city = canonCity(p.tags['addr:city']) ?? cityAt(p.point);
    const w = poiWeight(p.tags, p.cat, p.kind);
    records.push(
      clean({
        i: p.sid,
        ...names(p.tags),
        k: p.kind,
        t: `${p.cat.key}=${p.cat.value}`,
        l: ll(p.point),
        c: city,
        s: p.tags['addr:street'],
        h: p.tags['addr:street'] ? p.tags['addr:housenumber'] : undefined,
        b: p.bbox && (p.bbox[2] - p.bbox[0] > 0.002 || p.bbox[3] - p.bbox[1] > 0.002) ? bb(p.bbox) : undefined,
        w,
      }),
    );
    details.push({ sid: p.sid, rec: clean({ t: p.tags, l: ll(p.point), c: city }) });
  }

  // ---- write
  rmSync(opts.out, { recursive: true, force: true });
  mkdirSync(opts.out, { recursive: true });
  const bytes: Record<string, number> = {};
  let files = 0;
  const write = (rel: string, data: unknown) => {
    const s = JSON.stringify(data);
    const size = Buffer.byteLength(s);
    if (size > MAX_FILE_BYTES) throw new Error(`${rel} is ${size} bytes, over the ${MAX_FILE_BYTES} limit`);
    const p = join(opts.out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, s);
    const group = rel.includes('/') ? rel.split('/')[0] : rel;
    bytes[group] = (bytes[group] ?? 0) + size;
    files++;
  };

  // Search shards: split prefixes until every shard fits.
  const recTokens = records.map((r) => indexTokens([r.n, r.he, r.en, r.ar]));
  const recBytes = records.map((r) => JSON.stringify(r).length + 1);
  const split = new Set<string>();
  const maxShard = opts.searchShardBytes ?? SEARCH_SHARD_BYTES;
  let buckets: Map<string, Set<number>>;
  for (;;) {
    buckets = new Map();
    recTokens.forEach((toks, i) => {
      for (const t of toks) {
        const p = shardPrefix(t, split);
        (buckets.get(p) ?? buckets.set(p, new Set()).get(p)!).add(i);
      }
    });
    let grew = false;
    for (const [p, set] of buckets) {
      if (p.endsWith('$') || [...p].length >= 6) continue;
      let size = 0;
      for (const i of set) size += recBytes[i];
      if (size > maxShard) {
        split.add(p);
        grew = true;
      }
    }
    if (!grew) break;
  }
  for (const [p, set] of buckets) {
    const list = [...set].map((i) => records[i]).sort((a, b) => b.w - a.w);
    write(shardFile(p), list);
  }

  // Names dictionary for spell correction.
  const nameMap = new Map<string, NameEntry>();
  for (const r of records) {
    for (const n of [r.n, r.he, r.en, r.ar]) {
      if (!n) continue;
      const cur = nameMap.get(n);
      if (!cur || r.w > cur.w) nameMap.set(n, clean({ n, k: r.k, w: r.w, c: SETTLEMENT.has(r.k) || r.k === 'region' ? undefined : r.c }));
    }
  }
  const nameList = [...nameMap.values()].sort((a, b) => b.w - a.w || a.n.localeCompare(b.n)).slice(0, MAX_NAMES);
  write('names.json', nameList);
  write('places.json', placeRecords);

  // Hash shards: addresses and details.
  const hashBytes = opts.hashShardBytes ?? HASH_SHARD_BYTES;
  const shardCount = (total: number) => {
    let n = 1;
    while (n < 4096 && total / n > hashBytes) n *= 2;
    return n;
  };
  let addrTotal = 0;
  for (const [k, v] of addrShards) addrTotal += k.length + JSON.stringify(v).length;
  const addrN = shardCount(addrTotal);
  const addrFiles = new Map<string, AddressShard>();
  for (const [k, v] of addrShards) {
    const f = addrShardOf(k, addrN);
    (addrFiles.get(f) ?? addrFiles.set(f, {}).get(f)!)[k] = v;
  }
  for (const [f, data] of addrFiles) write(f, data);

  let detTotal = 0;
  for (const d of details) detTotal += d.sid.length + JSON.stringify(d.rec).length;
  const detN = shardCount(detTotal);
  const detFiles = new Map<string, DetailShard>();
  for (const d of details) {
    const f = detailShardOf(d.sid, detN);
    (detFiles.get(f) ?? detFiles.set(f, {}).get(f)!)[d.sid] = d.rec;
  }
  for (const [f, data] of detFiles) write(f, data);

  // Reverse geocoding grid.
  interface TileBuild {
    names: Map<string, number>;
    cities: Map<string, number>;
    tile: ReverseTile;
  }
  const tiles = new Map<string, TileBuild>();
  const tileAt = (x: number, y: number) => {
    const k = `${x}_${y}`;
    let t = tiles.get(k);
    if (!t) {
      t = { names: new Map(), cities: new Map(), tile: { n: [], c: [], a: [], s: [], p: [] } };
      tiles.set(k, t);
    }
    return t;
  };
  const idx = (map: Map<string, number>, arr: string[], v: string) => {
    let i = map.get(v);
    if (i === undefined) {
      i = arr.length;
      arr.push(v);
      map.set(v, i);
    }
    return i;
  };
  const rel = (p: Pos, x: number, y: number): [number, number] => {
    const [ox, oy] = cellOrigin(x, y, REV_CELL);
    return [Math.round((p[0] - ox) * 1e5), Math.round((p[1] - oy) * 1e5)];
  };
  for (const g of groups.values()) {
    for (const a of dedupeAddrs(g.addrs)) {
      const [x, y] = cellOf(a.point[0], a.point[1], REV_CELL);
      const t = tileAt(x, y);
      const [dx, dy] = rel(a.point, x, y);
      t.tile.a.push([dx, dy, idx(t.names, t.tile.n, a.street), a.num, idx(t.cities, t.tile.c, canonCity(a.city) ?? g.city ?? '')]);
    }
  }
  for (const seg of segments) {
    const line = simplify(seg.line, SIMPLIFY_DEG);
    const b = bboxOfPositions(line);
    const [x0, y0] = cellOf(b[0], b[1], REV_CELL);
    const [x1, y1] = cellOf(b[2], b[3], REV_CELL);
    const name = nameOf(seg.tags)!;
    const city = segCity.get(seg) ?? '';
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const [ox, oy] = cellOrigin(x, y, REV_CELL);
        const cb: BBox = [ox, oy, ox + REV_CELL, oy + REV_CELL];
        // Keep the runs of segments that touch this cell.
        let run: Pos[] = [];
        const flush = () => {
          if (run.length) {
            const t = tileAt(x, y);
            const row: (number | string)[] = [idx(t.names, t.tile.n, name), idx(t.cities, t.tile.c, city), segGroupId.get(seg) ?? seg.sid, seg.tags.highway ?? ''];
            for (const p of run) row.push(...rel(p, x, y));
            t.tile.s.push(row);
          }
          run = [];
        };
        if (line.length === 1) {
          run = [line[0]];
          flush();
          continue;
        }
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1], c = line[i];
          const touches = Math.max(a[0], c[0]) >= cb[0] && Math.min(a[0], c[0]) <= cb[2] && Math.max(a[1], c[1]) >= cb[1] && Math.min(a[1], c[1]) <= cb[3];
          if (touches) {
            if (!run.length) run.push(a);
            run.push(c);
          } else flush();
        }
        flush();
      }
    }
  }
  for (const p of pois) {
    if (p.kind !== 'poi') continue;
    const [x, y] = cellOf(p.point[0], p.point[1], REV_CELL);
    const t = tileAt(x, y);
    const [dx, dy] = rel(p.point, x, y);
    const city = canonCity(p.tags['addr:city']) ?? cityAt(p.point) ?? '';
    t.tile.p.push([dx, dy, idx(t.names, t.tile.n, nameOf(p.tags)!), idx(t.cities, t.tile.c, city), p.sid, `${p.cat.key}=${p.cat.value}`]);
  }
  for (const [k, t] of tiles) {
    const [x, y] = k.split('_').map(Number);
    write(revTileFile(x, y), t.tile);
  }

  const counts = {
    records: records.length,
    places: merged.length,
    streets: groups.size,
    addresses: addresses.length,
    pois: pois.length,
    names: nameList.length,
    searchShards: buckets.size,
    addrFiles: addrFiles.size,
    detailFiles: detFiles.size,
    reverseTiles: tiles.size,
  };
  const manifest: GeoManifest = {
    v: GEODATA_VERSION,
    region: region.geodata.id,
    built: opts.built,
    source: opts.source ?? region.geodata.extract,
    country: region.geodata.country,
    bbox: region.bbox ?? [-180, -90, 180, 90],
    split: [...split].sort(),
    shards: [...buckets.keys()].sort(),
    addrShards: addrN,
    detailShards: detN,
    revCell: REV_CELL,
    counts,
    bytes,
  };
  write('manifest.json', manifest);
  const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0);
  return { manifest, files, totalBytes };
}

export function regionById(id: string): Region & { geodata: RegionGeodata } {
  const r = REGIONS.find((x) => x.geodata?.id === id || x.id === id);
  if (!r?.geodata) throw new Error(`region "${id}" has no geodata entry in packages/core/src/region.ts`);
  return r as Region & { geodata: RegionGeodata };
}

async function* readLines(path: string): AsyncIterable<string> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const regionId = arg('region');
  const input = arg('input');
  const out = arg('out');
  if (!regionId || !input || !out) {
    console.error('usage: build.ts --region il --input export.geojsonseq --out dir [--built ISO] [--source URL]');
    process.exit(2);
  }
  const t0 = Date.now();
  const report = await buildGeodata(readLines(input), { region: regionById(regionId), out, built: arg('built') ?? new Date().toISOString(), source: arg('source') });
  console.log(JSON.stringify({ ...report.manifest.counts, files: report.files, totalMB: +(report.totalBytes / 1e6).toFixed(1), bytes: report.manifest.bytes, seconds: Math.round((Date.now() - t0) / 1000) }));
}
