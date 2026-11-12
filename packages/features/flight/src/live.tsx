import { computed, effect, signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { distance, formatArrival, formatDuration, greatCircle, type LngLat } from '@nm/core';
import { back, ensureLayer, EMPTY, Icon, isDark, open, providers, setGeoJSON, sheet, units, viewStack, type FeatureContext, type ViewProps } from '@nm/core/app';
import { clampBbox, coverCircles, flightPosition, flightRouteTool, liveFlights, tools, type AircraftPosition, type Bbox, type FlightRoute, type LiveAircraft } from '@nm/tools';
import { altitudeReadout, headingReadout, speedReadout } from './format.ts';
import { addLiveIcons, altitudeBand, BANDS, iconId } from './live-icons.ts';
import { EMERGENCY_SQUAWKS, filters, GROUPS, isFiltered, isSaved, KIND_NAME, NO_FILTERS, passes, savedFlights, setFilters, toggleSaved, type Group, type SavedFlight } from './live-filters.ts';

/**
 * Live flights: every aircraft in the air on the map, moving in real time, like the flight
 * trackers. Close up the positions come from adsb.lol every few seconds; zoomed out (up to the
 * whole world) from our relay's shared world cells (adsb.lol and adsb.fi, refreshed for every
 * viewer at once), or from OpenSky where there is no relay. Between updates planes glide on along their
 * track at their speed, so the map never looks frozen. Only the visible map area is sent.
 */

export const LIVE_VIEW = 'live-flights';
export const AIRCRAFT_VIEW = 'aircraft';

interface Feed extends LiveAircraft {
  /** When we received it (Date.now()). */
  receivedAt: number;
  /** The box that was asked for. */
  box: Bbox;
}

export const feed = signal<Feed | null>(null);
export const feedState = signal<'idle' | 'loading' | 'ok' | 'error'>('idle');
export const selectedHex = signal<string | null>(null);
export const followSelected = signal(true);
/** Extra details for the picked aircraft (type, registration) when the wide feed lacks them. */
const details = signal<Record<string, AircraftPosition>>({});
const trail = signal<{ hex: string; points: LngLat[] }>({ hex: '', points: [] });
/** Origin and destination of the picked flight (null route = unknown). */
const route = signal<{ hex: string; route: FlightRoute | null } | null>(null);
const now = signal(Date.now());

export const isLiveOn = computed(() => viewStack.value.some((v) => v.kind === LIVE_VIEW || v.kind === AIRCRAFT_VIEW));

/** Close-up refresh; adsb.lol positions are about a second old. */
const ADSB_EVERY_MS = 8000;
/** Wide refresh; OpenSky anonymous gives ~100 world-wide calls a day per IP. */
const OPENSKY_EVERY_MS = 60000;
/** Zoomed out with the relay: the shared world cells. Cells not fetched yet: ask again soon. */
const WORLD_EVERY_MS = 12000;
const WORLD_PENDING_MS = 3000;
/** Zoomed out while OpenSky is unavailable: adsb.lol around the middle of the map. */
const FALLBACK_EVERY_MS = 15000;
/** Planes glide on for at most this long without news, then stop where they were last seen. */
const MAX_GLIDE_S = 240;

export function openLiveFlights(replace = false) {
  open({ kind: LIVE_VIEW, props: { url: { panel: 'flights' } } }, { replace });
}

export function openAircraft(hex: string) {
  selectedHex.value = hex;
  followSelected.value = true;
  const top = viewStack.peek()[viewStack.peek().length - 1];
  open({ kind: AIRCRAFT_VIEW, props: { hex, url: { panel: 'flights' } } }, { replace: top?.kind === AIRCRAFT_VIEW });
}

// ---------- motion between updates ----------

const R = 6371000;

/** Where the aircraft is now, carried on along its track since its last position. */
export function glide(a: AircraftPosition, secondsSince: number): LngLat {
  if (a.onGround || !a.groundSpeedKmh || a.track === null) return a.lngLat;
  const t = Math.min(MAX_GLIDE_S, Math.max(0, secondsSince + (a.ageS ?? 0)));
  const d = (a.groundSpeedKmh / 3.6) * t;
  const [lng, lat] = a.lngLat;
  const brg = (a.track * Math.PI) / 180;
  const dLat = (d * Math.cos(brg)) / R;
  const dLng = (d * Math.sin(brg)) / (R * Math.cos((lat * Math.PI) / 180));
  const nlat = Math.max(-89.9, Math.min(89.9, lat + (dLat * 180) / Math.PI));
  let nlng = lng + (dLng * 180) / Math.PI;
  if (nlng > 180) nlng -= 360;
  if (nlng < -180) nlng += 360;
  return [nlng, nlat];
}

/** The picked aircraft as it is now (glided), with any extra details merged in. */
export const selected = computed<AircraftPosition | null>(() => {
  const hex = selectedHex.value;
  const f = feed.value;
  if (!hex || !f) return null;
  const a = f.aircraft.find((x) => x.hex === hex);
  if (!a) return null;
  const extra = details.value[hex];
  const merged: AircraftPosition = extra
    ? { ...a, type: a.type ?? extra.type, registration: a.registration ?? extra.registration, description: a.description ?? extra.description, operator: a.operator ?? extra.operator }
    : a;
  return { ...merged, lngLat: glide(a, (now.value - f.receivedAt) / 1000) };
});

// ---------- fetching ----------

let map: MapLibreMap;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let moveTimer: ReturnType<typeof setTimeout> | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let seq = 0;
let running = false;

function viewBox(pad: number): Bbox {
  const b = map.getBounds();
  const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  const px = (e - w) * pad, py = (n - s) * pad;
  return clampBbox([w - px, Math.max(-85, s - py), e + px, Math.min(85, n + py)]);
}

const inside = (a: Bbox, b: Bbox) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

/** Close-up feed for this box? Same rule as the tool, so the cadence matches the source. */
const closeUp = (box: Bbox) => !!providers.peek().flightsUrl && !!coverCircles(box);

async function refresh(force = false) {
  clearTimeout(refreshTimer);
  if (!running || !map) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    refreshTimer = setTimeout(() => void refresh(), 5000);
    return;
  }
  const tight = viewBox(0.1);
  const near = closeUp(tight);
  const last = feed.peek();
  const every = near ? ADSB_EVERY_MS : providers.peek().flightsRelayUrl ? WORLD_EVERY_MS : OPENSKY_EVERY_MS;
  // Zoomed out, panning inside what we already have costs no credits.
  if (!force && last && Date.now() - last.receivedAt < every && inside(tight, last.box) && (last.source === 'adsb') === near) {
    schedule(every - (Date.now() - last.receivedAt));
    return;
  }
  const box = near ? tight : viewBox(0.35);
  const s = ++seq;
  feedState.value = 'loading';
  try {
    const prevSel = selected.peek();
    const res = await tools().call(liveFlights, { bbox: box }, { cache: false });
    if (s !== seq || !running) return;
    const kept = await keepSelected(res.aircraft, prevSel);
    if (s !== seq || !running) return;
    feed.value = { ...res, aircraft: kept, receivedAt: Date.now(), box };
    feedState.value = 'ok';
    noteTrail();
  } catch {
    if (s !== seq || !running) return;
    feedState.value = 'error';
  }
  const got = feed.peek();
  // The fallback around the middle (OpenSky out) costs four calls: a little less often.
  schedule(
    got?.source === 'opensky'
      ? OPENSKY_EVERY_MS
      : got?.source === 'world'
        ? got.pending
          ? WORLD_PENDING_MS
          : WORLD_EVERY_MS
        : got?.partial
          ? FALLBACK_EVERY_MS
          : ADSB_EVERY_MS,
  );
}

