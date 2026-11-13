import { effect, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { GeoJSONSource, Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl';
import { formatClock, formatDeparture, vehicleEndsAt, vehiclePositionAt, type BBox, type Departure, type LiveVehicle } from '@nm/core';
import { back, Icon, LineChip, lineColors, mapLayers, open, region, toast, TRANSIT_LABEL, type ViewProps } from '@nm/core/app';
import { tools, transitVehiclesTool, type LiveVehicles } from '@nm/tools';

/**
 * Live public transport on the map, shown with the transit layer: buses that report their GPS
 * position (Israel, Open Bus), and elsewhere vehicles moved along their path from live or
 * timetable stop times (Transitous). Refreshed every 20 s while the page is visible; computed
 * vehicles move every second in between.
 */

export const LIVE_MIN_ZOOM = 12;
const REFRESH_MS = 20_000;
const TICK_MS = 1000;
const SRC = 'live-vehicles';
export const LIVE_LAYERS = ['live-vehicles-arrow', 'live-vehicles-dot', 'live-vehicles-label'];
const SELECTED_LAYER = 'live-vehicles-selected';

export const liveVehicles = signal<LiveVehicle[]>([]);
/**
 * A bus opened from a stop's live arrivals: shown until the map's own feed has it (same id), and
 * it keeps the arrival time at that stop for the card.
 */
const pinned = signal<LiveVehicle | null>(null);

/** Every vehicle to draw: the feed, plus the pinned bus when the feed doesn't have it yet. */
function allVehicles(list = liveVehicles.peek(), pin = pinned.peek()): LiveVehicle[] {
  if (!pin || list.some((v) => v.id === pin.id)) return list;
  return [...list, pin];
}

/** The vehicle with this id, with the pinned arrival time when it is the pinned bus. */
function findVehicle(id: string, list = liveVehicles.value, pin = pinned.value): LiveVehicle | undefined {
  const v = list.find((x) => x.id === id);
  if (pin && pin.id === id) return v ? { ...v, arrival: pin.arrival, headsign: v.headsign ?? pin.headsign, agency: v.agency ?? pin.agency } : pin;
  return v;
}

/** From a live arrival with a known bus position: show that bus on the map and open its card. */
export function showArrivingBus(d: Departure) {
  if (!d.vehicle) return;
  const id = d.vehicle.id ?? `arrival:${d.line}:${d.time}`;
  pinned.value = {
    id,
    mode: d.mode,
    line: d.line,
    headsign: d.headsign || undefined,
    agency: d.agency,
    color: d.color,
    textColor: d.textColor,
    source: 'gps',
    lng: d.vehicle.lng,
    lat: d.vehicle.lat,
    at: d.vehicle.at ?? new Date().toISOString(),
    arrival: { stop: d.stop.name, time: d.time },
  };
  if (!mapLayers.peek().transit) mapLayers.value = { ...mapLayers.peek(), transit: true };
  map.flyTo({ center: [d.vehicle.lng, d.vehicle.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
  render();
  open({ kind: 'vehicle', props: { id } });
}
export const liveSources = signal<LiveVehicles['sources']>([]);
/** The vehicle whose card is open (highlighted, optionally followed). */
const selected = signal<string | null>(null);
const following = signal(false);

let map: MapLibreMap;
let timer: ReturnType<typeof setInterval> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
let ac: AbortController | null = null;
let failedOnce = false;

const on = () => mapLayers.peek().transit;

/** The visible map, padded a little so vehicles entering the screen are already there. Null when too wide. */
function viewBox(): BBox | null {
  if (map.getZoom() < LIVE_MIN_ZOOM) return null;
  const b = map.getBounds();
  const padX = (b.getEast() - b.getWest()) * 0.15;
  const padY = (b.getNorth() - b.getSouth()) * 0.15;
  const box: BBox = [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];
  if (box[2] - box[0] > 1 || box[3] - box[1] > 1) return null;
  return box;
}

async function load() {
  if (!on() || document.visibilityState !== 'visible') return;
  const box = viewBox();
  if (!box) {
    liveVehicles.value = [];
    render();
    return;
  }
  ac?.abort();
  const mine = (ac = new AbortController());
  try {
    const res = await tools().call(transitVehiclesTool, { bbox: box, zoom: map.getZoom() }, { signal: mine.signal });
    if (mine.signal.aborted || !on()) return;
    liveVehicles.value = res.vehicles;
    liveSources.value = res.sources;
    failedOnce = false;
    render();
  } catch {
    if (mine.signal.aborted) return;
    if (!failedOnce) toast('לא הצלחנו לטעון תחבורה ציבורית בזמן אמת כרגע.');
    failedOnce = true;
  }
}

/** Positions now: GPS fixes as reported, computed vehicles moved along their legs. */
function positions(now: number) {
  const out: { v: LiveVehicle; lng: number; lat: number; bearing?: number }[] = [];
  for (const v of allVehicles()) {
    if (!v.legs?.length) {
      out.push({ v, lng: v.lng, lat: v.lat, bearing: v.bearing });
      continue;
    }
    // A trip that ended a minute ago has left the map.
    if (now > vehicleEndsAt(v) + 60_000) continue;
    const p = vehiclePositionAt(v, now);
    if (p) out.push({ v, lng: p.at[0], lat: p.at[1], bearing: p.bearing });
  }
  return out;
}

function collection(now: number) {
  return {
    type: 'FeatureCollection' as const,
    features: positions(now).map(({ v, lng, lat, bearing }) => {
      const c = lineColors(v.mode, v.color, v.textColor);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: { id: v.id, line: v.line, bg: c.bg, fg: c.fg, bearing: bearing ?? 0, heading: bearing !== undefined, estimate: v.source === 'schedule' },
      };
    }),
  };
}

const ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M18 4 29 22H7z" fill="#3c4043" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/></svg>`;

function addLayers(m: MapLibreMap) {
  if (m.getSource(SRC)) return;
  m.addSource(SRC, { type: 'geojson', data: collection(Date.now()) });
  if (!m.hasImage('live-arrow')) {
    const img = new Image(36, 36);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ARROW)}`;
    void img
      .decode()
      .then(() => !m.hasImage('live-arrow') && m.addImage('live-arrow', img, { pixelRatio: 2 }))
      .catch(() => {});
  }
  m.addLayer({
    id: 'live-vehicles-arrow',
    type: 'symbol',
    source: SRC,
    filter: ['==', ['get', 'heading'], true],
    layout: {
      'icon-image': 'live-arrow',
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      // The offset turns with the icon, so the arrow sits ahead of the dot.
      'icon-offset': [0, -13],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  m.addLayer({
    id: SELECTED_LAYER,
    type: 'circle',
    source: SRC,
    filter: ['==', ['get', 'id'], selected.peek() ?? ''],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 12, 16, 18], 'circle-color': ['get', 'bg'], 'circle-opacity': 0.25 },
  });
  m.addLayer({
    id: 'live-vehicles-dot',
    type: 'circle',
    source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 14, 8, 16, 11],
      'circle-color': ['get', 'bg'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      // Positions from the timetable alone are a guess: drawn lighter.
      'circle-opacity': ['case', ['get', 'estimate'], 0.65, 1],
      'circle-stroke-opacity': ['case', ['get', 'estimate'], 0.65, 1],
    },
  });
  m.addLayer({
    id: 'live-vehicles-label',
    type: 'symbol',
    source: SRC,
    minzoom: 14,
    layout: { 'text-field': ['get', 'line'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': ['get', 'fg'] },
  });
}

function removeLayers(m: MapLibreMap) {
  for (const id of [...LIVE_LAYERS, SELECTED_LAYER]) if (m.getLayer(id)) m.removeLayer(id);
  if (m.getSource(SRC)) m.removeSource(SRC);
}

function render() {
  if (!map.getSource(SRC)) return;
  const now = Date.now();
  (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(collection(now));
  const id = selected.peek();
  if (id && following.peek()) {
    const p = positions(now).find((x) => x.v.id === id);
    if (p) map.easeTo({ center: [p.lng, p.lat], duration: TICK_MS * 0.9 });
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
const onMove = () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void load(), 400);
};
const onVisible = () => document.visibilityState === 'visible' && void load();

function start() {
  if (map.isStyleLoaded()) addLayers(map);
  map.on('moveend', onMove);
  document.addEventListener('visibilitychange', onVisible);
  timer = setInterval(() => void load(), REFRESH_MS);
  tick = setInterval(render, TICK_MS);
  void load();
}

function stop() {
  map.off('moveend', onMove);
  document.removeEventListener('visibilitychange', onVisible);
  clearInterval(timer);
  clearInterval(tick);
  ac?.abort();
  liveVehicles.value = [];
  if (map.getStyle()) removeLayers(map);
}

export function setupLive(m: MapLibreMap, onStyle: (fn: (m: MapLibreMap) => void) => void) {
  map = m;
  let running = false;
  effect(() => {
    const want = mapLayers.value.transit;
    if (want && !running) start();
    else if (!want && running) stop();
    running = want;
  });
  onStyle((s) => {
    if (running) {
      addLayers(s);
      render();
    }
  });
  effect(() => {
    const id = selected.value;
    if (map.getLayer(SELECTED_LAYER)) map.setFilter(SELECTED_LAYER, ['==', ['get', 'id'], id ?? '']);
  });
}

/** A tap on a vehicle opens its card. */
export function onLiveClick(features: MapGeoJSONFeature[]): boolean | void {
  const f = features.find((x) => LIVE_LAYERS.includes(x.layer.id));
  const id = f?.properties?.id as string | undefined;
  if (!id || !allVehicles().some((v) => v.id === id)) return;
  open({ kind: 'vehicle', props: { id } });
  return true;
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'לפני פחות מדקה';
  const m = Math.round(s / 60);
  return m === 1 ? 'לפני דקה' : `לפני ${m} דק׳`;
}

function delayText(s?: number): string | null {
  if (s === undefined) return null;
  const m = Math.round(s / 60);
  if (m >= 1) return `${m} דק׳ איחור`;
  if (m <= -1) return `${-m} דק׳ מוקדם`;
  return 'בזמן';
}

const SOURCE_TEXT: Record<LiveVehicle['source'], string> = {
  gps: 'מיקום GPS שהאוטובוס דיווח',
  realtime: 'מיקום משוער לפי זמני אמת של המפעיל',
  schedule: 'מיקום משוער לפי לוח הזמנים (אין זמן אמת לקו הזה)',
};

/** The card of one vehicle: line, destination, how its position is known, next stop. */
function VehicleView({ view }: ViewProps<{ id: string }>) {
  const id = view.props?.id ?? '';
  useEffect(() => {
    selected.value = id;
    return () => {
      selected.value = null;
      following.value = false;
      if (pinned.peek()?.id === id) pinned.value = null;
    };
  }, [id]);
  // Re-render with the vehicles list (refresh) and every tick, for "updated … ago" and next stop.
  const v = findVehicle(id);
  const now = Date.now();
  const tz = region.value.timeZone;
  useTicker();
  if (!v) {
    return (
      <div class="view">
        <header class="view-header">
          <button class="icon-btn" aria-label="חזרה" onClick={back}>
            <Icon name="arrow_back" />
          </button>
          <h2>תחבורה בזמן אמת</h2>
        </header>
        <p class="muted small">הרכב כבר לא מופיע באזור המפה.</p>
      </div>
    );
  }
  const pos = vehiclePositionAt(v, now);
  const delay = delayText(v.delayS);
  return (
    <div class="view vehicle-view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2 class="vehicle-title">
          <LineChip mode={v.mode} line={v.line} color={v.color} textColor={v.textColor} />
          <span>{v.headsign ? `לכיוון ${v.headsign}` : TRANSIT_LABEL[v.mode]}</span>
        </h2>
      </header>
      <ul class="vehicle-facts">
        <li>
          <Icon name={v.source === 'schedule' ? 'schedule' : 'rss_feed'} size={18} class={v.source === 'schedule' ? '' : 'live-icon'} />
          <span>
            {SOURCE_TEXT[v.source]}
            {v.source === 'gps' && <span class="muted"> · {ago(v.at, now)}</span>}
          </span>
        </li>
        {v.arrival && (
          <li class="vehicle-arrival">
            <Icon name="departure_board" size={18} class="live-icon" />
            <span>
              {`מגיע ל${v.arrival.stop} ${formatDeparture(v.arrival.time, now, tz)}`}
              <span class="muted"> · {formatClock(v.arrival.time, tz)}</span>
            </span>
          </li>
        )}
        {delay && (
          <li>
            <Icon name="update" size={18} />
            <span class={v.delayS !== undefined && v.delayS >= 60 ? 'dep-late' : ''}>{delay}</span>
          </li>
        )}
        {pos?.nextStop && (
          <li>
            <Icon name="departure_board" size={18} />
            <span>
              התחנה הבאה: {pos.nextStop}
              {nextStopTime(v, now, tz)}
            </span>
          </li>
        )}
        {v.speedKph !== undefined && v.speedKph > 0 && (
          <li>
            <Icon name="speed" size={18} />
            <span>{`${Math.round(v.speedKph)} קמ״ש`}</span>
          </li>
        )}
        {(v.agency || v.mode) && (
          <li>
            <Icon name="directions_bus" size={18} />
            <span>{[TRANSIT_LABEL[v.mode], v.agency].filter(Boolean).join(' · ')}</span>
          </li>
        )}
      </ul>
      <div class="vehicle-actions">
        <button class="chip" aria-pressed={following.value} onClick={() => (following.value = !following.value)}>
          <Icon name="near_me" size={18} /> {following.value ? 'מפסיקים לעקוב' : 'עקבו אחרי הרכב'}
        </button>
      </div>
      <p class="muted tiny">
        {v.source === 'gps' ? 'מקור: Open Bus של הסדנא לידע ציבורי, מתוך נתוני משרד התחבורה.' : 'מקור: Transitous.'}
        {v.arrival && ' זמן ההגעה: SIRI של משרד התחבורה דרך curlbus.'}
      </p>
    </div>
  );
}

function nextStopTime(v: LiveVehicle, now: number, tz?: string): string {
  const leg = v.legs?.find((l) => Date.parse(l.end) >= now);
  return leg ? ` (${formatClock(leg.end, tz)})` : '';
}

/** Re-renders the component every tick. */
const clock = signal(0);
let clockTimer: ReturnType<typeof setInterval> | undefined;
let clockUsers = 0;
function useTicker() {
  void clock.value;
  useEffect(() => {
    if (clockUsers++ === 0) clockTimer = setInterval(() => (clock.value = Date.now()), TICK_MS * 5);
    return () => {
      if (--clockUsers === 0) clearInterval(clockTimer);
    };
  }, []);
}

export { VehicleView };
