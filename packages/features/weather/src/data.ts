import type { LngLat } from '@nm/core';
import { latticeFor, pointKey, type Lattice } from '@nm/core';
import { load, providers, save } from '@nm/core/app';
import { tools, weatherForecastTool, weatherGridTool, type WeatherForecast, type WeatherGridPoint } from '@nm/tools';

export const hasWeather = () => !!providers.peek().weatherUrl;

// ---------- one point (the weather screen, place card, home card) ----------

const FORECAST_TTL = 10 * 60_000;
const forecasts = new Map<string, { at: number; data: Promise<WeatherForecast | null> }>();
/** The last forecast we got, kept on the device so the screen has something offline. */
const LAST_KEY = 'weather:last';

/** Forecast for a point, rounded to ~1 km and cached for 10 minutes. */
export function forecastAt(at: LngLat): Promise<WeatherForecast | null> {
  const key = `${at[0].toFixed(2)},${at[1].toFixed(2)}`;
  const hit = forecasts.get(key);
  if (hit && Date.now() - hit.at < FORECAST_TTL) return hit.data;
  const data = tools()
    .call(weatherForecastTool, { at })
    .then((f) => {
      if (f) save(LAST_KEY, { key, f });
      return f;
    })
    .catch((e: unknown) => {
      forecasts.delete(key);
      const last = load<{ key: string; f: WeatherForecast } | null>(LAST_KEY, null);
      if (last?.key === key) return last.f;
      throw e;
    });
  forecasts.set(key, { at: Date.now(), data });
  return data;
}

// ---------- many points (map layers, the map chip) ----------

const GRID_TTL = 30 * 60_000;
const grid = new Map<string, { at: number; p: WeatherGridPoint }>();
const pending = new Map<string, Promise<void>>();

export function gridPoint(lng: number, lat: number): WeatherGridPoint | undefined {
  const hit = grid.get(pointKey(lng, lat));
  return hit && Date.now() - hit.at < GRID_TTL ? hit.p : undefined;
}

/** Fetches the points of a lattice we don't have yet (at most 2 calls of 100 points). */
export async function fillLattice(l: Lattice): Promise<void> {
  const want: LngLat[] = [];
  const waits: Promise<void>[] = [];
  for (const lat of l.lats)
    for (const lng of l.lngs) {
      const k = pointKey(lng, lat);
      if (gridPoint(lng, lat)) continue;
      const p = pending.get(k);
      if (p) waits.push(p);
      else want.push([lng, lat]);
    }
  for (let i = 0; i < want.length && i < 200; i += 100) {
    const batch = want.slice(i, i + 100);
    const job = tools()
      .call(weatherGridTool, { points: batch, hours: 48 })
      .then((list) => {
        const now = Date.now();
        for (const p of list) grid.set(pointKey(p.lng, p.lat), { at: now, p });
      })
      .finally(() => batch.forEach((b) => pending.delete(pointKey(b[0], b[1]))));
    batch.forEach((b) => pending.set(pointKey(b[0], b[1]), job));
    waits.push(job);
  }
  await Promise.all(waits);
}

/** The lattice point nearest to `at` on a 0.25° lattice (the map chip). */
export async function nearestGridPoint(at: LngLat): Promise<WeatherGridPoint | undefined> {
  const step = 0.25;
  const lng = Number((Math.round(at[0] / step) * step).toFixed(4));
  const lat = Number((Math.round(at[1] / step) * step).toFixed(4));
  const hit = gridPoint(lng, lat);
  if (hit) return hit;
  await fillLattice({ step, lngs: [lng], lats: [lat] });
  return gridPoint(lng, lat);
}

export { latticeFor };

/** Value of a grid series at a Unix time (the hour containing it). */
export function seriesAt(p: WeatherGridPoint, key: keyof Omit<WeatherGridPoint, 'lng' | 'lat' | 'start'>, t: number): number | null {
  const i = Math.floor((t - p.start) / 3600);
  return i >= 0 ? (p[key][i] ?? null) : null;
}