/**
 * The plane being followed must not vanish when the wide feed (OpenSky) doesn't have it, or when
 * the map moves away: look it up close by from adsb.lol, else keep its last position briefly.
 */
async function keepSelected(list: AircraftPosition[], prev: AircraftPosition | null): Promise<AircraftPosition[]> {
  if (!prev) return list;
  if (list.some((a) => a.hex === prev.hex)) {
    lostSince = null;
    return list;
  }
  if (providers.peek().flightsUrl) {
    const [lng, lat] = prev.lngLat;
    try {
      const near = await tools().call(liveFlights, { bbox: [lng - 1, lat - 1, lng + 1, lat + 1] }, { cache: false });
      const found = near.aircraft.find((a) => a.hex === prev.hex);
      if (found) {
        lostSince = null;
        return [...list, found];
      }
    } catch {
      /* fall through */
    }
  }
  // Glide on from where it is now (prev is already glided), until it has been gone too long.
  if (lostSince?.hex !== prev.hex) lostSince = { hex: prev.hex, at: Date.now() };
  if (Date.now() - lostSince.at > MAX_GLIDE_S * 1000) return list;
  return [...list, { ...prev, ageS: 0 }];
}
let lostSince: { hex: string; at: number } | null = null;

function schedule(ms: number) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), Math.max(1000, ms));
}

function noteTrail() {
  const hex = selectedHex.peek();
  const a = hex ? feed.peek()?.aircraft.find((x) => x.hex === hex) : undefined;
  if (!hex || !a) return;
  const t = trail.peek();
  const pts = t.hex === hex ? t.points : [];
  const lastPt = pts[pts.length - 1];
  if (!lastPt || lastPt[0] !== a.lngLat[0] || lastPt[1] !== a.lngLat[1]) trail.value = { hex, points: [...pts, a.lngLat].slice(-500) };
}

/** Type and registration for a plane picked from the wide feed: ask the close-up feed around it. */
async function loadDetails(hex: string) {
  const a = feed.peek()?.aircraft.find((x) => x.hex === hex);
  if (!a || a.type || details.peek()[hex] || !providers.peek().flightsUrl) return;
  const [lng, lat] = a.lngLat;
  try {
    const res = await tools().call(liveFlights, { bbox: [lng - 0.5, lat - 0.5, lng + 0.5, lat + 0.5] }, { cache: false });
    const found = res.aircraft.find((x) => x.hex === hex);
    if (found) details.value = { ...details.peek(), [hex]: found };
  } catch {
    /* details are a bonus */
  }
}

