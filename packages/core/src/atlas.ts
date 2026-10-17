/**
 * Atlas: Nadav's own traffic service. Measured road speeds (km/h) as vector tiles, today for
 * Hong Kong only (HK Transport Department speeds joined to official CSDI CENTERLINE geometry).
 * Off unless a publishable read key is configured (ATLAS_KEY / VITE_ATLAS_KEY); keys are bound to
 * the site's origin by Atlas. Contract: <atlasUrl>/openapi.json.
 *   GET /api/status                               public: freshness, tiles_version, coverage, attribution
 *   GET /api/v1/tiles/flow/{z}/{x}/{y}.pbf?key&v  MVT, layer traffic_flow: segment_id, speed_kph, observed_at, stale
 * Atlas has no free-flow speed or congestion level, so we colour by absolute speed and say so.
 */
import type { BBox, LngLat } from './types.ts';

export const ATLAS_FLOW_LAYER = 'traffic_flow';
export const ATLAS_MINZOOM = 8;
export const ATLAS_MAXZOOM = 17;
/** How often to re-read status while the page is visible (Atlas asks for about a minute). */
export const ATLAS_POLL_MS = 60_000;

export type AtlasSourceStatus = 'ok' | 'stale' | 'error' | 'unavailable';

export interface AtlasStatus {
  stale: boolean;
  /** Source observation time, epoch seconds (not when Atlas downloaded it). */
  observedAt: number | null;
  tilesVersion: string | null;
  coverage: { bbox: BBox } | null;
  sourceStatus: AtlasSourceStatus;
  attribution: string;
  termsUrl: string;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Validates /api/status. Anything malformed yields null, which the app treats as "unavailable". */
export function parseAtlasStatus(json: unknown): AtlasStatus | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  const statuses: AtlasSourceStatus[] = ['ok', 'stale', 'error', 'unavailable'];
  if (typeof j.stale !== 'boolean' || !statuses.includes(j.source_status as AtlasSourceStatus)) return null;
  const bbox = (j.coverage as { bbox?: unknown } | null | undefined)?.bbox;
  const okBbox = Array.isArray(bbox) && bbox.length === 4 && bbox.every(isNum) && bbox[0] < bbox[2] && bbox[1] < bbox[3];
  const version = typeof j.tiles_version === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(j.tiles_version) ? j.tiles_version : null;
  return {
    stale: j.stale,
    observedAt: isNum(j.observed_at) ? j.observed_at : null,
    tilesVersion: version,
    coverage: okBbox ? { bbox: bbox as BBox } : null,
    sourceStatus: j.source_status as AtlasSourceStatus,
    attribution: typeof j.attribution === 'string' ? j.attribution : '',
    termsUrl: typeof j.terms_url === 'string' && /^https:\/\//.test(j.terms_url) ? j.terms_url : '',
  };
}

/** Atlas may be drawn only from a fresh, healthy snapshot with a version and a coverage area. */
export function atlasUsable(s: AtlasStatus | null): s is AtlasStatus & { tilesVersion: string; coverage: { bbox: BBox } } {
  return !!s && !s.stale && s.sourceStatus === 'ok' && !!s.tilesVersion && !!s.coverage;
}

const base = (url: string) => url.replace(/\/+$/, '');

export function atlasStatusUrl(url: string): string {
  return `${base(url)}/api/status`;
}

export function atlasFlowTiles(url: string, key: string, version: string): string {
  return `${base(url)}/api/v1/tiles/flow/{z}/{x}/{y}.pbf?key=${encodeURIComponent(key)}&v=${encodeURIComponent(version)}`;
}

/** The coverage box overlaps what is on screen. Inside it a tile may still be empty, which is normal. */
export function atlasCovers(s: AtlasStatus, view: BBox): boolean {
  const c = s.coverage?.bbox;
  return !!c && view[0] <= c[2] && view[2] >= c[0] && view[1] <= c[3] && view[3] >= c[1];
}

export function atlasCoversPoint(s: AtlasStatus, p: LngLat): boolean {
  return atlasCovers(s, [p[0], p[1], p[0], p[1]]);
}

/**
 * Speed bands for the legend and the line colour, slowest first. A sequential palette rather than
 * green/red: 30 km/h is normal on a city street and a jam on a highway, and Atlas has no baseline.
 */
export const ATLAS_SPEED_BANDS: { from: number; color: string }[] = [
  { from: 0, color: '#3f007d' },
  { from: 20, color: '#54278f' },
  { from: 40, color: '#2171b5' },
  { from: 60, color: '#1d91c0' },
  { from: 80, color: '#41b6c4' },
];

/**
 * How long to wait before asking again after a failed request: Retry-After (seconds) when the server
 * sends one, otherwise exponential backoff, capped at 15 minutes, plus up to 20% jitter.
 */
export function atlasRetryDelay(attempt: number, retryAfter: string | null, rand = Math.random): number {
  const ra = retryAfter !== null ? Number(retryAfter) : NaN;
  const baseMs = Number.isFinite(ra) && ra >= 0 ? ra * 1000 : Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempt));
  return Math.round(baseMs * (1 + 0.2 * rand()));
}
