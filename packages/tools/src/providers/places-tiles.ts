/**
 * Category search ("restaurants here") from our own places tiles (scripts/places,
 * <geodata>/<region>/places.pmtiles), read with HTTP range requests like the map does.
 * Same-origin static files, so it answers in well under a second, where the public Overpass
 * server is often overloaded and leaves the results screen loading. Undefined where the
 * region has no tiles of ours, so the caller falls back to Overpass.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { distance, overturePlace, regionAt, type BBox, type LngLat, type Place } from '@nm/core';
import type { ToolContext } from '../define.ts';

/**
 * Every place is in the archive's deepest tiles (z15 for ours: lower zooms keep only the
 * prominent ones). A z15 tile is ~1 km wide here: the nearest 25 cover ~2.5 km around the centre.
 */
const MAX_TILES = 25;

/** Range reads through the tool context's fetch (stubbed in tests, relayed nowhere). */
class CtxSource implements Source {
  constructor(
    private url: string,
    private ctx: ToolContext,
  ) {}
  getKey(): string {
    return this.url;
  }
  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    const res = await this.ctx.fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal });
    if (!res.ok) throw new Error(`places tiles ${res.status}`);
    const data = await res.arrayBuffer();
    // A server that ignores Range sends the whole file.
    if (res.status === 200 && data.byteLength > length) return { data: data.slice(offset, offset + length) };
    return { data, etag: res.headers.get('etag') ?? undefined };
  }
}

type Archive = { tiles: PMTiles; z: number };

const archives = new Map<string, Promise<Archive | null>>();

/** For tests: forget opened archives. */
export function resetPlacesTiles(): void {
  archives.clear();
}

function archiveFor(ctx: ToolContext, at: LngLat): Promise<Archive | null> | null {
  const region = regionAt(at);
  if (!region.geodata || !ctx.config.geodataUrl) return null;
  let url: string;
  try {
    const here = (globalThis as { location?: { href: string } }).location?.href;
    url = new URL(`${region.geodata.id}/places.pmtiles`, new URL(ctx.config.geodataUrl, here)).toString();
  } catch {
    return null;
  }
  let a = archives.get(url);
  if (!a) {
    const p = new PMTiles(new CtxSource(url, ctx));
    // Reading the header tells us whether the file is there at all (404 -> null, Overpass instead).
    a = p.getHeader().then(
      (h) => ({ tiles: p, z: Math.min(h.maxZoom, 15) }),
      () => null,
    );
    archives.set(url, a);
    // Not there (yet): ask again in a few minutes rather than for every search.
    a.then((v) => !v && setTimeout(() => archives.delete(url), 120_000));
  }
  return a;
}

/** The tiles at zoom `z` of the box, nearest to `center` first, at most `max`. */
export function tilesFor(bbox: BBox, center: LngLat, z: number, max = MAX_TILES): [number, number][] {
  const tileX = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
  const tileY = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  const [w, s, e, n] = bbox;
  const cx = tileX(center[0]);
  const cy = tileY(center[1]);
  const out: [number, number][] = [];
  const x0 = tileX(w);
  const x1 = tileX(e);
  const y0 = tileY(n);
  const y1 = tileY(s);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  return out.slice(0, max);
}

/**
 * Places of the given Overture categories in `bbox`, nearest to `center` first. Undefined when
 * this region has no places tiles of ours.
 */
export async function placesTilesCategory(
  ctx: ToolContext,
  categories: string[],
  bbox: BBox,
  center: LngLat,
  limit = 60,
): Promise<Place[] | undefined> {
  const archive = await archiveFor(ctx, center);
  if (!archive) return undefined;
  const want = new Set(categories);
  const [w, s, e, n] = bbox;
  const seen = new Set<string>();
  const found: Place[] = [];
  await Promise.all(
    tilesFor(bbox, center, archive.z).map(async ([x, y]) => {
      const tile = await archive.tiles.getZxy(archive.z, x, y, ctx.signal);
      if (!tile?.data) return;
      const layer = new VectorTile(new Pbf(new Uint8Array(tile.data))).layers.place;
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const props = f.properties as Record<string, unknown>;
        if (!want.has(String(props.basic_category ?? ''))) continue;
        if (props.operating_status && props.operating_status !== 'open') continue;
        const id = String(props.id ?? '');
        if (!id || seen.has(id)) continue;
        const g = f.toGeoJSON(x, y, archive.z).geometry;
        if (g.type !== 'Point') continue;
        const [lng, lat] = g.coordinates;
        if (lng < w || lng > e || lat < s || lat > n) continue;
        const p = overturePlace(props, lng, lat);
        if (!p.name) continue;
        seen.add(id);
        found.push(p);
      }
    }),
  );
  return found.sort((a, b) => distance(center, [a.lng, a.lat]) - distance(center, [b.lng, b.lat])).slice(0, limit);
}
