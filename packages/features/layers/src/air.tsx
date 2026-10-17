import { signal } from '@preact/signals';
import type { FeatureContext } from '@nm/core/app';
type MapLibreMap = FeatureContext['map'];
import type { LngLat } from '@nm/core';
import { ensureLayer, EMPTY, load, providers, save, setGeoJSON } from '@nm/core/app';
import { airQuality, aqiLabel, tools, type AirQuality } from '@nm/tools';

/**
 * Air quality layer: the European AQI on a grid over the visible map (Open-Meteo, CAMS
 * model data, ~10 km resolution), as coloured discs with the number, like Google's layer.
 */
export const airOn = signal<boolean>(load('layers:air', false));
airOn.subscribe((v) => save('layers:air', v));
export const airReadings = signal<AirQuality[]>([]);
export const airError = signal(false);

export const hasAir = () => !!providers.peek().airQualityUrl;

/** EEA colours for the European AQI bands. */
export function aqiColor(aqi: number | null): string {
  if (aqi === null) return '#9aa0a6';
  if (aqi <= 20) return '#50f0e6';
  if (aqi <= 40) return '#50ccaa';
  if (aqi <= 60) return '#f0e641';
  if (aqi <= 80) return '#ff5050';
  if (aqi <= 100) return '#960032';
  return '#7d2181';
}

/** A grid of points over the map bounds, `n` per side, rounded so panning a little reuses the cache. */
export function gridOver([w, s, e, n]: [number, number, number, number], per = 6): LngLat[] {
  const out: LngLat[] = [];
  const step = (x: number) => Math.max(0.05, Math.round(x * 20) / 20);
  const dx = step((e - w) / per), dy = step((n - s) / per);
  const x0 = Math.floor(w / dx) * dx, y0 = Math.floor(s / dy) * dy;
  for (let i = 0; i <= per; i++)
    for (let j = 0; j <= per; j++) {
      const lng = x0 + (i + 0.5) * dx, lat = y0 + (j + 0.5) * dy;
      if (lng <= e + dx && lat <= n + dy && Math.abs(lat) < 85) out.push([Number(lng.toFixed(3)), Number(lat.toFixed(3))]);
    }
  return out.slice(0, 50);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export function refreshAir(map: MapLibreMap) {
  clearTimeout(timer);
  if (!airOn.peek() || !hasAir()) {
    airReadings.value = [];
    draw(map);
    return;
  }
  timer = setTimeout(async () => {
    const b = map.getBounds();
    // Model data is ~10 km: below zoom 7 the grid is fine, above it one grid cell covers the screen.
    const z = map.getZoom();
    const pad = z > 11 ? 0.15 : 0;
    const box: [number, number, number, number] = [b.getWest() - pad, b.getSouth() - pad, b.getEast() + pad, b.getNorth() + pad];
    const s = ++seq;
    try {
      const r = await tools().call(airQuality, { points: gridOver(box, z > 11 ? 3 : 6) });
      if (s !== seq) return;
      airReadings.value = r;
      airError.value = false;
    } catch {
      if (s === seq) airError.value = true;
    }
    draw(map);
  }, 400);
}

function draw(map: MapLibreMap) {
  if (!map.getSource('air-quality')) return;
  const list = airOn.peek() ? airReadings.peek() : [];
  setGeoJSON(map, 'air-quality', {
    type: 'FeatureCollection',
    features: list
      .filter((a) => a.aqi !== null)
      .map((a) => ({
        type: 'Feature' as const,
        properties: { aqi: a.aqi, label: String(a.aqi), color: aqiColor(a.aqi), name: aqiLabel(a.aqi) },
        geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
      })),
  });
}

export function addAirLayers(map: MapLibreMap) {
  setGeoJSON(map, 'air-quality', EMPTY);
  ensureLayer(map, {
    id: 'air-quality-halo',
    type: 'circle',
    source: 'air-quality',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 18, 10, 40], 'circle-color': ['get', 'color'] as never, 'circle-opacity': 0.22, 'circle-blur': 0.6 },
  });
  ensureLayer(map, {
    id: 'air-quality',
    type: 'circle',
    source: 'air-quality',
    paint: { 'circle-radius': 14, 'circle-color': ['get', 'color'] as never, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
  ensureLayer(map, {
    id: 'air-quality-label',
    type: 'symbol',
    source: 'air-quality',
    layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#202124' },
  });
  draw(map);
}

const BANDS: [string, number | null][] = [
  ['טובה', 10], ['סבירה', 30], ['בינונית', 50], ['גרועה', 70], ['גרועה מאוד', 90], ['גרועה ביותר', 120],
];

export function AirLegend() {
  if (!airOn.value) return null;
  return (
    <div class="air-legend" aria-label="מקרא איכות אוויר">
      <div class="air-scale">
        {BANDS.map(([label, v]) => (
          <span key={label} title={label} style={{ background: aqiColor(v) }} />
        ))}
      </div>
      <p class="muted tiny">
        מדד איכות האוויר האירופי (EAQI), מודל CAMS ברזולוציה של כ-10 ק״מ, מתעדכן כל שעה. נתונים: Open-Meteo, CC BY 4.0.
        {airError.value && ' הנתונים לא זמינים כרגע.'}
      </p>
    </div>
  );
}
