import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { fmtTemp, fmtVisibility, latticeFor, rampColor, renderField, rgbaCss, WEATHER_RAMPS, type Lattice, type Rgba, type WeatherLayerId } from '@nm/core';
import { EMPTY, ensureLayer, firstSymbolLayer, Icon, isDark, load, save, setGeoJSON, units, type FeatureContext } from '@nm/core/app';
import type { WeatherGridPoint } from '@nm/tools';
import { fillLattice, gridPoint, hasWeather, seriesAt } from './data.ts';
import { clock, dayLabel } from './format.ts';

type MapLibreMap = FeatureContext['map'];

/**
 * Weather map layers: a smooth colour field interpolated from a lattice of Open-Meteo points
 * (drawn on a canvas, shown as an image source under the labels), numbers on the points, and a
 * time bar to scrub or play the next 48 hours. One layer at a time, like a phone weather app.
 */

export interface LayerDef {
  id: WeatherLayerId;
  label: string;
  icon: string;
  key: keyof Omit<WeatherGridPoint, 'lng' | 'lat' | 'start'>;
  /** Legend: stops shown and how to print them. */
  legend: number[];
  unit: string;
  opacity: number;
}

export const LAYERS: LayerDef[] = [
  { id: 'temp', label: 'טמפרטורה', icon: 'thermostat', key: 'temp', legend: [-10, 0, 10, 20, 30, 40], unit: '°C', opacity: 0.6 },
  { id: 'precip', label: 'משקעים', icon: 'rainy', key: 'precip', legend: [0.1, 1, 3, 6, 12, 25], unit: 'מ״מ/שעה', opacity: 0.85 },
  { id: 'wind', label: 'רוח', icon: 'air', key: 'wind', legend: [0, 10, 20, 30, 45, 60, 80], unit: 'קמ״ש', opacity: 0.55 },
  { id: 'uv', label: 'מדד UV', icon: 'sunny', key: 'uv', legend: [0, 2, 4, 6, 8, 10, 12], unit: 'UV', opacity: 0.55 },
  { id: 'cloud', label: 'עננות', icon: 'cloud', key: 'cloud', legend: [0, 25, 50, 75, 100], unit: '%', opacity: 1 },
  { id: 'vis', label: 'ראות', icon: 'visibility', key: 'vis', legend: [0, 1000, 5000, 10000, 20000], unit: 'ק״מ', opacity: 1 },
];
const byId = (id: WeatherLayerId) => LAYERS.find((l) => l.id === id)!;

export const wxLayer = signal<WeatherLayerId | null>(load<WeatherLayerId | null>('weather:layer', null));
wxLayer.subscribe((v) => save('weather:layer', v));
const hourNow = () => Math.floor(Date.now() / 3_600_000) * 3600;
/** The hour shown, Unix seconds. */
export const wxTime = signal<number>(hourNow());
export const wxLoading = signal(false);
export const wxError = signal(false);
const playing = signal(false);

let map: MapLibreMap | undefined;
let lattice: Lattice | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export function showWeatherLayer(id: WeatherLayerId | null) {
  wxLayer.value = id;
  wxTime.value = hourNow();
  if (map) refreshWeatherLayer(map);
}

export function initWeatherLayers(m: MapLibreMap, onStyle: FeatureContext['onStyle']) {
  map = m;
  onStyle((mm) => {
    addLayers(mm);
    if (wxLayer.peek()) refreshWeatherLayer(mm);
  });
  m.on('moveend', () => wxLayer.peek() && refreshWeatherLayer(m));
  wxTime.subscribe(() => map && draw(map));
  units.subscribe(() => map && draw(map));
}

export function refreshWeatherLayer(m: MapLibreMap) {
  clearTimeout(timer);
  if (!wxLayer.peek() || !hasWeather()) {
    lattice = null;
    playing.value = false;
    draw(m);
    return;
  }
  timer = setTimeout(async () => {
    const b = m.getBounds();
    const l = latticeFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], 160);
    const s = ++seq;
    wxLoading.value = true;
    try {
      await fillLattice(l);
      if (s !== seq) return;
      lattice = l;
      wxError.value = false;
    } catch {
      if (s === seq) wxError.value = true;
      lattice = l;
    } finally {
      if (s === seq) wxLoading.value = false;
    }
    draw(m);
  }, 350);
}

