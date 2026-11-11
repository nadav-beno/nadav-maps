import { computed, effect, signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LngLat } from '@nm/core';
import { back, ensureLayer, EMPTY, Icon, isDark, open, providers, setGeoJSON, sheet, units, viewStack, type FeatureContext, type ViewProps } from '@nm/core/app';
import { clampBbox, coverCircles, flightPosition, liveFlights, tools, type AircraftPosition, type Bbox, type LiveAircraft } from '@nm/tools';
import { altitudeReadout, headingReadout, speedReadout } from './format.ts';
import { addPlaneImages } from './plane-image.ts';

/**
 * Live flights: every aircraft in the air on the map, moving in real time, like the flight
 * trackers. Close up the positions come from adsb.lol every few seconds; zoomed out (up to the
 * whole world) from OpenSky about once a minute. Between updates planes glide on along their
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
const now = signal(Date.now());

export const isLiveOn = computed(() => viewStack.value.some((v) => v.kind === LIVE_VIEW || v.kind === AIRCRAFT_VIEW));

/** Close-up refresh; adsb.lol positions are about a second old. */
const ADSB_EVERY_MS = 8000;
/** Wide refresh; OpenSky anonymous gives ~100 world-wide calls a day per IP. */
const OPENSKY_EVERY_MS = 60000;
/** Zoomed out while OpenSky is unavailable: adsb.lol around the middle of the map. */
const FALLBACK_EVERY_MS = 15000;
/** Planes glide on for at most this long without news, then stop where they were last seen. */
const MAX_GLIDE_S = 90;

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
  const every = near ? ADSB_EVERY_MS : OPENSKY_EVERY_MS;
  // Zoomed out, panning inside what we already have costs no credits.
  if (!force && last && Date.now() - last.receivedAt < every && inside(tight, last.box) && (last.source === 'adsb') === near) {
    schedule(every - (Date.now() - last.receivedAt));
    return;
  }
  const box = near ? tight : viewBox(0.35);
  const s = ++seq;
  feedState.value = 'loading';
  try {
    const res = await tools().call(liveFlights, { bbox: box }, { cache: false });
    if (s !== seq || !running) return;
    feed.value = { ...res, receivedAt: Date.now(), box };
    feedState.value = 'ok';
    noteTrail();
  } catch {
    if (s !== seq || !running) return;
    feedState.value = 'error';
  }
  const got = feed.peek();
  // The fallback around the middle (OpenSky out) costs four calls: a little less often.
  schedule(got?.source === 'opensky' ? OPENSKY_EVERY_MS : got?.partial ? FALLBACK_EVERY_MS : ADSB_EVERY_MS);
}

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
function tick() {
  now.value = Date.now();
  // Thousands of planes on a world map barely move per second: redraw them less often.
  const n = feed.peek()?.aircraft.length ?? 0;
  ticks++;
  if (n < 3000 || ticks % 3 === 0) render();
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

function planesData(): Parameters<typeof setGeoJSON>[2] {
  const f = feed.peek();
  if (!f || !isLiveOn.peek()) return EMPTY;
  const dt = (Date.now() - f.receivedAt) / 1000;
  const sel = selectedHex.peek();
  return {
    type: 'FeatureCollection',
    features: f.aircraft
      .filter((a) => a.hex !== sel)
      .map((a) => ({
        type: 'Feature' as const,
        properties: { hex: a.hex, cs: a.callsign, h: a.track ?? 0, g: a.onGround ? 1 : 0 },
        geometry: { type: 'Point' as const, coordinates: glide(a, dt) },
      })),
  } as Parameters<typeof setGeoJSON>[2];
}

function selectedData(): Parameters<typeof setGeoJSON>[2] {
  const a = isLiveOn.peek() ? selected.peek() : null;
  if (!a) return EMPTY;
  const t = trail.peek();
  const features: unknown[] = [];
  if (t.hex === a.hex) {
    const line = [...t.points, a.lngLat];
    if (line.length >= 2) features.push({ type: 'Feature', properties: { kind: 'trail' }, geometry: { type: 'LineString', coordinates: line } });
  }
  features.push({ type: 'Feature', properties: { kind: 'plane', hex: a.hex, cs: a.callsign, h: a.track ?? 0 }, geometry: { type: 'Point', coordinates: a.lngLat } });
  return { type: 'FeatureCollection', features } as Parameters<typeof setGeoJSON>[2];
}

function render() {
  if (map?.getSource(SRC)) setGeoJSON(map, SRC, planesData());
  renderSelected();
}

function renderSelected() {
  if (map?.getSource(SEL)) setGeoJSON(map, SEL, selectedData());
}

const planeSize = ['interpolate', ['linear'], ['zoom'], 1, 0.3, 3, 0.4, 5, 0.55, 9, 0.85] as never;

function addLayers(m: MapLibreMap) {
  addPlaneImages(m, isDark.peek());
  setGeoJSON(m, SRC, planesData());
  setGeoJSON(m, SEL, selectedData());
  const dark = isDark.peek();
  ensureLayer(m, {
    id: PLANES,
    type: 'symbol',
    source: SRC,
    layout: {
      'icon-image': ['case', ['==', ['get', 'g'], 1], 'live-plane-ground', 'live-plane'] as never,
      'icon-size': planeSize,
      'icon-rotate': ['get', 'h'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'g'] as never,
      'text-field': ['step', ['zoom'], '', 7, ['get', 'cs']] as never,
      'text-size': 11,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-optional': true,
      'text-font': ['Noto Sans Regular'],
    },
    paint: { 'text-color': dark ? '#e8eaed' : '#3c4043', 'text-halo-color': dark ? '#1f1f1f' : '#ffffff', 'text-halo-width': 1.5 },
  }, null);
  ensureLayer(m, {
    id: 'live-flights-trail',
    type: 'line',
    source: SEL,
    filter: ['==', ['get', 'kind'], 'trail'] as never,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#a8c7fa' : '#0b57d0', 'line-width': 3, 'line-opacity': 0.85 },
  }, null);
  ensureLayer(m, {
    id: 'live-flights-picked',
    type: 'symbol',
    source: SEL,
    filter: ['==', ['get', 'kind'], 'plane'] as never,
    layout: {
      'icon-image': 'live-plane-selected',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 9, 1.05] as never,
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
    void trail.value;
    void feed.value;
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
  const air = f.aircraft.filter((a) => !a.onGround).length;
  const src = f.source === 'opensky' ? 'OpenSky' : 'adsb.lol';
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
        {f.aircraft.length > air && <span class="muted"> · {(f.aircraft.length - air).toLocaleString('he-IL')} על הקרקע</span>}
        <span class="muted">
          {' '}
          · עודכן לפני {ago(now.value - f.receivedAt)} · {src}
        </span>
        {st === 'error' && <span class="flight-error"> · העדכון האחרון נכשל</span>}
      </p>
      {f.note && <p class="small live-note">{f.note}</p>}
    </>
  );
}

function FindLive() {
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const f = feed.value;
  const norm = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
  const needle = norm(q);
  const local = needle.length >= 2 && f ? f.aircraft.filter((a) => norm(a.callsign).startsWith(needle) || norm(a.registration ?? '') === needle).slice(0, 6) : [];
  const pick = (a: AircraftPosition) => {
    map.easeTo({ center: a.lngLat, zoom: Math.max(map.getZoom(), 6), duration: 800 });
    openAircraft(a.hex);
  };
  const submit = async (e: Event) => {
    e.preventDefault();
    setMsg('');
    if (local[0]) return pick(local[0]);
    if (!providers.peek().flightsUrl || needle.length < 2) return;
    setBusy(true);
    try {
      const res = await tools().call(flightPosition, { callsign: q.trim() }, { cache: false });
      const a = res.aircraft[0];
      if (!a) setMsg('הטיסה לא נמצאה באוויר כרגע.');
      else {
        // Put it in the feed so it shows and can be followed until the next update.
        const cur = feed.peek();
        if (cur && !cur.aircraft.some((x) => x.hex === a.hex)) feed.value = { ...cur, aircraft: [...cur.aircraft, { ...a }], receivedAt: cur.receivedAt };
        map.jumpTo({ center: a.lngLat, zoom: Math.max(map.getZoom(), 6) });
        openAircraft(a.hex);
      }
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
      <p class="muted small flight-privacy">
        הקישו על מטוס לפרטים ולמעקב. במבט קרוב המיקומים מתעדכנים כל כמה שניות, ובמבט על כל העולם בערך פעם בדקה. נשלח רק אזור המפה שעל המסך, לא המיקום שלכם.
        נתונים: adsb.lol (ODbL) ו-OpenSky Network.
      </p>
    </div>
  );
}

export function AircraftView({ view }: ViewProps<{ hex: string }>) {
  const hex = view.props?.hex ?? '';
  useEffect(() => {
    if (selectedHex.peek() !== hex) selectedHex.value = hex;
    void loadDetails(hex);
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
