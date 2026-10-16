/**
 * Our own static geodata (built weekly from OpenStreetMap by scripts/geodata, served with the site):
 * search, addresses, reverse geocoding, place details and map-label identification without any
 * third-party server. Used first wherever region.ts says a region has `geodata`; the tools fall back
 * to Photon / Overpass when this returns undefined (no data, a miss, or an error).
 */
import {
  addressPlace,
  addrShardOf,
  cellOrigin,
  cellsAround,
  DEFAULT_REGION,
  detailShardOf,
  GEODATA_VERSION,
  isHebrew,
  keyTokens,
  normHouse,
  parseHouseQuery,
  queryInfo,
  queryVariants,
  rankRecords,
  recordToPlace,
  REGIONS,
  regionAt,
  reverseLookup,
  revTileFile,
  searchKey,
  shardFile,
  shardPrefix,
  type AddressShard,
  type BBox,
  type DetailShard,
  type GeoManifest,
  type LngLat,
  type OsmType,
  type Place,
  type PlaceDetails,
  type PlaceRecord,
  type Region,
  type RegionGeodata,
  type ReverseTile,
  type SearchRecord,
} from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';
import { elementToDetails } from './overpass.ts';

interface Dataset {
  base: string;
  manifest: GeoManifest;
  split: Set<string>;
  shards: Set<string>;
}

const MANIFEST_TTL = 10 * 60_000;
const FAILURE_TTL = 2 * 60_000;
const datasets = new Map<string, { at: number; ttl: number; value: Promise<Dataset | null> }>();
const files = new Map<string, Promise<unknown>>();
const MAX_FILES = 150;

/** For tests: forget cached manifests and files. */
export function resetLocalGeo(): void {
  datasets.clear();
  files.clear();
}

function datasetBase(ctx: ToolContext, geo: RegionGeodata): string | null {
  if (!ctx.config.geodataUrl) return null;
  try {
    const here = (globalThis as { location?: { href: string } }).location?.href;
    return new URL(`${geo.id}/`, new URL(ctx.config.geodataUrl, here)).toString();
  } catch {
    return null; // a relative URL on the server: misconfigured, act as off
  }
}

/** Fetch JSON without the caller's abort signal (results are shared); null on 404. */
async function fetchJson<T>(ctx: ToolContext, url: string): Promise<T | null> {
  try {
    return await getJson<T>({ ...ctx, signal: undefined }, url, {}, 'geodata', 8000);
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return null;
    throw e;
  }
}

async function dataset(ctx: ToolContext, geo: RegionGeodata): Promise<Dataset | null> {
  const base = datasetBase(ctx, geo);
  if (!base) return null;
  const hit = datasets.get(base);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = fetchJson<GeoManifest>(ctx, `${base}manifest.json`)
    .then((m) => {
      if (!m || m.v !== GEODATA_VERSION || !Array.isArray(m.shards)) return null;
      return { base, manifest: m, split: new Set(m.split), shards: new Set(m.shards) };
    })
    .catch(() => null);
  const entry = { at: Date.now(), ttl: MANIFEST_TTL, value };
  datasets.set(base, entry);
  value.then((d) => {
    if (!d) entry.ttl = FAILURE_TTL;
  });
  return value;
}

function file<T>(ctx: ToolContext, ds: Dataset, rel: string): Promise<T | null> {
  const url = `${ds.base}${rel}?v=${encodeURIComponent(ds.manifest.built)}`;
  let p = files.get(url) as Promise<T | null> | undefined;
  if (!p) {
    p = fetchJson<T>(ctx, url);
    files.set(url, p);
    p.catch(() => files.delete(url));
    if (files.size > MAX_FILES) files.delete(files.keys().next().value!);
  }
  return p;
}

const SETTLEMENTS = new Set(['region', 'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood']);

type GeoRegion = Region & { geodata: RegionGeodata };

function regionFor(opts: { near?: LngLat; bbox?: BBox }): GeoRegion | null {
  const at: LngLat | undefined = opts.near ?? (opts.bbox ? [(opts.bbox[0] + opts.bbox[2]) / 2, (opts.bbox[1] + opts.bbox[3]) / 2] : undefined);
  const r = at ? regionAt(at) : DEFAULT_REGION;
  return r.geodata ? (r as GeoRegion) : null;
}

// ---------------------------------------------------------------- search

export interface LocalSearchResult {
  places: Place[];
  /** Good enough to answer without asking Photon. */
  strong: boolean;
  /** Matches to keep above Photon's results when Photon is asked too: settlements and exact names. */
  top: Place[];
}

