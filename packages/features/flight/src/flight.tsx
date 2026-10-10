import { computed, effect, signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { distance, formatArrival, formatDuration, greatCircle, searchWorld, worldName, type LngLat, type World } from '@nm/core';
import {
  back,
  cssVar,
  EMPTY,
  ensureLayer,
  Icon,
  isDark,
  load,
  loadWorld,
  offlineMapOnly,
  open,
  providers,
  save,
  setGeoJSON,
  sheet,
  toast,
  units,
  viewStack,
  type FeatureContext,
  type ViewProps,
} from '@nm/core/app';
import { flightPosition, searchPlaces, tools, type AircraftPosition } from '@nm/tools';
import { aboveText, altitudeReadout, distanceReadout, formatElapsed, formatLatLng, headingReadout, speedReadout, type Readout } from './format.ts';
import { addFix, etaSeconds, newLog, type FlightLog } from './track.ts';
import { addPlaneImages } from './plane-image.ts';

/**
 * Flight mode: see yourself on the map in a plane. GPS works in airplane mode (no network
 * needed), the world map ships with the app, and everything here stays on the device.
 */
export interface Destination {
  name: string;
  lngLat: LngLat;
  /** IATA code for airports. */
  code?: string;
}

type GpsState = 'searching' | 'ok' | 'denied' | 'unavailable';

const LOG_KEY = 'flight.log';
/** A log older than this is a different trip. */
const STALE_MS = 20 * 3600_000;

export const flightLog = signal<FlightLog>(newLog());
export const gps = signal<GpsState>('searching');
export const following = signal(true);
export const worldOnly = signal<boolean>(load('flight.worldOnly', true));
export const destination = signal<Destination | null>(load<Destination | null>('flight.dest', null));
export const adsb = signal<{ query: string; aircraft: AircraftPosition | null; at: number; error?: string } | null>(null);
const world = signal<World | null>(null);
const online = signal(typeof navigator === 'undefined' || navigator.onLine !== false);
const now = signal(Date.now());

export const isFlightOn = computed(() => viewStack.value.some((v) => v.kind === 'flight'));

worldOnly.subscribe((v) => save('flight.worldOnly', v));
destination.subscribe((v) => save('flight.dest', v));

/** Where we are: the GPS when it has a fix, otherwise the aircraft found by flight number. */
const position = computed<{ lngLat: LngLat; heading: number | null; source: 'gps' | 'adsb' } | null>(() => {
  const last = flightLog.value.last;
  if (last) return { lngLat: last.lngLat, heading: flightLog.value.heading, source: 'gps' };
  const a = adsb.value?.aircraft;
  if (a) return { lngLat: a.lngLat, heading: a.track, source: 'adsb' };
  return null;
});

export function startFlight(replace = false) {
  open({ kind: 'flight', props: { url: { panel: 'flight' } } }, { replace });
}

// ---------- GPS, wake lock, timers ----------

let map: MapLibreMap;
let watchId: number | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;
let adsbTimer: ReturnType<typeof setInterval> | undefined;
let lastSaved = 0;
let centeredOnce = false;

function saveLog(force = false) {
  if (!force && Date.now() - lastSaved < 15000) return;
  lastSaved = Date.now();
  save(LOG_KEY, flightLog.peek());
}

function onPosition(pos: GeolocationPosition) {
  const c = pos.coords;
  gps.value = 'ok';
  flightLog.value = addFix(flightLog.peek(), {
    lngLat: [c.longitude, c.latitude],
    t: pos.timestamp || Date.now(),
    accuracy: c.accuracy,
    altitude: c.altitude ?? null,
    speed: c.speed ?? null,
    heading: c.heading ?? null,
  });
  saveLog();
  followPlane();
}

function onError(err: GeolocationPositionError) {
  if (err.code === 1) gps.value = 'denied';
  // Timeouts are normal on a plane until the first fix; keep watching.
  else if (err.code === 2 && gps.peek() !== 'ok') gps.value = 'unavailable';
}

async function requestWakeLock() {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    wakeLock = (await wl?.request('screen')) ?? null;
  } catch {
    wakeLock = null; // battery saver, unsupported, or not visible: the screen may sleep, that's all
  }
}

const onVisibility = () => {
  if (document.visibilityState === 'visible' && isFlightOn.peek()) void requestWakeLock();
};
const onOnline = () => (online.value = navigator.onLine !== false);

