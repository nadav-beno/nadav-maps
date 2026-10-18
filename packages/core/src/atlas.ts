/**
 * Atlas: Nadav's own traffic service. Measured road speeds (km/h) as vector tiles, today for
 * Hong Kong only (HK Transport Department speeds joined to official CSDI CENTERLINE geometry).
 * Off unless a publishable read key is configured (ATLAS_KEY / VITE_ATLAS_KEY); keys are bound to
 * the site's origin by Atlas. Contract: <atlasUrl>/openapi.json.
 *   GET /api/status                               public: freshness (server_time, stale_after), tiles_version, coverage
 *   GET /api/v1/tiles/flow/{z}/{x}/{y}.pbf?key&v  MVT, layer traffic_flow: segment_id, speed_kph (immutable per version;
 *                                                 its stale field is frozen false, freshness comes from status only)
 *   GET /api/v1/incidents?key&bbox                GeoJSON: official HK Transport Department traffic announcements
 * Atlas refreshes its source when it is read (v4), so a first read after a quiet spell may be stale.
 * Atlas has no free-flow speed or congestion level yet, so we colour by absolute speed and say so.
 */
import type { BBox, LngLat } from './types.ts';

export const ATLAS_FLOW_LAYER = 'traffic_flow';
export const ATLAS_MINZOOM = 8;
export const ATLAS_MAXZOOM = 17;
/** How often to re-read status while the page is visible (Atlas asks for about a minute). */
export const ATLAS_POLL_MS = 60_000;
/**
 * After a stale answer, ask again sooner (a few times): Atlas refreshes on read, so the read that found
 * it stale has usually started a refresh that the next read sees.
 */
export const ATLAS_STALE_REPOLL_MS = 15_000;
/** Official announcements change slowly and share the key's JSON quota with every user: every 5 minutes. */
export const ATLAS_INCIDENTS_POLL_MS = 5 * 60_000;

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
  /** Atlas's clock when it answered, epoch seconds: lets us hide on time whatever the device clock says. */
  serverTime: number | null;
  /** When this snapshot stops being fresh, epoch seconds on Atlas's clock. */
  staleAfter: number | null;
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
    serverTime: isNum(j.server_time) ? j.server_time : null,
    staleAfter: isNum(j.stale_after) ? j.stale_after : null,
  };
}

/**
 * How far Atlas's clock is ahead of ours (ms), from server_time and the request's start and end on our
 * clock: the server read its clock somewhere in between, so we take the midpoint.
 */
export function atlasClockOffset(serverTimeS: number, sentAt: number, receivedAt: number): number {
  return serverTimeS * 1000 - (sentAt + receivedAt) / 2;
}

/** When to hide this snapshot, on our clock (ms), or null when Atlas gave no stale_after. */
export function atlasHideAt(s: AtlasStatus, offsetMs: number): number | null {
  return s.staleAfter === null ? null : s.staleAfter * 1000 - offsetMs;
}

/** Atlas may be drawn only from a fresh, healthy snapshot with a version and a coverage area. */
export function atlasUsable(s: AtlasStatus | null): s is AtlasStatus & { tilesVersion: string; coverage: { bbox: BBox } } {
  return !!s && !s.stale && s.sourceStatus === 'ok' && !!s.tilesVersion && !!s.coverage;
}

const base = (url: string) => url.replace(/\/+$/, '');

export function atlasIncidentsUrl(url: string, key: string, bbox: BBox, limit = 500): string {
  const b = bbox.map((n) => +n.toFixed(5)).join(',');
  return `${base(url)}/api/v1/incidents?key=${encodeURIComponent(key)}&bbox=${b}&limit=${limit}`;
}

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

/** An official traffic announcement as Atlas relays it. Text is the source's own (English for Hong Kong). */
export type AtlasIncident = {
  id: string;
  /** Our incident category number (INCIDENT_CATEGORIES in tomtom.ts), guessed from the source heading. */
  category: number;
  heading: string;
  description: string;
  location: string;
  direction: string;
  /** When it was announced (ISO), not when it started: the source has no start or end. */
  announcedAt: string | null;
  at: LngLat;
};

/** The source heading to our category: only clear words count, anything else stays a general incident. */
export function atlasIncidentCategory(heading: string): number {
  const h = heading.toLowerCase();
  if (/accident|collision|crash/.test(h)) return 1;
  if (/clos/.test(h)) return /lane/.test(h) ? 7 : 8;
  if (/road ?works?|construction|maintenance/.test(h)) return 9;
  if (/congest|queue|heavy traffic/.test(h)) return 6;
  if (/broken|breakdown|vehicle fault/.test(h)) return 14;
  if (/flood/.test(h)) return 11;
  return 0;
}

const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const isPoint = (c: unknown): c is LngLat => Array.isArray(c) && c.length >= 2 && isNum(c[0]) && isNum(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

/**
 * Validates /api/v1/incidents. Only located, open announcements are kept (a bbox query has no others);
 * unlocated is how many Atlas said it left out for lack of a location.
 */
export function parseAtlasIncidents(json: unknown): { incidents: AtlasIncident[]; unlocated: number } | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { features?: unknown; unlocated_count?: unknown };
  if (!Array.isArray(j.features)) return null;
  const incidents: AtlasIncident[] = [];
  for (const f of j.features as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[]) {
    const p = f?.properties ?? {};
    const g = f?.geometry;
    const at = g?.type === 'Point' ? g.coordinates : g?.type === 'LineString' || g?.type === 'MultiPoint' ? (g.coordinates as unknown[])?.[0] : undefined;
    const id = str(p.incident_id);
    if (!isPoint(at) || !id || p.status === 'closed') continue;
    const heading = str(p.type);
    incidents.push({
      id,
      category: atlasIncidentCategory(heading),
      heading,
      description: str(p.description),
      location: str(p.location_description),
      direction: str(p.direction_description),
      announcedAt: typeof p.announced_at === 'string' && !Number.isNaN(Date.parse(p.announced_at)) ? p.announced_at : null,
      at: [at[0], at[1]],
    });
  }
  return { incidents, unlocated: isNum(j.unlocated_count) ? j.unlocated_count : 0 };
}