async function records(ctx: ToolContext, ds: Dataset, tokens: string[]): Promise<SearchRecord[] | null> {
  // Every record sits in the shard of each of its words, so one query word's shard holds every
  // candidate; we read two (first and longest word) to tolerate one word matching only the city.
  const usable = tokens.filter((t) => [...t].length >= 2);
  if (!usable.length) return null;
  const picks = [...new Set([usable[0], usable.reduce((a, b) => ([...b].length > [...a].length ? b : a))])];
  // A missing shard means no name has that word (or, for "<prefix>$", that the word typed so far
  // ends inside a split prefix, like "קפ" when "קפ" was split): nothing to read for it.
  const known = [...new Set(picks.map((t) => shardPrefix(t, ds.split)))].filter((p) => ds.shards.has(p));
  if (!known.length) return [];
  const lists = await Promise.all(known.map((p) => file<SearchRecord[]>(ctx, ds, shardFile(p))));
  return lists.flatMap((l) => l ?? []);
}

async function resolveAddresses(ctx: ToolContext, ds: Dataset, streets: SearchRecord[], house: string, lang: string): Promise<Place[]> {
  const want = normHouse(house);
  const out: Place[] = [];
  for (const s of streets) {
    if (!s.a) continue;
    const shard = await file<AddressShard>(ctx, ds, addrShardOf(s.a, ds.manifest.addrShards));
    const list = shard?.[s.a];
    if (!list?.length) continue;
    const name = recordToPlace(s, lang, ds.manifest.country).name;
    const exact = list.find(([n]) => normHouse(n) === want);
    if (exact) {
      out.push(addressPlace(name, house, s.c, [exact[1] / 1e5, exact[2] / 1e5], ds.manifest.country));
      continue;
    }
    // Like Google: no such number mapped, take the closest one on the same side of the street.
    const n = parseInt(want, 10);
    let best: [string, number, number] | undefined;
    for (const e of list) {
      const m = parseInt(e[0], 10);
      if (Number.isNaN(m) || m % 2 !== n % 2 || Math.abs(m - n) > 6) continue;
      if (!best || Math.abs(m - n) < Math.abs(parseInt(best[0], 10) - n)) best = e;
    }
    if (best) out.push(addressPlace(name, house, s.c, [best[1] / 1e5, best[2] / 1e5], ds.manifest.country));
  }
  return out;
}

async function searchOnce(
  ctx: ToolContext,
  ds: Dataset,
  query: string,
  opts: { near?: LngLat; zoom?: number; limit?: number; bbox?: BBox },
): Promise<LocalSearchResult | null> {
  const q = queryInfo(query);
  if (q.key.replace(/\s/g, '').length < 2) return null;
  const house = parseHouseQuery(q.key);
  const tokens = house.number && house.rest.length ? house.rest : q.tokens;
  const recs = await records(ctx, ds, tokens);
  if (!recs) return null;
  const sub = { key: tokens.join(' '), tokens };
  const ranked = rankRecords(recs, sub, opts);
  const places: Place[] = [];
  let addressHit = false;
  if (house.number && house.rest.length) {
    const streets = ranked.filter((r) => r.rec.k === 'street' && r.rec.a).slice(0, 3).map((r) => r.rec);
    const found = await resolveAddresses(ctx, ds, streets, house.number, ctx.lang);
    addressHit = found.length > 0;
    places.push(...found);
  }
  const top: Place[] = [...places];
  for (const r of ranked) {
    const p = recordToPlace(r.rec, ctx.lang, ds.manifest.country);
    places.push(p);
    const exactName = [r.rec.n, r.rec.he, r.rec.en, r.rec.ar].some((n) => n && searchKey(n) === sub.key);
    if (r.complete && (exactName || SETTLEMENTS.has(r.rec.k))) top.push(p);
  }
  const seen = new Set<string>();
  const unique = places.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  // Hebrew (and Arabic) queries: our data is the whole country, so a complete match is the answer.
  // Latin-script queries are often foreign places ("Paris"), so Photon is still asked.
  const local = isHebrew(query) || /[؀-ۿ]/.test(query);
  const strong = addressHit || (local && !!ranked[0]?.complete);
  return { places: unique.slice(0, opts.limit ?? 8), strong, top: top.slice(0, 3) };
}