const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function addLayers(m: MapLibreMap) {
  if (!m.getSource('wx-field')) {
    m.addSource('wx-field', {
      type: 'image',
      url: BLANK,
      coordinates: [
        [0, 0.001],
        [0.001, 0.001],
        [0.001, 0],
        [0, 0],
      ],
    });
  }
  ensureLayer(
    m,
    { id: 'wx-field', type: 'raster', source: 'wx-field', paint: { 'raster-opacity': 0.6, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }, layout: { visibility: 'none' } },
    firstSymbolLayer(m),
  );
  if (!m.hasImage('wx-arrow')) m.addImage('wx-arrow', arrowImage(), { pixelRatio: 2 });
  setGeoJSON(m, 'wx-points', EMPTY);
  ensureLayer(
    m,
    {
      id: 'wx-points',
      type: 'symbol',
      source: 'wx-points',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-offset': ['case', ['has', 'rot'], ['literal', [0, 1.1]], ['literal', [0, 0]]] as never,
        'icon-image': ['case', ['has', 'rot'], 'wx-arrow', ''] as never,
        'icon-rotate': ['coalesce', ['get', 'rot'], 0] as never,
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'text-padding': 6,
      },
      paint: { 'text-color': '#202124', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.5 },
    },
    null,
  );
}

function arrowImage(): ImageData {
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.translate(s / 2, s / 2);
  g.fillStyle = '#202124';
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, -13);
  g.lineTo(8, 1);
  g.lineTo(2.5, -1);
  g.lineTo(2.5, 13);
  g.lineTo(-2.5, 13);
  g.lineTo(-2.5, -1);
  g.lineTo(-8, 1);
  g.closePath();
  g.stroke();
  g.fill();
  return g.getImageData(0, 0, s, s);
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function draw(m: MapLibreMap) {
  const id = wxLayer.peek();
  if (!m.getLayer('wx-field')) return;
  if (!id || !lattice) {
    m.setLayoutProperty('wx-field', 'visibility', 'none');
    setGeoJSON(m, 'wx-points', EMPTY);
    return;
  }
  const def = byId(id);
  const l = lattice;
  const t = wxTime.peek();
  const values = l.lats.map((lat) => l.lngs.map((lng) => {
    const p = gridPoint(lng, lat);
    return p ? seriesAt(p, def.key, t) : null;
  }));
  // A canvas a few pixels per point (linear resampling smooths the rest), Mercator-proportioned.
  const wx = ((l.lngs[l.lngs.length - 1] - l.lngs[0]) * Math.PI) / 180;
  const hy = mercY(l.lats[l.lats.length - 1]) - mercY(l.lats[0]);
  if (!(wx > 0) || !(hy > 0)) {
    m.setLayoutProperty('wx-field', 'visibility', 'none');
    return;
  }
  const W = Math.min(480, l.lngs.length * 12);
  const H = Math.max(2, Math.min(720, Math.round((W * hy) / wx)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;
  const px = renderField(l, values, WEATHER_RAMPS[id], W, H);
  ctx2d.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
  const w = l.lngs[0], e = l.lngs[l.lngs.length - 1], s = l.lats[0], n = l.lats[l.lats.length - 1];
  const src = m.getSource('wx-field') as unknown as { updateImage(o: { url: string; coordinates: number[][] }): void } | undefined;
  src?.updateImage({ url: canvas.toDataURL(), coordinates: [[w, n], [e, n], [e, s], [w, s]] });
  m.setPaintProperty('wx-field', 'raster-opacity', def.opacity);
  m.setLayoutProperty('wx-field', 'visibility', 'visible');
  m.setPaintProperty('wx-points', 'text-color', isDark.peek() ? '#ffffff' : '#202124');
  m.setPaintProperty('wx-points', 'text-halo-color', isDark.peek() ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)');
  // Numbers about 72 px apart, on whole lattice steps so they stay put while panning.
  const c = m.getCenter();
  const pxPerStep = Math.abs(m.project([c.lng + l.step, c.lat]).x - m.project([c.lng, c.lat]).x) || 1;
  const every = Math.max(1, Math.ceil(72 / pxPerStep));
  const u = units.peek();
  const features: GeoJSON.Feature[] = [];
  l.lats.forEach((lat, j) =>
    l.lngs.forEach((lng, i) => {
      if (Math.round(lng / l.step) % every || Math.round(lat / l.step) % every) return;
      const v = values[j][i];
      if (v === null) return;
      const p = gridPoint(lng, lat)!;
      const props: Record<string, unknown> = { label: labelFor(id, v, u) };
      if (id === 'wind') {
        const dir = seriesAt(p, 'dir', t);
        if (dir !== null) props.rot = dir + 180;
      }
      if (props.label === '' && !('rot' in props)) return;
      features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lng, lat] } });
    }),
  );
  setGeoJSON(m, 'wx-points', { type: 'FeatureCollection', features });
}

function labelFor(id: WeatherLayerId, v: number, u: 'metric' | 'imperial'): string {
  switch (id) {
    case 'temp':
      return fmtTemp(v, u);
    case 'precip':
      return v >= 0.1 ? (v < 10 ? v.toFixed(1) : String(Math.round(v))) : '';
    case 'wind':
      return String(Math.round(u === 'imperial' ? v / 1.609344 : v));
    case 'uv':
      return String(Math.round(v));
    case 'cloud':
      return `${Math.round(v)}%`;
    case 'vis':
      return v < 20000 ? fmtVisibility(v, u).replace(/ .*/, '') : '';
  }
}

