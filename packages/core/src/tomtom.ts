/**
 * TomTom Traffic (live flow and incidents). Everything here is off unless a key is configured
 * (TOMTOM_KEY / VITE_TOMTOM_KEY). We use the v4 "Genesis" traffic endpoints: they are GA,
 * documented, and their vector tiles carry the fields we style and show.
 *   https://docs.tomtom.com/traffic-api/documentation/traffic-flow/vector-flow-tiles
 *   https://docs.tomtom.com/traffic-api/documentation/traffic-incidents/vector-incident-tiles
 *   https://docs.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details
 */
import type { BBox, LngLat } from './types.ts';

export const TOMTOM_API = 'https://api.tomtom.com';
export const TOMTOM_ATTRIBUTION = 'תנועה © <a href="https://www.tomtom.com" target="_blank" rel="noopener noreferrer">TomTom</a>';

/** Vector tiles of live speed relative to free flow (layer "Traffic flow", traffic_level 0..1). */
export function tomtomFlowTiles(key: string): string {
  // TomTom wants the tag list unescaped: tags=[a,b].
  return `${TOMTOM_API}/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=${encodeURIComponent(key)}&tags=[road_type,traffic_level,road_closure,traffic_road_coverage,left_hand_traffic]`;
}

/** Vector tiles of incidents (layers "Traffic incidents POI" and "Traffic incidents flow"), descriptions in `lang`. */
export function tomtomIncidentTiles(key: string, lang = 'he-IL'): string {
  const q = new URLSearchParams({ key, t: '-1', language: lang });
  return `${TOMTOM_API}/traffic/map/4/tile/incidents/{z}/{x}/{y}.pbf?${q}`;
}

export const TOMTOM_FLOW_LAYER = 'Traffic flow';
export const TOMTOM_INCIDENT_POI_LAYER = 'Traffic incidents POI';

/** Google-like traffic colours: green (free flow) to dark red (standing). */
export const TRAFFIC_COLORS = { fast: '#1ea362', medium: '#f29900', slow: '#e8453c', jam: '#9e1c1a', closed: '#5f1210' } as const;

/** TomTom iconCategory / icon_category, as documented for Incident Details v5. */
export const INCIDENT_CATEGORIES: Record<number, { id: string; label: string; icon: string; color: string }> = {
  0: { id: 'unknown', label: 'אירוע תנועה', icon: 'warning', color: '#5f6368' },
  1: { id: 'accident', label: 'תאונה', icon: 'car_crash', color: '#d93025' },
  2: { id: 'fog', label: 'ערפל', icon: 'foggy', color: '#5f6368' },
  3: { id: 'dangerous_conditions', label: 'תנאי דרך מסוכנים', icon: 'warning', color: '#e37400' },
  4: { id: 'rain', label: 'גשם', icon: 'rainy', color: '#1a73e8' },
  5: { id: 'ice', label: 'קרח על הכביש', icon: 'ac_unit', color: '#1a73e8' },
  6: { id: 'jam', label: 'עומס תנועה', icon: 'traffic', color: '#e8453c' },
  7: { id: 'lane_closed', label: 'נתיב סגור', icon: 'do_not_disturb_on', color: '#e37400' },
  8: { id: 'road_closed', label: 'כביש סגור', icon: 'block', color: '#9e1c1a' },
  9: { id: 'road_works', label: 'עבודות בכביש', icon: 'construction', color: '#e37400' },
  10: { id: 'wind', label: 'רוח חזקה', icon: 'air', color: '#5f6368' },
  11: { id: 'flooding', label: 'הצפה', icon: 'flood', color: '#1a73e8' },
  14: { id: 'broken_down_vehicle', label: 'רכב תקוע', icon: 'car_repair', color: '#e37400' },
};

export function incidentCategory(n: number | undefined) {
  return INCIDENT_CATEGORIES[n ?? 0] ?? INCIDENT_CATEGORIES[0];
}

export const INCIDENT_MAGNITUDE: Record<number, string> = { 0: 'לא ידוע', 1: 'עיכוב קל', 2: 'עיכוב בינוני', 3: 'עיכוב משמעותי', 4: 'לזמן בלתי מוגבל' };

const FIELDS =
  '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers}}}';

/** Incident Details v5 for a box ([west, south, east, north], at most 10,000 km²). */
export function incidentDetailsUrl(key: string, bbox: BBox, lang = 'he-IL'): string {
  const q = new URLSearchParams({
    key,
    bbox: bbox.map((v) => v.toFixed(5)).join(','),
    fields: FIELDS,
    language: lang,
    timeValidityFilter: 'present',
  });
  return `${TOMTOM_API}/traffic/services/5/incidentDetails?${q}`;
}

/** Area of a lng/lat box in km², good enough to stay under TomTom's 10,000 km² limit. */
export function bboxAreaKm2([w, s, e, n]: BBox): number {
  const kmPerDegLat = 111.32;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  return Math.abs(e - w) * kmPerDegLat * Math.cos(midLat) * Math.abs(n - s) * kmPerDegLat;
}

/**
 * Calculate Route with live traffic, reconstructing the route we already have (from Valhalla)
 * through supporting points, so the time is for *our* route, not TomTom's own choice.
 * https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route
 */
export function trafficRouteUrl(key: string, waypoints: LngLat[]): string {
  const locs = waypoints.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(':');
  const q = new URLSearchParams({ key, traffic: 'true', travelMode: 'car', routeType: 'fastest', computeTravelTimeFor: 'all', routeRepresentation: 'summaryOnly' });
  return `${TOMTOM_API}/routing/1/calculateRoute/${locs}/json?${q}`;
}

/** Evenly thinned points of a line (keeps both ends), for TomTom's supportingPoints. */
export function samplePoints(line: LngLat[], max: number): LngLat[] {
  if (line.length <= max) return line;
  const out: LngLat[] = [];
  const step = (line.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(line[Math.round(i * step)]);
  return out;
}