/** Search our own data; undefined when this region has none (or it failed). */
export async function localgeoSearch(
  ctx: ToolContext,
  query: string,
  opts: { near?: LngLat; zoom?: number; limit?: number; bbox?: BBox } = {},
): Promise<LocalSearchResult | undefined> {
  const region = regionFor(opts);
  if (!region) return undefined;
  const ds = await dataset(ctx, region.geodata);
  if (!ds) return undefined;
  try {
    let best = await searchOnce(ctx, ds, query, opts);
    if (best?.strong) return best;
    // Glued prefixes ("בתל אביב") and connector words ("ליד"): try the same variants as for Photon.
    for (const v of queryVariants(query)) {
      const r = await searchOnce(ctx, ds, v, opts);
      if (!r) continue;
      if (r.strong) return r;
      if (!best || r.places.length > best.places.length) best = r;
    }
    return best ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * URL of the region's names list (spell-correction dictionary), when this region has our
 * geodata and its manifest loaded. Null otherwise, so nothing is fetched in vain.
 */
export async function localgeoNamesUrl(ctx: ToolContext, opts: { near?: LngLat; bbox?: BBox } = {}): Promise<string | null> {
  const region = regionFor(opts);
  if (!region) return null;
  const ds = await dataset(ctx, region.geodata);
  return ds ? `${ds.base}names.json` : null;
}

/** Local results first, then the remote ones that aren't the same place again. */
export function mergePlaces(first: Place[], then: Place[]): Place[] {
  const out = [...first];
  for (const p of then) {
    const dup = out.some((o) => o.id === p.id || (o.name === p.name && Math.abs(o.lng - p.lng) < 0.003 && Math.abs(o.lat - p.lat) < 0.003));
    if (!dup) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- reverse, details, identify

async function tilesAround(ctx: ToolContext, ds: Dataset, lng: number, lat: number) {
  const cell = ds.manifest.revCell;
  const cells = cellsAround(lng, lat, cell);
  return (
    await Promise.all(
      cells.map(async ([x, y]) => {
        const tile = await file<ReverseTile>(ctx, ds, revTileFile(x, y));
        return tile ? { x, y, tile } : null;
      }),
    )
  ).filter((t): t is { x: number; y: number; tile: ReverseTile } => !!t);
}

/** What is at this point, from our data; undefined = ask Photon. */
export async function localgeoReverse(ctx: ToolContext, lng: number, lat: number): Promise<Place | undefined> {
  const region = regionAt([lng, lat]);
  if (!region.geodata) return undefined;
  const ds = await dataset(ctx, region.geodata);
  if (!ds) return undefined;
  try {
    const [tiles, places] = await Promise.all([tilesAround(ctx, ds, lng, lat), file<PlaceRecord[]>(ctx, ds, 'places.json')]);
    return reverseLookup([lng, lat], tiles, ds.manifest.revCell, places ?? [], ds.manifest.country)?.place;
  } catch {
    return undefined;
  }
}

/** Place details by OSM id from our data; undefined = not in our data (ask Overpass). */
export async function localgeoDetails(ctx: ToolContext, type: OsmType, id: number): Promise<PlaceDetails | undefined> {
  const sid = `${type[0]}${id}`;
  for (const region of REGIONS) {
    if (!region.geodata) continue;
    const ds = await dataset(ctx, region.geodata);
    if (!ds) continue;
    try {
      const shard = await file<DetailShard>(ctx, ds, detailShardOf(sid, ds.manifest.detailShards));
      const rec = shard?.[sid];
      if (!rec) continue;
      const d = elementToDetails({ type, id, lat: rec.l[1], lon: rec.l[0], tags: rec.t }, ctx.lang);
      if (!d) continue;
      if (rec.c && !rec.t['addr:city']) d.address = d.address ? `${d.address}, ${rec.c}` : rec.c;
      d.countryCode = ds.manifest.country;
      return d;
    } catch {
      /* try the next region, then Overpass */
    }
  }
  return undefined;
}

/**
 * The OSM object behind a label tapped on the map (name + position). null = we know there is no
 * such object (the name is an address or street from our own reverse geocoding); undefined = ask Overpass.
 */
export async function localgeoIdentify(ctx: ToolContext, name: string, lng: number, lat: number): Promise<PlaceDetails | null | undefined> {
  const region = regionAt([lng, lat]);
  if (!region.geodata) return undefined;
  const ds = await dataset(ctx, region.geodata);
  if (!ds) return undefined;
  try {
    const key = searchKey(name);
    const tiles = await tilesAround(ctx, ds, lng, lat);
    let best: { id: string; m: number } | undefined;
    for (const { x, y, tile } of tiles) {
      const [ox, oy] = cellOrigin(x, y, ds.manifest.revCell);
      for (const [dx, dy, ni, , id] of tile.p) {
        if (!id || searchKey(tile.n[ni]) !== key) continue;
        const px = ox + dx / 1e5, py = oy + dy / 1e5;
        const m = Math.hypot((px - lng) * 94_000, (py - lat) * 110_600);
        if (m <= 80 && (!best || m < best.m)) best = { id, m };
      }
    }
    if (best) {
      const osm = /^([nwr])(\d+)$/.exec(best.id);
      if (osm) {
        const type: OsmType = osm[1] === 'n' ? 'node' : osm[1] === 'w' ? 'way' : 'relation';
        const d = await localgeoDetails(ctx, type, Number(osm[2]));
        if (d) return d;
      }
    }
    // Our own reverse geocoding names pins "<street> <number>" or "<street>": nothing to identify.
    const words = keyTokens(key);
    const streetPart = /^\d/.test(words[words.length - 1] ?? '') ? words.slice(0, -1).join(' ') : key;
    for (const { tile } of tiles) if (tile.n.some((n) => searchKey(n) === streetPart)) return null;
    return undefined;
  } catch {
    return undefined;
  }
}