// ---------- UI: the group in the layers sheet, and the time bar on the map ----------

export function WeatherLayerSection() {
  if (!hasWeather()) return null;
  return (
    <>
      <h3 class="section-title">מזג אוויר</h3>
      <div class="layer-grid wx-layer-grid">
        {LAYERS.map((d) => (
          <button key={d.id} class="layer-opt" aria-pressed={wxLayer.value === d.id} onClick={() => showWeatherLayer(wxLayer.value === d.id ? null : d.id)}>
            <span class={`layer-thumb wx-thumb wx-thumb-${d.id}`}>
              <Icon name={d.icon} size={22} />
            </span>
            {d.label}
          </button>
        ))}
      </div>
    </>
  );
}

function legendLabel(def: LayerDef, v: number): string {
  if (def.id === 'temp') return fmtTemp(v, units.value);
  if (def.id === 'vis') return v >= 20000 ? '20+' : String(v / 1000);
  return String(v);
}

/** Floating bar over the map while a weather layer is on: legend, hour, play. */
export function WeatherTimeBar() {
  const id = wxLayer.value;
  useEffect(() => {
    if (!playing.value) return;
    const h = setInterval(() => {
      const start = hourNow();
      const nx = wxTime.peek() + 3600;
      wxTime.value = nx > start + 47 * 3600 ? start : nx;
    }, 800);
    return () => clearInterval(h);
  }, [playing.value]);
  if (!id || !hasWeather()) return null;
  const def = byId(id);
  const start = hourNow();
  const idx = Math.max(0, Math.min(47, Math.round((wxTime.value - start) / 3600)));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const t = start + idx * 3600;
  const dayIdx = Math.round((startOfDay(t, tz) - startOfDay(start, tz)) / 86400);
  const when = idx === 0 ? 'עכשיו' : `${dayIdx === 0 ? 'היום' : dayIdx === 1 ? 'מחר' : dayLabel(t, tz, dayIdx)} ${clock(t, tz)}`;
  const ramp = WEATHER_RAMPS[id];
  const lo = def.legend[0], hi = def.legend[def.legend.length - 1];
  const stops = Array.from({ length: 12 }, (_, i) => lo + ((hi - lo) * i) / 11);
  return (
    <div class="wx-timebar" role="region" aria-label={`שכבת ${def.label}`}>
      <div class="wx-tb-row">
        <button class="icon-btn small" aria-label={playing.value ? 'עצירה' : 'הפעלת התחזית'} onClick={() => (playing.value = !playing.value)}>
          <Icon name={playing.value ? 'pause' : 'play_arrow'} size={22} />
        </button>
        <input
          type="range"
          min={0}
          max={47}
          step={1}
          value={idx}
          aria-label="שעת התחזית"
          aria-valuetext={when}
          onInput={(e) => {
            playing.value = false;
            wxTime.value = start + Number((e.target as HTMLInputElement).value) * 3600;
          }}
        />
        <span class="wx-tb-when">{when}</span>
        <button class="icon-btn small" aria-label="הסתרת שכבת מזג האוויר" onClick={() => showWeatherLayer(null)}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div class="wx-legend" aria-label={`מקרא ${def.label}`}>
        <span class="wx-legend-name">
          {def.label}
          {def.id !== 'temp' && def.id !== 'uv' && ` (${def.unit})`}
        </span>
        <span class="wx-legend-scale" style={{ background: `linear-gradient(to right, ${stops.map((v) => rgbaCss(withAlpha(rampAt(ramp, v)))).join(',')})` }} dir="ltr" />
        <span class="wx-legend-ticks" dir="ltr">
          {def.legend.map((v) => (
            <span key={v}>{legendLabel(def, v)}</span>
          ))}
        </span>
      </div>
      <p class="muted tiny wx-tb-note">
        {wxLoading.value ? 'טוען…' : wxError.value ? 'חלק מהנתונים לא זמינים כרגע.' : def.id === 'precip' ? 'משקעים לפי מודל התחזית (לא מכ״ם). ' : ''}
        Open-Meteo, CC BY 4.0
      </p>
    </div>
  );
}

function startOfDay(t: number, tz: string): number {
  const d = new Date(new Date(t * 1000).toLocaleString('en-US', { timeZone: tz }));
  d.setHours(0, 0, 0, 0);
  return Math.round(d.getTime() / 1000);
}

const rampAt = (ramp: (typeof WEATHER_RAMPS)[WeatherLayerId], v: number) => rampColor(ramp, v);
/** Legend colours with at least some opacity so transparent ends still read. */
const withAlpha = ([r, g, b, a]: Rgba): Rgba => [r, g, b, Math.max(0.35, a)];
