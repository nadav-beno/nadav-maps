import type { BBox, LngLat } from './types.ts';

/** Live traffic providers we can use (each needs its own key). */
export type TrafficProviderId = 'tomtom' | 'here';

/**
 * Region registry. Nothing in the app assumes Israel: everything regional
 * (language, units, time zone, data providers) comes from here. Adding a country
 * means adding an entry and, when we self-host, pointing its providers at our servers.
 */
export interface Region {
  id: string;
  name: string;
  /** null = whole world (fallback region). */
  bbox: BBox | null;
  center: LngLat;
  zoom: number;
  languages: string[];
  units: 'metric' | 'imperial';
  timeZone?: string;
  /**
   * Which features have data here. traffic: the providers with live traffic in this region, best
   * first ([] = none known). TomTom lists ~73 markets, not Israel
   * (docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/product-information/market-coverage);
   * HERE lists Israel with flow and incidents (docs.here.com/traffic-api/docs/here-traffic-api-v7-coverage-information).
   */
  coverage: { search: boolean; routing: boolean; transit: boolean; traffic: TrafficProviderId[] };
}

export const REGIONS: Region[] = [
  {
    id: 'il',
    name: 'ישראל',
    bbox: [34.2, 29.45, 35.95, 33.35],
    center: [34.85, 31.75],
    zoom: 7.4,
    languages: ['he', 'ar', 'en'],
    units: 'metric',
    timeZone: 'Asia/Jerusalem',
    coverage: { search: true, routing: true, transit: false, traffic: ['here'] },
  },
  {
    id: 'us',
    name: 'ארצות הברית',
    bbox: [-125, 24.4, -66.9, 49.4],
    center: [-98.5, 39.8],
    zoom: 3.5,
    languages: ['en'],
    units: 'imperial',
    coverage: { search: true, routing: true, transit: false, traffic: ['tomtom', 'here'] },
  },
  {
    id: 'gb',
    name: 'בריטניה',
    bbox: [-8.7, 49.8, 1.8, 60.9],
    center: [-2, 54],
    zoom: 5,
    languages: ['en'],
    units: 'imperial',
    timeZone: 'Europe/London',
    coverage: { search: true, routing: true, transit: false, traffic: ['tomtom', 'here'] },
  },
  {
    id: 'world',
    name: 'העולם',
    bbox: null,
    center: [34.85, 31.75],
    zoom: 2,
    languages: ['en'],
    units: 'metric',
    coverage: { search: true, routing: true, transit: false, traffic: [] },
  },
];

export const DEFAULT_REGION = REGIONS[0];

/** The most specific region containing the point (smallest bbox wins). */
export function regionAt(p: LngLat): Region {
  let best: Region | undefined;
  let bestArea = Infinity;
  for (const r of REGIONS) {
    if (!r.bbox) continue;
    const [w, s, e, n] = r.bbox;
    if (p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n) {
      const area = (e - w) * (n - s);
      if (area < bestArea) {
        best = r;
        bestArea = area;
      }
    }
  }
  return best ?? REGIONS.find((r) => r.id === 'world')!;
}

export interface TrafficChoice {
  id: TrafficProviderId;
  /** The provider has live traffic in this region (otherwise it may show little or nothing). */
  live: boolean;
}

/**
 * Which traffic provider to use in a region with the keys we have: the first one the region lists
 * as covering it that has a key; failing that, any configured provider (TomTom first). null = no key.
 */
export function trafficProvider(region: Pick<Region, 'coverage'>, keys: { tomtomKey?: string; hereKey?: string }): TrafficChoice | null {
  const has = (id: TrafficProviderId) => !!(id === 'tomtom' ? keys.tomtomKey : keys.hereKey);
  const covered = region.coverage.traffic.find(has);
  if (covered) return { id: covered, live: true };
  const any = (['tomtom', 'here'] as const).find(has);
  return any ? { id: any, live: false } : null;
}
