/**
 * HERE traffic (live flow, incidents, traffic-aware car times). Off unless a key is configured
 * (HERE_KEY / VITE_HERE_KEY). Used where TomTom has no live traffic (Israel), see trafficProvider().
 *   Traffic Vector Tile API v2: https://docs.here.com/traffic-api/docs/get-started-with-traffic-vector-tile
 *   Tile layers and fields:     https://docs.here.com/traffic-api/docs/traffic-vector-tile-layers
 *   Traffic API v7 incidents:   https://docs.here.com/traffic-api/reference/traffic-api-v7-getincidents
 *   Routing API v8:             https://docs.here.com/routing/reference/routing-api-v8-calculateroutes
 * We draw flow from the vector tiles (our own Google-like colours, under our labels, readable in
 * dark mode). The raster alternative is Traffic Raster Tile API v3,
 * https://traffic.maps.hereapi.com/v3/flow/mc/{z}/{x}/{y}/png?style=explore.day, with HERE's colours.
 */
import type { BBox, LngLat } from './types.ts';

export const HERE_TRAFFIC_TILES_API = 'https://traffic.vector.hereapi.com/v2';
export const HERE_TRAFFIC_API = 'https://data.traffic.hereapi.com/v7';
export const HERE_ROUTER_API = 'https://router.hereapi.com/v8';

/** HERE asks for "© <year> HERE" wherever its data is shown. */
export function hereAttribution(year = new Date().getFullYear()): string {
  return `תנועה © ${year} <a href="https://www.here.com" target="_blank" rel="noopener noreferrer">HERE</a>`;
}

/**
 * One vector tile source with all three traffic layers ("traffic" = flow + incidents), zoom 1..17:
 * traffic_flow (lines), traffic_incidents (lines), incident_icons (points).
 */
export function hereTrafficTiles(key: string): string {
  return `${HERE_TRAFFIC_TILES_API}/traffictiles/traffic/mc/{z}/{x}/{y}/omv?apiKey=${encodeURIComponent(key)}`;
}

export const HERE_FLOW_LAYER = 'traffic_flow';
export const HERE_INCIDENT_LINE_LAYER = 'traffic_incidents';
export const HERE_INCIDENT_ICON_LAYER = 'incident_icons';

/**
 * HERE incident type (v7 camelCase, tiles snake_case) to our incident category number
 * (the TomTom-numbered INCIDENT_CATEGORIES in tomtom.ts, which the UI draws).
 */
const HERE_KIND_TO_CATEGORY: Record<string, number> = {
  accident: 1,
  congestion: 6,
  construction: 9,
  disabledVehicle: 14,
  disabled_vehicle: 14,
  laneRestriction: 7,
  lane_restriction: 7,
  roadClosure: 8,
  road_closure: 8,
  roadHazard: 3,
  road_hazard: 3,
  weather: 3,
  massTransit: 0,
  mass_transit: 0,
  plannedEvent: 0,
  planned_event: 0,
  other: 0,
};

export function hereIncidentCategory(kind: string | undefined, roadClosed?: boolean): number {
  if (roadClosed && kind !== 'accident') return 8;
  return HERE_KIND_TO_CATEGORY[kind ?? ''] ?? 0;
}

/** HERE criticality / warning_level to our magnitude (1 minor .. 3 major, 4 closure). */
export function hereMagnitude(level: string | undefined, roadClosed?: boolean): number {
  if (roadClosed) return 4;
  return ({ low: 1, minor: 1, major: 2, critical: 3 } as Record<string, number>)[level ?? ''] ?? 0;
}

/** HERE flow `kind` in our traffic colour keys (see TRAFFIC_COLORS). */
export const HERE_FLOW_KIND_COLOR: Record<string, 'fast' | 'medium' | 'slow' | 'jam' | 'closed'> = {
  free: 'fast',
  minor: 'medium',
  slow: 'slow',
  queuing: 'jam',
  stationary: 'jam',
};

/** Incidents v7 accepts boxes up to 1° wide and 1° tall. */
export function hereBboxOk([w, s, e, n]: BBox): boolean {
  return e - w <= 1 && n - s <= 1 && e > w && n > s;
}

/** Incidents in a box, with their shape. `lang` empty = the country's own language (Hebrew in Israel). */
export function hereIncidentsUrl(key: string, bbox: BBox, lang = ''): string {
  const q = new URLSearchParams({ in: `bbox:${bbox.map((v) => v.toFixed(5)).join(',')}`, locationReferencing: 'shape' });
  if (lang) q.set('lang', lang);
  q.set('apiKey', key);
  return `${HERE_TRAFFIC_API}/incidents?${q}`;
}

/** Most pass-through points we send, to keep the GET URL short (each costs ~40 characters). */
export const HERE_MAX_VIAS = 30;

/**
 * Points that make HERE follow *our* line: evenly spaced points of the route plus the point nearest
 * to each stop, in route order, ends excluded (they are origin and destination).
 */
export function herePassPoints(line: LngLat[], stops: LngLat[] = [], max = HERE_MAX_VIAS): LngLat[] {
  if (line.length <= 2) return [];
  const idx = new Set<number>();
  const n = Math.max(0, Math.min(max - stops.length, line.length - 2));
  for (let i = 1; i <= n; i++) idx.add(Math.round((i * (line.length - 1)) / (n + 1)));
  for (const s of stops) {
    let best = 1;
    let bestD = Infinity;
    for (let i = 1; i < line.length - 1; i++) {
      const d = (line[i][0] - s[0]) ** 2 + (line[i][1] - s[1]) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    }
    idx.add(best);
  }
  return [...idx].filter((i) => i > 0 && i < line.length - 1).sort((a, b) => a - b).map((i) => line[i]);
}

/**
 * A car route with live traffic leaving now, from origin to destination through `via` points
 * (pass-through: no stop, no extra section), so HERE times our route instead of choosing its own.
 * Summary only: duration (with traffic), baseDuration (free flow), typicalDuration (historic), length.
 */
export function hereRouteUrl(key: string, origin: LngLat, destination: LngLat, via: LngLat[] = [], departure = new Date()): string {
  const ll = ([lng, lat]: LngLat) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const q = new URLSearchParams({ transportMode: 'car', origin: ll(origin), destination: ll(destination) });
  for (const v of via) q.append('via', `${ll(v)}!passThrough=true`);
  q.set('departureTime', departure.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  q.set('return', 'summary,typicalDuration');
  q.set('apiKey', key);
  return `${HERE_ROUTER_API}/routes?${q}`;
}