/** Origin and destination for the picked flight (crowd-sourced; a bonus when it's there). */
async function loadRoute(hex: string) {
  const a = feed.peek()?.aircraft.find((x) => x.hex === hex);
  const cs = a?.callsign?.replace(/\s/g, '');
  if (route.peek()?.hex === hex) return;
  route.value = null;
  if (!a || !cs || cs.length < 3 || !/^[A-Z0-9]+$/i.test(cs) || !providers.peek().flightsUrl) return;
  try {
    const r = await tools().call(flightRouteTool, { callsign: cs, at: a.lngLat });
    if (selectedHex.peek() === hex) route.value = { hex, route: r && r.plausible ? r : null };
  } catch {
    if (selectedHex.peek() === hex) route.value = { hex, route: null };
  }
}

function start() {
  running = true;
  feedState.value = 'idle';
  void refresh(true);
  ticker = setInterval(tick, 1000);
  map.on('moveend', onMove);
  document.addEventListener('visibilitychange', onVisible);
}

function stop() {
  running = false;
  seq++;
  clearTimeout(refreshTimer);
  clearTimeout(moveTimer);
  clearInterval(ticker);
  map.off('moveend', onMove);
  document.removeEventListener('visibilitychange', onVisible);
  feed.value = null;
  feedState.value = 'idle';
  selectedHex.value = null;
  trail.value = { hex: '', points: [] };
  route.value = null;
  render();
}

const onMove = () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => void refresh(), 500);
};
const onVisible = () => {
  if (document.visibilityState === 'visible') void refresh();
};

let ticks = 0;
/**
 * Seconds between redraws of all planes. Every redraw re-sends them to the map worker, so with
 * thousands on screen we redraw less often; zoomed out a plane moves less than a pixel a second.
 */
export function redrawSeconds(planes: number, zoom: number): number {
  if (planes < 1500) return 1;
  if (zoom >= 7) return 1;
  if (zoom >= 5) return 2;
  return planes < 5000 ? 4 : 8;
}
const redrawEvery = () => redrawSeconds(feed.peek()?.aircraft.length ?? 0, map?.getZoom() ?? 0);

function tick() {
  now.value = Date.now();
  ticks++;
  if (ticks % redrawEvery() === 0) render();
  else renderSelected();
  followPlane();
}

function followPlane() {
  const a = selected.peek();
  if (!a || !followSelected.peek() || !map) return;
  const at = map.project(a.lngLat);
  const c = map.project(map.getCenter());
  if (Math.hypot(at.x - c.x, at.y - c.y) > 2) map.easeTo({ center: a.lngLat, duration: 900, easing: (t) => t });
}

// ---------- map ----------

const SRC = 'live-flights';
const SEL = 'live-flights-selected';
const PLANES = 'live-flights-planes';

/** The icon for an aircraft: its kind, in its altitude colour. */
const iconFor = (a: AircraftPosition) => iconId(a.kind ?? 'jet', altitudeBand(a));

function planesData(): Parameters<typeof setGeoJSON>[2] {
  const f = feed.peek();
  if (!f || !isLiveOn.peek()) return EMPTY;
  const dt = (Date.now() - f.receivedAt) / 1000;
  const sel = selectedHex.peek();
  const flt = filters.peek();
  const narrow = isFiltered(flt);
  const features = [];
  for (const a of f.aircraft) {
    if (a.hex === sel || (narrow && !passes(a, flt))) continue;
    features.push({
      type: 'Feature' as const,
      // Short keys: thousands of these are serialised to the map worker every few seconds.
      properties: { hex: a.hex, cs: a.callsign, h: a.track ?? 0, i: iconFor(a), g: a.onGround ? 0 : 1 },
      geometry: { type: 'Point' as const, coordinates: glide(a, dt) },
    });
  }
  return { type: 'FeatureCollection', features } as Parameters<typeof setGeoJSON>[2];
}

function selectedData(): Parameters<typeof setGeoJSON>[2] {
  const a = isLiveOn.peek() ? selected.peek() : null;
  if (!a) return EMPTY;
  const t = trail.peek();
  const features: unknown[] = [];
  const r = route.peek();
  if (r && r.hex === a.hex && r.route) {
    // Where it's going: a dashed great circle to the destination, and both airports.
    features.push({ type: 'Feature', properties: { kind: 'ahead' }, geometry: { type: 'LineString', coordinates: greatCircle(a.lngLat, r.route.to.lngLat, 40000) } });
    for (const [end, ap] of [['from', r.route.from], ['to', r.route.to]] as const)
      features.push({ type: 'Feature', properties: { kind: 'airport', end, code: ap.iata ?? ap.icao ?? '' }, geometry: { type: 'Point', coordinates: ap.lngLat } });
  }
  if (t.hex === a.hex) {
    const line = [...t.points, a.lngLat];
    if (line.length >= 2) features.push({ type: 'Feature', properties: { kind: 'trail' }, geometry: { type: 'LineString', coordinates: line } });
  }
  features.push({ type: 'Feature', properties: { kind: 'plane', hex: a.hex, cs: a.callsign, h: a.track ?? 0, i: iconFor(a) }, geometry: { type: 'Point', coordinates: a.lngLat } });
  return { type: 'FeatureCollection', features } as Parameters<typeof setGeoJSON>[2];
}

function render() {
  if (map?.getSource(SRC)) setGeoJSON(map, SRC, planesData());
  renderSelected();
}

function renderSelected() {
  if (map?.getSource(SEL)) setGeoJSON(map, SEL, selectedData());
}

/** Small over the whole world (thousands of planes), full size close up. */
const planeSize = ['interpolate', ['linear'], ['zoom'], 1, 0.42, 3, 0.55, 6, 0.75, 9, 1] as never;

