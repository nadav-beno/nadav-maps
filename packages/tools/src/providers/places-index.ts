/**
 * Our own places search index (packages/core/src/places-index.ts), served with the site next to
 * places.pmtiles at <geodata>/<region>/places-search/. Finds businesses anywhere in a region with
 * our data, not only in the map tiles that happen to be loaded. Undefined where there is none.
 */
import {
  PLACES_INDEX_DIR,
  PLACES_INDEX_VERSION,
  placesQueryShard,
  placesShardFile,
  regionAt,
  searchPlacesShard,
  DEFAULT_REGION,
  type LngLat,
  type Place,
  type PlacesIndexShard,
} from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

interface IndexList {
  v: number;
  built: string;
  shards: string[];
}

const LIST_TTL = 10 * 60_000;
const FAILURE_TTL = 2 * 60_000;
const lists = new Map<string, { at: number; ttl: number; value: Promise<{ built: string; shards: Set<string> } | null> }>();
const shards = new Map<string, Promise<PlacesIndexShard | null>>();
const MAX_SHARDS = 40;

/** For tests: forget cached lists and shards. */
export function resetPlacesIndex(): void {
  lists.clear();
  shards.clear();
}

function baseFor(ctx: ToolContext, near?: LngLat): string | null {
  const region = near ? regionAt(near) : DEFAULT_REGION;
  if (!region.geodata || !ctx.config.geodataUrl) return null;
  try {
    const here = (globalThis as { location?: { href: string } }).location?.href;
    return new URL(`${region.geodata.id}/${PLACES_INDEX_DIR}/`, new URL(ctx.config.geodataUrl, here)).toString();
  } catch {
    return null;
  }
}

async function fetchJson<T>(ctx: ToolContext, url: string): Promise<T | null> {
  try {
    return await getJson<T>({ ...ctx, signal: undefined }, url, {}, 'places-index', 8000);
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return null;
    throw e;
  }
}

function list(ctx: ToolContext, base: string) {
  const hit = lists.get(base);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = fetchJson<IndexList>(ctx, `${base}index.json`)
    .then((l) => (l && l.v === PLACES_INDEX_VERSION && Array.isArray(l.shards) ? { built: l.built, shards: new Set(l.shards) } : null))
    .catch(() => null);
  const entry = { at: Date.now(), ttl: LIST_TTL, value };
  lists.set(base, entry);
  value.then((l) => {
    if (!l) entry.ttl = FAILURE_TTL;
  });
  return value;
}

function shard(ctx: ToolContext, url: string): Promise<PlacesIndexShard | null> {
  let p = shards.get(url);
  if (!p) {
    p = fetchJson<PlacesIndexShard>(ctx, url).catch(() => null);
    shards.set(url, p);
    p.then((s) => !s && shards.delete(url));
    if (shards.size > MAX_SHARDS) shards.delete(shards.keys().next().value!);
  }
  return p;
}

/** Businesses whose name starts like `query`, nearest and best matching first; undefined when this region has no index. */
export async function placesIndexSearch(ctx: ToolContext, query: string, opts: { near?: LngLat; limit?: number } = {}): Promise<Place[] | undefined> {
  const base = baseFor(ctx, opts.near);
  if (!base) return undefined;
  const l = await list(ctx, base);
  if (!l) return undefined;
  const key = placesQueryShard(query, l.shards);
  if (!key) return [];
  const s = await shard(ctx, `${base}${placesShardFile(key)}?v=${encodeURIComponent(l.built)}`);
  return s ? searchPlacesShard(s, query, opts.near, opts.limit ?? 10) : [];
}