function start() {
  const stored = load<FlightLog | null>(LOG_KEY, null);
  const fresh = !stored || Date.now() - (stored.last?.t ?? stored.startedAt) > STALE_MS;
  flightLog.value = fresh ? newLog() : stored;
  gps.value = 'searching';
  following.value = true;
  centeredOnce = false;
  offlineMapOnly.value = worldOnly.peek();
  void loadWorld()
    .then((w) => (world.value = w))
    .catch(() => {});
  if ('geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
  } else gps.value = 'unavailable';
  void requestWakeLock();
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('online', onOnline);
  addEventListener('offline', onOnline);
  ticker = setInterval(() => (now.value = Date.now()), 1000);
  // A low zoom: from 10 km up the whole region is what you see out of the window.
  const z = map.getZoom();
  if (z > 7 || z < 3) map.easeTo({ zoom: 5, duration: 600 });
  followPlane();
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  document.removeEventListener('visibilitychange', onVisibility);
  removeEventListener('online', onOnline);
  removeEventListener('offline', onOnline);
  clearInterval(ticker);
  clearInterval(adsbTimer);
  adsbTimer = undefined;
  offlineMapOnly.value = false;
  saveLog(true);
  render();
}

function followPlane() {
  const p = position.peek();
  if (!p || !following.peek() || !map) return;
  if (!centeredOnce) {
    centeredOnce = true;
    const z = map.getZoom();
    map.jumpTo({ center: p.lngLat, zoom: z > 6 || z < 4 ? 5 : z });
  } else {
    // Skip when already there: a steady GPS would otherwise keep the map animating.
    const at = map.project(p.lngLat);
    const c = map.project(map.getCenter());
    if (Math.hypot(at.x - c.x, at.y - c.y) > 2) map.easeTo({ center: p.lngLat, duration: 900 });
  }
}

export function resetLog() {
  flightLog.value = newLog();
  saveLog(true);
  render();
}

// ---------- flight number (ADS-B) ----------

export async function findFlight(query: string) {
  const q = query.trim().toUpperCase();
  if (!q) return;
  save('flight.callsign', q);
  if (!online.peek()) {
    adsb.value = { query: q, aircraft: null, at: Date.now(), error: 'צריך חיבור לאינטרנט (למשל Wi-Fi במטוס) כדי למצוא את הטיסה.' };
    return;
  }
  try {
    const res = await tools().call(flightPosition, { callsign: q }, { cache: false });
    const aircraft = res.aircraft[0] ?? null;
    adsb.value = { query: q, aircraft, at: Date.now(), error: aircraft ? undefined : 'הטיסה לא נמצאה כרגע. בדקו את המספר (למשל LY001) או נסו שוב בעוד כמה דקות.' };
    if (aircraft) {
      followPlane();
      clearInterval(adsbTimer);
      adsbTimer = setInterval(() => {
        if (isFlightOn.peek() && online.peek() && adsb.peek()?.aircraft) void findFlight(q);
      }, 30000);
    }
  } catch (e) {
    adsb.value = { query: q, aircraft: null, at: Date.now(), error: (e as Error).message?.match(/[א-ת]/) ? (e as Error).message : 'שירות הטיסות לא זמין כרגע.' };
  }
}

// ---------- map ----------

const SRC = 'flight';

function data(): Parameters<typeof setGeoJSON>[2] {
  if (!isFlightOn.peek()) return EMPTY;
  const log = flightLog.peek();
  const p = position.peek();
  const features: unknown[] = [];
  const line = p?.source === 'gps' ? [...log.track, p.lngLat] : log.track;
  if (line.length >= 2) features.push({ type: 'Feature', properties: { kind: 'track' }, geometry: { type: 'LineString', coordinates: line } });
  const dest = destination.peek();
  if (dest) {
    if (p) features.push({ type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: greatCircle(p.lngLat, dest.lngLat, 50000) } });
    features.push({ type: 'Feature', properties: { kind: 'dest', name: dest.code ?? dest.name }, geometry: { type: 'Point', coordinates: dest.lngLat } });
  }
  const a = adsb.peek()?.aircraft;
  if (a && p?.source === 'gps') features.push({ type: 'Feature', properties: { kind: 'plane', icon: 'flight-plane-adsb', heading: a.track ?? 0 }, geometry: { type: 'Point', coordinates: a.lngLat } });
  if (p) features.push({ type: 'Feature', properties: { kind: 'plane', icon: p.source === 'gps' ? 'flight-plane' : 'flight-plane-adsb', heading: p.heading ?? 0 }, geometry: { type: 'Point', coordinates: p.lngLat } });
  return { type: 'FeatureCollection', features } as Parameters<typeof setGeoJSON>[2];
}

function render() {
  if (map?.getSource(SRC)) setGeoJSON(map, SRC, data());
}