function addLayers(m: MapLibreMap) {
  const dark = isDark.peek();
  addLiveIcons(m, dark);
  setGeoJSON(m, SRC, planesData());
  setGeoJSON(m, SEL, selectedData());
  const accent = dark ? '#a8c7fa' : '#0b57d0';
  const kind = (k: string) => ['==', ['get', 'kind'], k] as never;
  ensureLayer(m, {
    id: PLANES,
    type: 'symbol',
    source: SRC,
    layout: {
      'icon-image': ['get', 'i'] as never,
      'icon-size': planeSize,
      'icon-rotate': ['get', 'h'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // Planes in the air draw over the ones parked at the gate.
      'symbol-sort-key': ['get', 'g'] as never,
    },
  }, null);
  // Callsigns only close up, in their own layer so the world view never lays out text.
  ensureLayer(m, {
    id: 'live-flights-labels',
    type: 'symbol',
    source: SRC,
    minzoom: 7,
    layout: {
      'text-field': ['get', 'cs'],
      'text-size': 11,
      'text-offset': [0, 1.6],
      'text-anchor': 'top',
      'text-font': ['Noto Sans Regular'],
    },
    paint: { 'text-color': dark ? '#e8eaed' : '#3c4043', 'text-halo-color': dark ? '#1f1f1f' : '#ffffff', 'text-halo-width': 1.5 },
  }, null);
  ensureLayer(m, {
    id: 'live-flights-ahead',
    type: 'line',
    source: SEL,
    filter: kind('ahead'),
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [1.5, 2], 'line-opacity': 0.8 },
  }, null);
  ensureLayer(m, {
    id: 'live-flights-trail',
    type: 'line',
    source: SEL,
    filter: kind('trail'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': accent, 'line-width': 3, 'line-opacity': 0.9 },
  }, null);
  ensureLayer(m, {
    id: 'live-flights-airports',
    type: 'symbol',
    source: SEL,
    filter: kind('airport'),
    layout: {
      'text-field': ['get', 'code'],
      'text-size': 12,
      'text-font': ['Noto Sans Bold'],
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-allow-overlap': true,
    },
    paint: { 'text-color': accent, 'text-halo-color': dark ? '#1f1f1f' : '#ffffff', 'text-halo-width': 2 },
  }, null);
  ensureLayer(m, {
    id: 'live-flights-airport-dots',
    type: 'circle',
    source: SEL,
    filter: kind('airport'),
    paint: { 'circle-radius': 5, 'circle-color': dark ? '#1f1f1f' : '#ffffff', 'circle-stroke-color': accent, 'circle-stroke-width': 2.5 },
  }, null);
  // The picked plane: a soft halo under it, then the plane a size up.
  ensureLayer(m, {
    id: 'live-flights-halo',
    type: 'circle',
    source: SEL,
    filter: kind('plane'),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 13, 9, 22] as never,
      'circle-color': accent,
      'circle-opacity': 0.22,
      'circle-stroke-color': accent,
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.9,
    },
  }, null);
  ensureLayer(m, {
    id: 'live-flights-picked',
    type: 'symbol',
    source: SEL,
    filter: kind('plane'),
    layout: {
      'icon-image': ['get', 'i'] as never,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.8, 9, 1.25] as never,
      'icon-rotate': ['get', 'h'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  }, null);
}

export function setupLive(ctx: FeatureContext) {
  map = ctx.map;
  ctx.onStyle(addLayers);
  let was = false;
  effect(() => {
    const on = isLiveOn.value;
    if (on === was) return;
    was = on;
    if (on) start();
    else stop();
  });
  effect(() => {
    void selectedHex.value;
    void route.value;
    void trail.value;
    void feed.value;
    void filters.value;
    render();
  });
  ctx.onMapClick((_e, features) => {
    if (!isLiveOn.peek()) return;
    const f = features.find((x) => x.layer.id === PLANES || x.layer.id === 'live-flights-picked');
    const hex = f?.properties?.hex;
    if (typeof hex !== 'string' || !hex) return;
    openAircraft(hex);
    return true;
  }, 90);
  map.on('dragstart', () => {
    if (selectedHex.peek()) followSelected.value = false;
  });
}

