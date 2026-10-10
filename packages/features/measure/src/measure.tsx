import { computed, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Map as MapLibreMap, MapLayerMouseEvent, MapLayerTouchEvent } from 'maplibre-gl';
import { formatArea, formatDistance, greatCircle, pathLength, ringArea, type LngLat } from '@nm/core';
import { back, currentView, open, ensureLayer, Icon, isDark, region, setGeoJSON, sheet, units, viewStack, type FeatureContext, type ViewProps } from '@nm/core/app';

/**
 * Google's "Measure distance": every tap on the map adds a point; tapping the first point
 * again closes the shape and shows its area. Points can be dragged.
 */
export const points = signal<LngLat[]>([]);
export const closed = signal(false);

const SRC = 'measure';
const HIT = 'measure-points-hit';

const total = computed(() => pathLength(points.value, closed.value));
const area = computed(() => (closed.value ? ringArea(points.value) : 0));

export const isMeasuring = () => currentView.peek().kind === 'measure';

/** Opens the measuring screen, optionally starting at a point (from a dropped pin). */
export function startMeasure(from?: LngLat, replace = false) {
  points.value = from ? [from] : [];
  closed.value = false;
  open({ kind: 'measure', props: { url: { panel: 'measure' } } }, { replace });
}

export function undo() {
  if (closed.value) closed.value = false;
  else points.value = points.value.slice(0, -1);
}

export function clear() {
  points.value = [];
  closed.value = false;
}

/** The path as drawn: each edge follows the great circle, so long lines are true. */
function edges(pts: LngLat[], close: boolean): LngLat[] {
  if (pts.length < 2) return pts;
  const ring = close ? [...pts, pts[0]] : pts;
  const out: LngLat[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) out.push(...greatCircle(ring[i - 1], ring[i]).slice(1));
  return out;
}

type Data = Parameters<typeof setGeoJSON>[2];

function data(): Data {
  const pts = points.value;
  const isClosed = closed.value;
  const line = edges(pts, isClosed);
  const features: unknown[] = [];
  if (isClosed) features.push({ type: 'Feature', properties: { kind: 'area' }, geometry: { type: 'Polygon', coordinates: [line] } });
  if (line.length >= 2) features.push({ type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: line } });
  const closable = !isClosed && pts.length >= 3;
  pts.forEach((p, i) =>
    features.push({ type: 'Feature', properties: { kind: 'point', i, big: i === 0 && closable }, geometry: { type: 'Point', coordinates: p } }),
  );
  return { type: 'FeatureCollection', features } as Data;
}

function colors() {
  // Google draws the path in black with white dots; inverted on the dark map.
  return isDark.peek() ? { ink: '#e8eaed', paper: '#202124' } : { ink: '#202124', paper: '#ffffff' };
}

function addLayers(m: MapLibreMap) {
  const { ink, paper } = colors();
  setGeoJSON(m, SRC, data());
  const kind = (k: string) => ['==', ['get', 'kind'], k] as never;
  // `null`: above everything, labels included, like Google's measuring path.
  ensureLayer(m, { id: 'measure-fill', type: 'fill', source: SRC, filter: kind('area'), paint: { 'fill-color': ink, 'fill-opacity': 0.12 } }, null);
  ensureLayer(m, {
    id: 'measure-casing',
    type: 'line',
    source: SRC,
    filter: kind('line'),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': paper, 'line-width': 6, 'line-opacity': 0.9 },
  }, null);
  ensureLayer(m, {
    id: 'measure-line',
    type: 'line',
    source: SRC,
    filter: kind('line'),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ink, 'line-width': 2.5 },
  }, null);
  // A larger invisible circle makes the dots easy to hit with a finger.
  ensureLayer(m, { id: HIT, type: 'circle', source: SRC, filter: kind('point'), paint: { 'circle-radius': 18, 'circle-opacity': 0 } }, null);
  ensureLayer(m, {
    id: 'measure-points',
    type: 'circle',
    source: SRC,
    filter: kind('point'),
    paint: {
      'circle-radius': ['case', ['get', 'big'], 8, 5.5] as never,
      'circle-color': paper,
      'circle-stroke-color': ink,
      'circle-stroke-width': 2,
    },
  }, null);
}