function addLayers(m: MapLibreMap) {
  const accent = cssVar('--accent', '#0b57d0');
  addPlaneImages(m, isDark.peek());
  setGeoJSON(m, SRC, data());
  const kind = (k: string) => ['==', ['get', 'kind'], k] as never;
  ensureLayer(m, {
    id: 'flight-route',
    type: 'line',
    source: SRC,
    filter: kind('route'),
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [1.5, 2], 'line-opacity': 0.8 },
  }, null);
  ensureLayer(m, {
    id: 'flight-track-casing',
    type: 'line',
    source: SRC,
    filter: kind('track'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': isDark.peek() ? '#1f1f1f' : '#ffffff', 'line-width': 6, 'line-opacity': 0.9 },
  }, null);
  ensureLayer(m, {
    id: 'flight-track',
    type: 'line',
    source: SRC,
    filter: kind('track'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': accent, 'line-width': 3 },
  }, null);
  ensureLayer(m, {
    id: 'flight-dest',
    type: 'circle',
    source: SRC,
    filter: kind('dest'),
    paint: { 'circle-radius': 6, 'circle-color': '#d93025', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  }, null);
  ensureLayer(m, {
    id: 'flight-plane',
    type: 'symbol',
    source: SRC,
    filter: kind('plane'),
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  }, null);
}

export function setupFlight(ctx: FeatureContext) {
  map = ctx.map;
  ctx.onStyle(addLayers);
  effect(() => {
    void flightLog.value;
    void destination.value;
    void adsb.value;
    render();
  });
  let was = false;
  effect(() => {
    const on = isFlightOn.value;
    if (on === was) return;
    was = on;
    if (on) start();
    else stop();
  });
  effect(() => {
    if (isFlightOn.value) offlineMapOnly.value = worldOnly.value;
  });
  // Moving the map by hand stops following, like the location button does.
  map.on('dragstart', () => {
    if (isFlightOn.peek()) following.value = false;
  });
}

// ---------- screen ----------

function Stat({ label, r, icon }: { label: string; r: Readout; icon: string }) {
  return (
    <div class="flight-stat">
      <div class="flight-stat-label">
        <Icon name={icon} size={16} />
        {label}
      </div>
      <div class="flight-stat-value">
        <span dir="ltr">{r.value}</span>
        {r.unit && <span class="flight-unit">{r.unit}</span>}
      </div>
      {r.sub && <div class="flight-stat-sub">{r.sub}</div>}
    </div>
  );
}

const GPS_LABEL: Record<GpsState, string> = { searching: 'מחפש GPS…', ok: 'GPS פעיל', denied: 'אין הרשאת מיקום', unavailable: 'GPS לא זמין' };

function Guidance() {
  const g = gps.value;
  if (g === 'denied') {
    return (
      <div class="flight-guide warn" role="alert">
        <Icon name="location_disabled" />
        <div>
          <strong>אין הרשאת מיקום</strong>
          <p>כדי לראות את עצמכם על המפה, אשרו גישה למיקום בהגדרות האתר בדפדפן (או בהגדרות הטלפון: פרטיות ← שירותי מיקום).</p>
        </div>
      </div>
    );
  }
  return (
    <div class="flight-guide" role="status">
      <Icon name="satellite_alt" class="pulse" />
      <div>
        <strong>{g === 'unavailable' ? 'אין עדיין אות GPS' : 'מחפשים אות GPS…'}</strong>
        <p>שבו ליד החלון והחזיקו את הטלפון קרוב אליו. ה-GPS עובד גם במצב טיסה ובלי אינטרנט, אבל המיקום הראשון יכול לקחת כמה דקות.</p>
      </div>
    </div>
  );
}

function DestinationPicker({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Destination[]>([]);
  const w = world.value;
  const local: Destination[] = w
    ? searchWorld(w, q, 6).map((r) =>
        r.kind === 'city'
          ? { name: worldName(r.city), lngLat: r.city.lngLat }
          : { name: `${r.airport.name}${r.airport.city ? `, ${r.airport.city}` : ''}`, lngLat: r.airport.lngLat, code: r.airport.iata },
      )
    : [];
  useEffect(() => {
    setRemote([]);
    if (!online.peek() || q.trim().length < 2 || !providers.peek().photonUrl) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      tools()
        .call(searchPlaces, { query: q, limit: 4 }, { signal: ac.signal })
        .then((places) => setRemote(places.map((p) => ({ name: p.address ? `${p.name}, ${p.address}` : p.name, lngLat: [p.lng, p.lat] as LngLat }))))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);
  const pick = (d: Destination) => {
    destination.value = d;
    onDone();
  };
  const results = [...local, ...remote.filter((r) => !local.some((l) => distance(l.lngLat, r.lngLat) < 5000))];
  return (
    <div class="flight-picker">
      <input
        class="flight-input"
        type="search"
        autoFocus
        placeholder={online.value ? 'עיר, שדה תעופה או קוד (TLV)' : 'עיר או שדה תעופה (בלי אינטרנט: ערים גדולות ושדות)'}
        aria-label="חיפוש יעד"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      {q.trim() && (
        <ul class="flight-results" aria-label="יעדים">
          {results.map((d) => (
            <li key={`${d.name}${d.lngLat.join()}`}>
              <button class="flight-result" onClick={() => pick(d)}>
                <Icon name={d.code ? 'flight_land' : 'location_on'} size={20} />
                <span class="flight-result-name">{d.name}</span>
                {d.code && (
                  <span class="flight-code" dir="ltr">
                    {d.code}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!results.length && <li class="muted small flight-empty">לא נמצא יעד בשם הזה</li>}
        </ul>
      )}
      <button class="btn small" onClick={onDone}>
        ביטול
      </button>
    </div>
  );
}

function DestinationCard({ here, speedMs }: { here: LngLat | null; speedMs: number | null }) {
  const [picking, setPicking] = useState(false);
  const d = destination.value;
  const u = units.value;
  if (picking) return <DestinationPicker onDone={() => setPicking(false)} />;
  if (!d) {
    return (
      <button class="btn tonal flight-dest-btn" onClick={() => setPicking(true)}>
        <Icon name="flight_land" size={20} />
        בחירת יעד
      </button>
    );
  }
  const remaining = here ? distance(here, d.lngLat) : null;
  const eta = remaining !== null ? etaSeconds(remaining, speedMs) : null;
  const left = remaining !== null ? distanceReadout(remaining, u) : null;
  return (
    <div class="flight-dest">
      <Icon name="flight_land" />
      <div class="flight-dest-body">
        <div class="flight-dest-name">
          {d.name}
          {d.code && (
            <span class="flight-code" dir="ltr">
              {d.code}
            </span>
          )}
        </div>
        <div class="flight-dest-line">
          {left ? (
            <>
              נשארו <span dir="ltr">{left.value}</span> {left.unit}
            </>
          ) : (
            'מחכים למיקום…'
          )}
          {eta !== null && (
            <>
              {' · '}נחיתה משוערת <span dir="ltr">{formatArrival(eta)}</span> (עוד {formatDuration(eta)})
            </>
          )}
        </div>
      </div>
      <button class="icon-btn" aria-label="שינוי יעד" title="שינוי יעד" onClick={() => setPicking(true)}>
        <Icon name="edit" size={20} />
      </button>
      <button class="icon-btn" aria-label="הסרת היעד" title="הסרת היעד" onClick={() => (destination.value = null)}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

function FindFlight() {
  const [q, setQ] = useState<string>(() => load('flight.callsign', ''));
  const [busy, setBusy] = useState(false);
  const res = adsb.value;
  const a = res?.aircraft;
  const u = units.value;
  if (!providers.value.flightsUrl) return null;
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    await findFlight(q);
    setBusy(false);
  };
  return (
    <section class="flight-find">
      <h3>
        <Icon name="radar" size={20} />
        מציאת הטיסה לפי מספר
      </h3>
      <p class="muted small">כשיש אינטרנט (Wi-Fi במטוס), אפשר למצוא את המטוס בנתוני ADS-B פתוחים. נשלח רק מספר הטיסה, לא המיקום שלכם.</p>
      <form class="flight-find-form" onSubmit={submit}>
        <input
          class="flight-input"
          dir="ltr"
          inputMode="text"
          autoCapitalize="characters"
          placeholder="LY001"
          aria-label="מספר טיסה"
          maxLength={10}
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <button class="btn" type="submit" disabled={busy || q.trim().length < 2}>
          חיפוש
        </button>
      </form>
      {res?.error && <p class="small flight-error">{res.error}</p>}
      {a && (
        <div class="flight-adsb" aria-live="polite">
          <div>
            <strong dir="ltr">{a.callsign || res.query}</strong>
            {(a.type || a.registration) && (
              <>
                {' '}
                <span class="muted small" dir="ltr">
                  {[a.type, a.registration].filter(Boolean).join(' · ')}
                </span>
              </>
            )}
          </div>
          <div class="small">
            {a.onGround ? 'על הקרקע' : `גובה ${altitudeReadout(a.altitudeM, u).value} ${altitudeReadout(a.altitudeM, u).unit}`}
            {a.groundSpeedKmh !== null && ` · ${speedReadout(a.groundSpeedKmh / 3.6, u).value} ${speedReadout(a.groundSpeedKmh / 3.6, u).unit}`}
            {` · עודכן לפני ${Math.max(0, Math.round((now.value - res.at) / 1000 + (a.ageS ?? 0)))} שנ׳`}
          </div>
          <button
            class="btn small"
            onClick={() => {
              following.value = false;
              map.easeTo({ center: a.lngLat, duration: 800 });
            }}
          >
            <Icon name="flight" size={18} />
            הצגה במפה
          </button>
        </div>
      )}
    </section>
  );
}

export function FlightView(_: ViewProps) {
  useEffect(() => {
    if (sheet.peek() === 'peek') sheet.value = 'half';
  }, []);
  const log = flightLog.value;
  const u = units.value;
  const g = gps.value;
  const p = position.value;
  const a = adsb.value?.aircraft;
  const fromAdsb = p?.source === 'adsb';
  const fix = log.last;
  const adsbKmh = a?.groundSpeedKmh ?? null;
  const speedMs = fromAdsb ? (adsbKmh === null ? null : adsbKmh / 3.6) : log.speedMs;
  const alt = fromAdsb ? (a?.altitudeM ?? null) : (fix?.altitude ?? null);
  const heading = p?.heading ?? null;
  const w = world.value;
  const above = p && w ? aboveText(w, p.lngLat, u) : null;
  const ageS = fix ? Math.round((now.value - fix.t) / 1000) : null;
  const flown = distanceReadout(log.distanceM, u);
  return (
    <div class="view flight">
      <div class="flight-head">
        <Icon name="flight" class="flight-logo" />
        <h2>מצב טיסה</h2>
        <span class={`flight-gps gps-${g}`}>{fromAdsb ? 'לפי ADS-B' : GPS_LABEL[g]}</span>
        <button class="icon-btn" aria-label="יציאה ממצב טיסה" title="יציאה" onClick={back}>
          <Icon name="close" />
        </button>
      </div>
      {g !== 'ok' && <Guidance />}
      <div class="flight-grid">
        <Stat icon="speed" label="מהירות קרקע" r={speedReadout(speedMs, u)} />
        <Stat icon="height" label="גובה" r={altitudeReadout(alt, u)} />
        <Stat icon="explore" label="כיוון" r={headingReadout(heading)} />
        <Stat icon="timer" label="מרחק שעברתם" r={{ ...flown, sub: `${formatElapsed(now.value - log.startedAt)} שע׳ במצב טיסה` }} />
      </div>
      {above && (
        <div class="flight-above">
          <Icon name="public" />
          <div>
            <div class="muted small">מתחתיכם</div>
            <div class="flight-above-title">{above.title}</div>
            {above.near && <div class="muted small">{above.near}</div>}
          </div>
        </div>
      )}
      <DestinationCard here={p?.lngLat ?? null} speedMs={speedMs} />
      <div class="chips flight-chips">
        <button
          class="chip"
          aria-pressed={following.value}
          onClick={() => {
            following.value = !following.value;
            if (following.value) followPlane();
          }}
        >
          <Icon name="my_location" />
          {following.value ? 'המפה עוקבת' : 'מעקב כבוי'}
        </button>
        <button class="chip" aria-pressed={worldOnly.value} onClick={() => (worldOnly.value = !worldOnly.value)}>
          <Icon name="public" />
          מפת עולם לא מקוונת
        </button>
        <button
          class="chip"
          onClick={() => {
            resetLog();
            toast('המסלול והמרחק התאפסו');
          }}
        >
          <Icon name="refresh" />
          איפוס מסלול
        </button>
      </div>
      {fix && (
        <dl class="flight-details">
          <div>
            <dt>קואורדינטות</dt>
            <dd dir="ltr">{formatLatLng(fix.lngLat)}</dd>
          </div>
          <div>
            <dt>דיוק GPS</dt>
            <dd>
              ±<span dir="ltr">{Math.round(u === 'imperial' ? fix.accuracy * 3.28084 : fix.accuracy).toLocaleString('en-US')}</span> {u === 'imperial' ? 'רגל' : 'מ׳'}
              {ageS !== null && ageS > 30 && <span class="muted"> · לפני {formatDuration(ageS)}</span>}
            </dd>
          </div>
        </dl>
      )}
      <FindFlight />
      <p class="muted small flight-privacy">המיקום נשאר רק במכשיר שלכם. מפת העולם שמורה באפליקציה ועובדת גם בלי אינטרנט.</p>
    </div>
  );
}