// ---------- screens ----------

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} שנ׳` : `${Math.round(s / 60)} דק׳`;
}

function FeedStatus() {
  const f = feed.value;
  const st = feedState.value;
  if (!f) {
    return (
      <p class="live-status" role="status">
        {st === 'error' ? 'לא הצלחנו לטעון טיסות כרגע. ננסה שוב בעוד רגע.' : 'טוענים את הטיסות שבמפה…'}
      </p>
    );
  }
  const flt = filters.value;
  const shown = isFiltered(flt) ? f.aircraft.filter((a) => passes(a, flt)) : f.aircraft;
  const air = shown.filter((a) => !a.onGround).length;
  const sos = f.aircraft.filter((a) => a.squawk && EMERGENCY_SQUAWKS.has(a.squawk));
  const src = f.source === 'opensky' ? 'OpenSky' : f.source === 'world' ? 'adsb.lol · adsb.fi' : 'adsb.lol';
  return (
    <>
      <p class="live-status" role="status">
        {air === 1 ? (
          <>
            <strong>מטוס אחד</strong> באוויר במפה
          </>
        ) : (
          <>
            <strong>{air.toLocaleString('he-IL')}</strong> מטוסים באוויר במפה
          </>
        )}
        {shown.length > air && <span class="muted"> · {(shown.length - air).toLocaleString('he-IL')} על הקרקע</span>}
        {isFiltered(flt) && <span class="muted"> · מסונן</span>}
        <span class="muted">
          {' '}
          · עודכן לפני {ago(now.value - f.receivedAt)} · {src}
        </span>
        {st === 'error' && <span class="flight-error"> · העדכון האחרון נכשל</span>}
      </p>
      {f.note && <p class="small live-note">{f.note}</p>}
      {f.source === 'world' && f.pending ? <p class="small live-note">טוענים את שאר העולם, אזור אחרי אזור…</p> : null}
      {sos.length > 0 && (
        <button class="live-emergency live-sos" onClick={() => pickPlane(sos[0])}>
          <Icon name="warning" size={18} />
          {sos.length === 1 ? 'מטוס אחד משדר מצב חירום' : `${sos.length} מטוסים משדרים מצב חירום`}
          <span dir="ltr"> · {sos[0].callsign || sos[0].hex.toUpperCase()}</span>
        </button>
      )}
    </>
  );
}

/** Center the map on a plane and open its card. */
function pickPlane(a: AircraftPosition) {
  map.easeTo({ center: a.lngLat, zoom: Math.max(map.getZoom(), 6), duration: 800 });
  openAircraft(a.hex);
}

/** Look a flight up by callsign wherever it is, put it in the feed and open it. */
async function findAndOpen(callsign: string): Promise<boolean> {
  const res = await tools().call(flightPosition, { callsign }, { cache: false });
  const a = res.aircraft[0];
  if (!a) return false;
  // Put it in the feed so it shows and can be followed until the next update.
  const cur = feed.peek();
  if (cur && !cur.aircraft.some((x) => x.hex === a.hex)) feed.value = { ...cur, aircraft: [...cur.aircraft, { ...a }], receivedAt: cur.receivedAt };
  map.jumpTo({ center: a.lngLat, zoom: Math.max(map.getZoom(), 6) });
  openAircraft(a.hex);
  return true;
}

function FindLive() {
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const f = feed.value;
  const norm = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
  const needle = norm(q);
  const local = needle.length >= 2 && f ? f.aircraft.filter((a) => norm(a.callsign).startsWith(needle) || norm(a.registration ?? '') === needle).slice(0, 6) : [];
  const pick = pickPlane;
  const submit = async (e: Event) => {
    e.preventDefault();
    setMsg('');
    if (local[0]) return pick(local[0]);
    if (!providers.peek().flightsUrl || needle.length < 2) return;
    setBusy(true);
    try {
      if (!(await findAndOpen(q.trim()))) setMsg('הטיסה לא נמצאה באוויר כרגע.');
    } catch {
      setMsg('שירות הטיסות לא זמין כרגע.');
    }
    setBusy(false);
  };
  return (
    <form class="live-find" onSubmit={submit}>
      <input
        class="flight-input"
        dir="ltr"
        autoCapitalize="characters"
        placeholder="LY001, ELY001, 4X-EDF"
        aria-label="חיפוש טיסה לפי מספר"
        maxLength={10}
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      <button class="btn" type="submit" disabled={busy || needle.length < 2}>
        חיפוש
      </button>
      {local.length > 0 && (
        <ul class="flight-results" aria-label="טיסות">
          {local.map((a) => (
            <li key={a.hex}>
              <button type="button" class="flight-result" onClick={() => pick(a)}>
                <Icon name="flight" size={20} />
                <span class="flight-result-name" dir="ltr">
                  {a.callsign || a.hex.toUpperCase()}
                </span>
                {a.type && (
                  <span class="flight-code" dir="ltr">
                    {a.type}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p class="small flight-error">{msg}</p>}
    </form>
  );
}

/** The colour scale: what each plane colour means, in the user's units. */
function AltitudeLegend() {
  const imperial = units.value === 'imperial';
  const label = (m: number) => (imperial ? `${Math.round((m * 3.28084) / 1000)}K` : `${m / 1000}`);
  return (
    <div class="live-legend" aria-label="צבע המטוס לפי גובה">
      <div class="live-legend-title muted small">גובה ({imperial ? 'אלפי רגל' : 'ק״מ'})</div>
      <div class="live-legend-bar" dir="ltr">
        {BANDS.map((b, i) => (
          <span key={i} style={{ background: b.color }} />
        ))}
      </div>
      <div class="live-legend-labels small" dir="ltr">
        <span>{BANDS[0].label}</span>
        {BANDS.slice(1, -1).map((b) => (
          <span key={b.upToM}>{label(b.upToM)}</span>
        ))}
      </div>
    </div>
  );
}

const EMERGENCY: Record<string, string> = { '7700': 'מצב חירום', '7600': 'תקלת קשר', '7500': 'חטיפה' };

/** Origin → destination, how far is left and when it should land. */
function RouteLine({ a }: { a: AircraftPosition }) {
  const r = route.value;
  if (!r || r.hex !== a.hex) return null;
  if (!r.route) return null;
  const { from, to } = r.route;
  const left = distance(a.lngLat, to.lngLat);
  const v = a.groundSpeedKmh ? a.groundSpeedKmh / 3.6 : null;
  const eta = !a.onGround && v && v > 50 ? left / v : null;
  const km = units.value === 'imperial' ? `${Math.round(left / 1609.34).toLocaleString('en-US')} מייל` : `${Math.round(left / 1000).toLocaleString('en-US')} ק״מ`;
  const place = (ap: typeof from) => ap.city || ap.name;
  return (
    <div class="live-route">
      <div class="live-route-end">
        <span class="live-route-code" dir="ltr">{from.iata ?? from.icao}</span>
        <span class="live-route-city">{place(from)}</span>
      </div>
      <Icon name="arrow_forward" class="live-route-arrow" />
      <div class="live-route-end to">
        <span class="live-route-code" dir="ltr">{to.iata ?? to.icao}</span>
        <span class="live-route-city">{place(to)}</span>
      </div>
      <div class="live-route-left small muted">
        נשארו <span dir="ltr">{km}</span>
        {eta !== null && (
          <>
            {' · '}נחיתה משוערת <span dir="ltr">{formatArrival(eta)}</span> (עוד {formatDuration(eta)})
          </>
        )}
      </div>
    </div>
  );
}

const ALTITUDES: { id: string; label: string; minM: number | null; maxM: number | null }[] = [
  { id: 'all', label: 'כל הגבהים', minM: null, maxM: null },
  { id: 'low', label: 'נמוך (עד 3 ק״מ)', minM: null, maxM: 3000 },
  { id: 'mid', label: 'בינוני (3–9 ק״מ)', minM: 3000, maxM: 9000 },
  { id: 'high', label: 'גבוה (מעל 9 ק״מ)', minM: 9000, maxM: null },
];

/** Narrow the map: by kind, altitude, airline, only in the air, only emergencies. Free, unlike the big trackers. */
function LiveFilters() {
  const [openPanel, setOpen] = useState(false);
  const f = filters.value;
  const on = isFiltered(f);
  const toggle = (g: Group) => setFilters({ hide: f.hide.includes(g) ? f.hide.filter((x) => x !== g) : [...f.hide, g] });
  const alt = ALTITUDES.find((x) => x.minM === f.minM && x.maxM === f.maxM)?.id ?? 'all';
  return (
    <div class="live-filters">
      <div class="chips flight-chips">
        <button class="chip" aria-expanded={openPanel} aria-pressed={on} onClick={() => setOpen(!openPanel)}>
          <Icon name="tune" />
          סינון{on ? ' (פעיל)' : ''}
        </button>
        {on && (
          <button class="chip" onClick={() => setFilters(NO_FILTERS)}>
            <Icon name="close" />
            ניקוי
          </button>
        )}
      </div>
      {openPanel && (
        <div class="live-filter-panel" role="group" aria-label="סינון מטוסים">
          <div class="chips">
            {GROUPS.map((g) => (
              <button key={g.id} class="chip" aria-pressed={!f.hide.includes(g.id)} onClick={() => toggle(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
          <div class="chips">
            <button class="chip" aria-pressed={f.air} onClick={() => setFilters({ air: !f.air })}>
              רק באוויר
            </button>
            <button class="chip" aria-pressed={f.emergency} onClick={() => setFilters({ emergency: !f.emergency })}>
              <Icon name="warning" />
              רק מצבי חירום
            </button>
          </div>
          <label class="live-filter-row">
            <span>גובה</span>
            <select value={alt} onChange={(e) => {
              const x = ALTITUDES.find((a) => a.id === (e.target as HTMLSelectElement).value) ?? ALTITUDES[0];
              setFilters({ minM: x.minM, maxM: x.maxM });
            }}>
              {ALTITUDES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label class="live-filter-row">
            <span>חברת תעופה</span>
            <input
              class="flight-input"
              dir="ltr"
              autoCapitalize="characters"
              placeholder="ELY, UAE, RYR"
              maxLength={4}
              value={f.airline}
              onInput={(e) => setFilters({ airline: (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** Flights the user saved: tap to find them in the air. */
function SavedFlights() {
  const list = savedFlights.value;
  const f = feed.value;
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  if (!list.length) return null;
  const go = async (s: SavedFlight) => {
    setMsg('');
    const here = f?.aircraft.find((a) => a.hex === s.hex || (!!s.callsign && a.callsign === s.callsign));
    if (here) return pickPlane(here);
    if (!s.callsign) return setMsg('המטוס לא נקלט כרגע.');
    setBusy(s.hex);
    try {
      if (!(await findAndOpen(s.callsign))) setMsg(`${s.callsign} לא באוויר כרגע.`);
    } catch {
      setMsg('שירות הטיסות לא זמין כרגע.');
    }
    setBusy('');
  };
  return (
    <section class="live-saved" aria-label="הטיסות שלי">
      <h3 class="small muted">הטיסות שלי</h3>
      <ul class="flight-results">
        {list.map((s) => {
          const live = f?.aircraft.some((a) => a.hex === s.hex || (!!s.callsign && a.callsign === s.callsign));
          return (
            <li key={s.hex}>
              <button type="button" class="flight-result" disabled={busy === s.hex} onClick={() => void go(s)}>
                <Icon name="bookmark" size={20} />
                <span class="flight-result-name" dir="ltr">
                  {s.callsign || s.hex.toUpperCase()}
                </span>
                {s.label && (
                  <span class="flight-code" dir="ltr">
                    {s.label}
                  </span>
                )}
                {live && <span class="live-dot" aria-label="באוויר במפה" />}
              </button>
            </li>
          );
        })}
      </ul>
      {msg && <p class="small flight-error">{msg}</p>}
    </section>
  );
}

interface Photo {
  src: string;
  link: string;
  by: string;
  w: number;
  h: number;
}
const photos = new Map<string, Photo | null>();

/**
 * A photo of this very aircraft from Planespotters.net, read straight from the browser and shown
 * as their terms ask: unchanged, linked to its page, with the photographer's name.
 */
function PlanePhoto({ hex }: { hex: string }) {
  const base = providers.value.planePhotosUrl.replace(/\/$/, '');
  const [p, setP] = useState<Photo | null | undefined>(photos.get(hex));
  useEffect(() => {
    if (!base || !/^[0-9a-f]{6}$/.test(hex)) return setP(null);
    if (photos.has(hex)) return setP(photos.get(hex));
    let live = true;
    setP(undefined);
    fetch(`${base}/hex/${hex}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { photos?: { thumbnail_large?: { src?: string; size?: { width?: number; height?: number } }; link?: string; photographer?: string }[] } | null) => {
        const x = j?.photos?.[0];
        const t = x?.thumbnail_large;
        const photo = t?.src && x?.link ? { src: t.src, link: x.link, by: x.photographer ?? '', w: t.size?.width ?? 420, h: t.size?.height ?? 280 } : null;
        photos.set(hex, photo);
        if (live) setP(photo);
      })
      .catch(() => live && setP(null));
    return () => {
      live = false;
    };
  }, [hex, base]);
  if (!p) return null;
  return (
    <figure class="live-photo">
      <a href={p.link} target="_blank">
        <img src={p.src} width={p.w} height={p.h} alt="תמונה של המטוס" loading="lazy" />
      </a>
      <figcaption class="small muted">
        צילום: <span dir="auto">{p.by}</span> ·{' '}
        <a href={p.link} target="_blank">
          Planespotters.net
        </a>
      </figcaption>
    </figure>
  );
}

