import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

/**
 * Atlas (Nadav's traffic service) answered offline from the fixtures Atlas ships with its source:
 *   atlas/flow-real.json   one archived real observation (HK segment 103495, 64.5 km/h) with its
 *                          official CENTERLINE geometry, encoded here as a fresh MVT tile;
 *   atlas/traffic-flow-14-13389-7148.pbf   a real tile Atlas served, whose feature is stale=true
 *                          (v3; since v4 tiles always say false, but browsers may still hold old ones);
 *   atlas/incidents.json   an incidents answer in the v4 GeoJSON shape. Written by us from the documented
 *                          fields (the live feed had no located announcement), not a real announcement.
 * Statuses follow the v4 shape (server_time, stale_after). The sandbox that wrote these tests cannot
 * reach Atlas, so Atlas's own v4 fixture pack (<atlas>/fixtures/v4/manifest.json) is not copied here.
 * Only the key "test" is accepted, like the other providers' stubs.
 */
export const ATLAS = 'https://atlas-traffic-command.nadav747710.chatgpt.site';
const dir = join(import.meta.dirname, 'atlas');
const FLOW = JSON.parse(readFileSync(join(dir, 'flow-real.json'), 'utf8'));
export const STALE_TILE = readFileSync(join(dir, 'traffic-flow-14-13389-7148.pbf'));
export const INCIDENTS = JSON.parse(readFileSync(join(dir, 'incidents.json'), 'utf8'));
/** Where the fixture segment is (Kowloon). */
export const SEGMENT_AT: [number, number] = [114.2038, 22.3408];

const index = new geojsonvt(FLOW, { maxZoom: 17, indexMaxZoom: 5, extent: 4096, buffer: 64 });
function freshTile(z: number, x: number, y: number): Buffer {
  const t = index.getTile(z, x, y);
  // Atlas answers an empty tile with a zero-length Tile message (no layers).
  return Buffer.from(vtpbf.fromGeojsonVt(t ? { traffic_flow: t } : {}, { version: 2 }));
}

/**
 * A v4 status like the one Atlas publishes, fresh for freshS seconds. aheadS sets Atlas's clock ahead
 * of the device's, to check that hiding follows server_time and not the device clock.
 */
export function atlasStatus(over: Record<string, unknown> = {}, { freshS = 600, aheadS = 0 } = {}) {
  const version = (over.tiles_version as string | undefined) ?? 'v1';
  const now = Math.floor(Date.now() / 1000) + aheadS;
  return {
    stale: false,
    observed_at: now - 120,
    server_time: now,
    stale_after: now + freshS,
    tiles_stale_policy: 'status_only',
    tiles_version: version,
    coverage: { bbox: [113.85, 22.23, 114.29, 22.55], kind: 'matched_road_segments', geojson_url: `${ATLAS}/api/v1/coverage.geojson?v=${version}` },
    source_status: 'ok',
    last_success_at: new Date().toISOString(),
    last_error_at: null,
    scheduler: { status: 'refresh_on_read', continuous_when_idle: false, target_interval_seconds: 120 },
    matched_segments: 1,
    unmatched_segments: 0,
    redistribution_status: 'permitted_with_attribution_under_data_gov_hk_terms',
    terms_url: 'https://data.gov.hk/en/terms-and-conditions',
    attribution: 'Traffic speeds and road geometry: Transport Department, Government of the Hong Kong SAR; DATA.GOV.HK and CSDI Portal.',
    ...over,
  };
}

export interface AtlasStub {
  /** What /api/status answers next: a status object, one made at read time, or an HTTP status number. */
  status: Record<string, unknown> | (() => Record<string, unknown>) | number;
  /** 'fresh' encodes flow-real.json, 'stale' serves the real stale tile, a number is an HTTP error. */
  tiles: 'fresh' | 'stale' | number;
  /** What /api/v1/incidents answers (defaults to no announcements). */
  incidents?: Record<string, unknown> | number;
  /** Paths and queries Atlas was asked for (status and tiles). */
  requests: { path: string; key: string | null; v: string | null; bbox: string | null; credentials: boolean }[];
}

export async function stubAtlas(page: Page, stub: Omit<AtlasStub, 'requests'>): Promise<AtlasStub> {
  const s: AtlasStub = { ...stub, requests: [] };
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, Retry-After, X-Atlas-Tiles-Version' };
  await page.route(`${ATLAS}/**`, (r) => {
    const url = new URL(r.request().url());
    s.requests.push({ path: url.pathname, key: url.searchParams.get('key'), v: url.searchParams.get('v'), bbox: url.searchParams.get('bbox'), credentials: !!r.request().headers().cookie });
    if (url.pathname === '/api/status') {
      return typeof s.status === 'number'
        ? r.fulfill({ status: s.status, json: { error: { code: 'unavailable', message: 'test' } }, headers: { ...cors, 'retry-after': '1' } })
        : r.fulfill({ json: typeof s.status === 'function' ? s.status() : s.status, headers: cors });
    }
    if (url.pathname === '/api/v1/incidents') {
      if (url.searchParams.get('key') !== 'test') return r.fulfill({ status: 401, json: { error: { code: 'invalid_key', message: 'test' } }, headers: cors });
      const inc = s.incidents ?? { type: 'FeatureCollection', features: [], unlocated_count: 0 };
      return typeof inc === 'number'
        ? r.fulfill({ status: inc, json: { error: { code: 'unavailable', message: 'test' } }, headers: { ...cors, 'retry-after': '15' } })
        : r.fulfill({ json: inc, contentType: 'application/geo+json', headers: cors });
    }
    const tile = /^\/api\/v1\/tiles\/flow\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
    if (tile) {
      if (url.searchParams.get('key') !== 'test') return r.fulfill({ status: 401, json: { error: { code: 'invalid_key', message: 'test' } }, headers: cors });
      if (typeof s.tiles === 'number') return r.fulfill({ status: s.tiles, json: { error: { code: 'error', message: 'test' } }, headers: cors });
      const [z, x, y] = [+tile[1], +tile[2], +tile[3]];
      const body = s.tiles === 'stale' ? (z === 14 && x === 13389 && y === 7148 ? STALE_TILE : Buffer.alloc(0)) : freshTile(z, x, y);
      return r.fulfill({ body, contentType: 'application/vnd.mapbox-vector-tile', headers: cors });
    }
    return r.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'test' } }, headers: cors });
  });
  return s;
}