export function setupMeasure(ctx: FeatureContext) {
  const map = ctx.map;
  const draw = () => {
    if (map.getSource(SRC)) setGeoJSON(map, SRC, data());
  };
  ctx.onStyle(addLayers);
  points.subscribe(draw);
  closed.subscribe(draw);

  // Leaving the screen ends the measurement, like Google.
  currentView.subscribe((v) => {
    map.getCanvas().style.cursor = v.kind === 'measure' ? 'crosshair' : '';
    if (!viewStack.peek().some((x) => x.kind === 'measure') && (points.peek().length || closed.peek())) clear();
  });

  // Above every other feature: while measuring, taps add points instead of opening places.
  ctx.onMapClick((e, features) => {
    if (!isMeasuring()) return;
    const hit = features.find((f) => f.layer.id === HIT);
    if (hit) {
      if (Number(hit.properties.i) === 0 && points.value.length >= 3 && !closed.value) closed.value = true;
      return true;
    }
    if (!closed.value) points.value = [...points.value, [e.lngLat.lng, e.lngLat.lat]];
    return true;
  }, 1000);
  // A long press or right click while measuring must not drop a pin over the measurement.
  ctx.onMapLongPress(() => isMeasuring() || undefined, 1000);

  // Drag a dot to move it.
  const startDrag = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
    if (!isMeasuring() || ('points' in e && e.points.length !== 1)) return;
    const f = e.features?.[0];
    if (!f) return;
    e.preventDefault(); // keeps the map from panning
    const i = Number(f.properties.i);
    const touch = e.type === 'touchstart';
    map.getCanvas().style.cursor = 'grabbing';
    const move = (ev: { lngLat: { lng: number; lat: number } }) => {
      const next = [...points.peek()];
      next[i] = [ev.lngLat.lng, ev.lngLat.lat];
      points.value = next;
    };
    const end = () => {
      map.off(touch ? 'touchmove' : 'mousemove', move);
      map.getCanvas().style.cursor = isMeasuring() ? 'crosshair' : '';
    };
    map.on(touch ? 'touchmove' : 'mousemove', move);
    map.once(touch ? 'touchend' : 'mouseup', end);
  };
  map.on('mousedown', HIT, startDrag);
  map.on('touchstart', HIT, startDrag);
  map.on('mouseenter', HIT, () => isMeasuring() && (map.getCanvas().style.cursor = 'move'));
  map.on('mouseleave', HIT, () => isMeasuring() && (map.getCanvas().style.cursor = 'crosshair'));
}

function hint(n: number, isClosed: boolean): string {
  if (isClosed) return '';
  if (n === 0) return 'לחצו על המפה כדי להוסיף נקודה';
  if (n === 1) return 'לחצו על נקודה נוספת במפה';
  if (n >= 3) return 'לחצו על הנקודה הראשונה למדידת שטח';
  return '';
}

export function MeasureView({ onSaveImage }: ViewProps & { onSaveImage?: () => void }) {
  // Keep the map visible: the card only needs the bottom of the screen.
  useEffect(() => {
    sheet.value = 'peek';
  }, []);
  const n = points.value.length;
  const isClosed = closed.value;
  const u = units.value;
  const lang = region.value.languages[0] ?? 'en';
  const h = hint(n, isClosed);
  let value: string;
  let sub: string;
  if (isClosed) {
    value = formatArea(area.value, u, lang);
    sub = `שטח · היקף ${formatDistance(total.value, u)}`;
  } else if (n >= 2) {
    value = formatDistance(total.value, u);
    sub = h ? `מרחק כולל · ${h}` : 'מרחק כולל';
  } else {
    value = 'מדידת מרחק';
    sub = h;
  }
  return (
    <div class="view measure">
      <div class="measure-head">
        <h2 class={`measure-value ${n >= 2 || isClosed ? '' : 'is-title'}`} aria-live="polite">
          {value}
        </h2>
        {onSaveImage && (
          <button class="icon-btn" aria-label="שמירת תמונת מפה" title="שמירת תמונת מפה" disabled={n < 2} onClick={onSaveImage}>
            <Icon name="download" />
          </button>
        )}
        <button class="icon-btn" aria-label="סגירת המדידה" title="סגירה" onClick={back}>
          <Icon name="close" />
        </button>
      </div>
      <p class="muted small measure-sub" aria-live="polite">
        {sub}
      </p>
      <div class="chips measure-actions">
        <button class="chip" disabled={!n} onClick={undo}>
          <Icon name="undo" />
          בטל נקודה אחרונה
        </button>
        <button class="chip" disabled={!n} onClick={clear}>
          <Icon name="delete" />
          ניקוי
        </button>
      </div>
    </div>
  );
}