export function LiveFlightsView(_: ViewProps) {
  useEffect(() => {
    if (sheet.peek() === 'full') sheet.value = 'half';
  }, []);
  return (
    <div class="view flight live-flights">
      <div class="flight-head">
        <Icon name="travel_explore" class="flight-logo" />
        <h2>טיסות בעולם</h2>
        <button class="icon-btn" aria-label="סגירה" title="סגירה" onClick={back}>
          <Icon name="close" />
        </button>
      </div>
      <FeedStatus />
      <div class="chips flight-chips">
        <button class="chip" onClick={() => map.easeTo({ center: [20, 25], zoom: 1.3, bearing: 0, pitch: 0, duration: 900 })}>
          <Icon name="public" />
          כל העולם
        </button>
        <button class="chip" onClick={() => open({ kind: 'flight', props: { url: { panel: 'flight' } } })}>
          <Icon name="flight" />
          אני בטיסה
        </button>
      </div>
      <FindLive />
      <LiveFilters />
      <SavedFlights />
      <AltitudeLegend />
      <p class="muted small flight-privacy">
        הקישו על מטוס לפרטים ולמעקב. במבט קרוב המיקומים מתעדכנים כל כמה שניות; במבט רחוק, עד כל העולם, אזור אחרי אזור, ובין העדכונים המטוסים ממשיכים לנוע. נשלח רק אזור המפה שעל המסך, לא המיקום שלכם.
        נתונים: adsb.lol (ODbL), adsb.fi ו-OpenSky Network.
      </p>
    </div>
  );
}

