import { bearing, distance } from './geo.ts';
import { mergeWorldFile } from './territory.ts';
import type { BBox, LngLat } from './types.ts';

/**
 * The small world map that ships with the app (apps/web/public/offline/world-1.json, made by
 * packages/features/flight/scripts/gen-world.mjs): country shapes and borders, big cities and
 * major airports. It draws the map when the vector tiles can't load (on a plane) and answers
 * "what am I above" without a network.
 */
export interface WorldFile {
  v: 1;
  /** Grid cells per degree of the integer coordinates. */
  q: number;
  attribution: string;
  /** Delta-encoded integer arcs: [x0, y0, dx1, dy1, ...]. */
  arcs: number[][];
  /** Arcs shared by two countries (land borders). */
  borders: number[];
  countries: { n: string; he: string; c: string; l: [number, number]; a: number; p: number[][][] }[];
  /** [name, Hebrew name or '', lng, lat, population in thousands, capital 1/0, country code] */
  cities: [string, string, number, number, number, number, string][];
  /** [IATA, name, city, country code, lng, lat] */
  airports: [string, string, string, string, number, number][];
}

export interface WorldCountry {
  name: string;
  he: string;
  code: string;
  label: LngLat;
  /** Square degrees, for label priority. */
  area: number;
  /** Polygons, each [outer ring, ...holes]. */
  polygons: LngLat[][][];
  bbox: BBox;
}

export interface WorldCity {
  name: string;
  he: string;
  lngLat: LngLat;
  /** Population in thousands. */
  pop: number;
  capital: boolean;
  country: string;
}

export interface WorldAirport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lngLat: LngLat;
}

export interface World {
  countries: WorldCountry[];
  borders: LngLat[][];
  cities: WorldCity[];
  airports: WorldAirport[];
  attribution: string;
}

export function decodeWorld(file: WorldFile): World {
  const f = mergeWorldFile(file);
  const arcs: LngLat[][] = f.arcs.map((a) => {
    const out: LngLat[] = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < a.length; i += 2) {
      x += a[i];
      y += a[i + 1];
      out.push([x / f.q, y / f.q]);
    }
    return out;
  });
  const ring = (idx: number[]): LngLat[] => {
    const out: LngLat[] = [];
    for (const i of idx) {
      const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  const countries = f.countries.map((c): WorldCountry => {
    const polygons = c.p.map((poly) => poly.map(ring).filter((r) => r.length >= 4)).filter((p) => p.length);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const poly of polygons) {
      for (const [x, y] of poly[0]) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    }
    return { name: c.n, he: c.he, code: c.c, label: c.l, area: c.a, polygons, bbox: [w, s, e, n] };
  });
  return {
    countries,
    borders: f.borders.map((i) => arcs[i]),
    cities: f.cities.map(([name, he, lng, lat, pop, cap, country]) => ({ name, he, lngLat: [lng, lat], pop, capital: cap === 1, country })),
    airports: f.airports.map(([iata, name, city, country, lng, lat]) => ({ iata, name, city, country, lngLat: [lng, lat] })),
    attribution: f.attribution,
  };
}

/** Even-odd ray casting over every ring of a polygon (holes included). */
function inPolygon([x, y]: LngLat, rings: LngLat[][]): boolean {
  let c = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** The country under a point, or null over the sea. */
export function countryAt(world: World, p: LngLat): WorldCountry | null {
  const lng = ((((p[0] + 180) % 360) + 360) % 360) - 180;
  const q: LngLat = [lng, p[1]];
  for (const c of world.countries) {
    const [w, s, e, n] = c.bbox;
    if (q[0] < w || q[0] > e || q[1] < s || q[1] > n) continue;
    if (c.polygons.some((poly) => inPolygon(q, poly))) return c;
  }
  return null;
}

/** The nearest city of at least `minPop` thousand people, with distance (m) and bearing from it. */
export function nearestCity(world: World, p: LngLat, minPop = 0): { city: WorldCity; distanceM: number; bearingFromCity: number } | null {
  let best: WorldCity | null = null;
  let bestD = Infinity;
  for (const c of world.cities) {
    if (c.pop < minPop && !c.capital) continue;
    const d = distance(p, c.lngLat);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best ? { city: best, distanceM: bestD, bearingFromCity: bearing(best.lngLat, p) } : null;
}

export const worldName = (x: { name: string; he: string }, lang = 'he'): string => (lang === 'he' && x.he) || x.name;

/** Bundled cities and airports matching a query, best first, for choosing a destination offline. */
export function searchWorld(world: World, query: string, limit = 8): ({ kind: 'city'; city: WorldCity } | { kind: 'airport'; airport: WorldAirport })[] {
  const q = query.trim().toLowerCase().replace(/["״׳']/g, '');
  if (!q) return [];
  const clean = (s: string) => s.toLowerCase().replace(/["״׳'’‘]/g, '');
  const score = (names: string[]) => {
    let best = 0;
    for (const n of names.map(clean)) {
      if (n === q) best = Math.max(best, 3);
      else if (n.startsWith(q)) best = Math.max(best, 2);
      else if (n.includes(q)) best = Math.max(best, 1);
    }
    return best;
  };
  const out: { s: number; r: ReturnType<typeof searchWorld>[number] }[] = [];
  for (const city of world.cities) {
    const s = score([city.name, city.he]);
    if (s) out.push({ s: s * 10 + Math.log10(city.pop + 1), r: { kind: 'city', city } });
  }
  for (const airport of world.airports) {
    const s = q.length === 3 && clean(airport.iata) === q ? 4 : score([airport.name, airport.city]);
    if (s) out.push({ s: s * 10 + 1, r: { kind: 'airport', airport } });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.r);
}

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
type Collection = { type: 'FeatureCollection'; features: Feature[] };

/** The world as one GeoJSON collection for the map, each feature tagged with `kind`. */
export function worldGeoJSON(world: World, lang = 'he'): Collection {
  const features: Feature[] = [];
  for (const c of world.countries) {
    features.push({ type: 'Feature', properties: { kind: 'land' }, geometry: { type: 'MultiPolygon', coordinates: c.polygons } });
  }
  features.push({ type: 'Feature', properties: { kind: 'border' }, geometry: { type: 'MultiLineString', coordinates: world.borders } });
  for (const c of world.countries) {
    if (!c.area) continue;
    features.push({
      type: 'Feature',
      properties: { kind: 'country', name: worldName(c, lang), area: c.area, rank: -c.area },
      geometry: { type: 'Point', coordinates: c.label },
    });
  }
  for (const c of world.cities) {
    features.push({
      type: 'Feature',
      properties: { kind: 'city', name: worldName(c, lang), pop: c.pop, capital: c.capital, rank: (c.capital ? -50000 : 0) - c.pop },
      geometry: { type: 'Point', coordinates: c.lngLat },
    });
  }
  return { type: 'FeatureCollection', features };
}
