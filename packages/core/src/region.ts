import type { BBox, LngLat } from './types.ts';

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
   * Which features have data here. traffic: live traffic from our traffic provider (TomTom lists
   * ~73 markets, not Israel: docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/product-information/market-coverage).
   */
  coverage: { search: boolean; routing: boolean; transit: boolean; traffic: boolean };
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
    coverage: { search: true, routing: true, transit: false, traffic: false },
  },
  {
    id: 'us',
    name: 'ארצות הברית',
    bbox: [-125, 24.4, -66.9, 49.4],
    center: [-98.5, 39.8],
    zoom: 3.5,
    languages: ['en'],
    units: 'imperial',
    coverage: { search: true, routing: true, transit: false, traffic: true },
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
    coverage: { search: true, routing: true, transit: false, traffic: true },
  },
  {
    id: 'world',
    name: 'העולם',
    bbox: null,
    center: [34.85, 31.75],
    zoom: 2,
    languages: ['en'],
    units: 'metric',
    coverage: { search: true, routing: true, transit: false, traffic: false },
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