export function AircraftView({ view }: ViewProps<{ hex: string }>) {
  const hex = view.props?.hex ?? '';
  useEffect(() => {
    if (selectedHex.peek() !== hex) selectedHex.value = hex;
    void loadDetails(hex);
    void loadRoute(hex);
    if (sheet.peek() === 'peek') sheet.value = 'half';
    // Leaving the card (back, or another screen replacing it) un-picks the plane.
    return () => {
      if (selectedHex.peek() === hex) selectedHex.value = null;
    };
  }, [hex]);
  const a = selected.value;
  const f = feed.value;
  const u = units.value;
  const close = back;
  if (!a) {
    return (
      <div class="view flight live-flights">
        <div class="flight-head">
          <Icon name="flight" class="flight-logo" />
          <h2 dir="ltr">{hex.toUpperCase()}</h2>
          <button class="icon-btn" aria-label="סגירה" title="סגירה" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <p class="live-status">{f ? 'המטוס יצא מהטווח או הפסיק לשדר. אולי ייקלט שוב בעדכון הבא.' : 'טוענים…'}</p>
      </div>
    );
  }
  const alt = altitudeReadout(a.altitudeM, u);
  const spd = speedReadout(a.groundSpeedKmh === null ? null : a.groundSpeedKmh / 3.6, u);
  const hdg = headingReadout(a.track);
  const vr = a.verticalRateMs ?? null;
  const climb = vr === null || Math.abs(vr) < 1 ? null : vr > 0 ? 'עולה' : 'יורד';
  const vrText = vr === null ? '' : u === 'imperial' ? `${Math.round(Math.abs(vr) * 196.85).toLocaleString('en-US')} רגל/דק׳` : `${Math.abs(vr).toFixed(1)} מ׳/שנ׳`;
  const age = f ? (now.value - f.receivedAt) / 1000 + (a.ageS ?? 0) : null;
  return (
    <div class="view flight live-flights">
      <div class="flight-head">
        <Icon name="flight" class="flight-logo" />
        <h2 dir="ltr" class="live-callsign">
          {a.callsign || hex.toUpperCase()}
        </h2>
        <button class="icon-btn" aria-label="סגירה" title="סגירה" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <PlanePhoto hex={a.hex} />
      {(a.kind || a.military) && (
        <p class="live-kind small muted">
          {a.kind ? KIND_NAME[a.kind] : ''}
          {a.military && ' · צבאי'}
        </p>
      )}
      {(a.description || a.type || a.registration || a.operator || a.country) && (
        <p class="live-model">
          {a.description ?? a.type}
          {(a.registration || a.operator || a.country) && (
            <span class="muted">
              {(a.description || a.type) && ' · '}
              <span dir="ltr">{[a.registration, a.operator].filter(Boolean).join(' · ')}</span>
              {a.country && !a.registration && a.country}
            </span>
          )}
        </p>
      )}
      {a.squawk && EMERGENCY[a.squawk] && (
        <p class="live-emergency" role="status">
          <Icon name="warning" size={18} />
          המטוס משדר קוד {a.squawk}: {EMERGENCY[a.squawk]}
        </p>
      )}
      <RouteLine a={a} />
      <div class="flight-grid">
        <div class="flight-stat">
          <div class="flight-stat-label">
            <Icon name="height" size={16} />
            גובה
          </div>
          <div class="flight-stat-value">
            {a.onGround ? (
              'על הקרקע'
            ) : (
              <>
                <span dir="ltr">{alt.value}</span>
                <span class="flight-unit">{alt.unit}</span>
              </>
            )}
          </div>
          {climb && (
            <div class="flight-stat-sub">
              <Icon name={vr! > 0 ? 'trending_up' : 'trending_down'} size={14} /> {climb} <span dir="ltr">{vrText}</span>
            </div>
          )}
        </div>
        <div class="flight-stat">
          <div class="flight-stat-label">
            <Icon name="speed" size={16} />
            מהירות קרקע
          </div>
          <div class="flight-stat-value">
            <span dir="ltr">{spd.value}</span>
            <span class="flight-unit">{spd.unit}</span>
          </div>
        </div>
        <div class="flight-stat">
          <div class="flight-stat-label">
            <Icon name="explore" size={16} />
            כיוון
          </div>
          <div class="flight-stat-value">
            <span dir="ltr">{hdg.value}</span>
            {hdg.unit && <span class="flight-unit">{hdg.unit}</span>}
          </div>
          {hdg.sub && <div class="flight-stat-sub">{hdg.sub}</div>}
        </div>
        <div class="flight-stat">
          <div class="flight-stat-label">
            <Icon name="radar" size={16} />
            קוד ICAO
          </div>
          <div class="flight-stat-value live-hex" dir="ltr">
            {a.hex.toUpperCase()}
          </div>
          {age !== null && <div class="flight-stat-sub">נקלט לפני {ago(age * 1000)}</div>}
        </div>
      </div>
      <div class="chips flight-chips">
        <button
          class="chip"
          aria-pressed={followSelected.value}
          onClick={() => {
            followSelected.value = !followSelected.value;
            if (followSelected.value) followPlane();
          }}
        >
          <Icon name="my_location" />
          {followSelected.value ? 'המפה עוקבת' : 'מעקב כבוי'}
        </button>
        <button class="chip" aria-pressed={isSaved(a)} onClick={() => toggleSaved(a)}>
          <Icon name={isSaved(a) ? 'bookmark' : 'bookmark_outline'} />
          {isSaved(a) ? 'שמורה' : 'שמירת הטיסה'}
        </button>
        {a.callsign && (
          <a class="chip" href={`https://globe.adsb.lol/?icao=${encodeURIComponent(a.hex)}`} target="_blank" rel="noopener">
            <Icon name="open_in_new" />
            מסלול מלא ב-adsb.lol
          </a>
        )}
      </div>
      <p class="muted small flight-privacy">
        הקו הכחול הוא הדרך שהמטוס עשה מאז שפתחתם אותו. בין העדכונים המטוס ממשיך לנוע לפי המהירות והכיוון האחרונים.
      </p>
    </div>
  );
}

/** The round map button that shows (and hides) every flight, next to the layers button. */
export function LiveFlightsButton() {
  const on = isLiveOn.value;
  return (
    <button
      class={`ctrl live-ctrl${on ? ' on' : ''}`}
      aria-label={on ? 'הסתרת הטיסות' : 'טיסות בזמן אמת'}
      title={on ? 'הסתרת הטיסות' : 'טיסות בזמן אמת'}
      aria-pressed={on}
      onClick={() => {
        if (!on) return openLiveFlights();
        // Close every flights screen on the stack, top first.
        const stack = viewStack.peek();
        let n = 0;
        for (let i = stack.length - 1; i >= 0 && (stack[i].kind === LIVE_VIEW || stack[i].kind === AIRCRAFT_VIEW); i--) n++;
        if (n) for (let i = 0; i < n; i++) back();
        else openLiveFlights();
      }}
    >
      <Icon name="flight" size={22} />
    </button>
  );
}
