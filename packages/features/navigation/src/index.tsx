import { batch, signal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  bearing,
  distance,
  droppedPin,
  formatArrival,
  formatClock,
  formatDistance,
  formatDuration,
  isNight,
  laneIcon,
  lanesAt,
  maneuverIcon,
  openAt,
  speedLimitAt,
  zoomForSpeed,
  type LngLat,
  type Place,
  type Route,
  type RouteGuidance,
} from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  cssVar,
  ensureLayer,
  forceDark,
  hideLocationDot,
  Icon,
  EMPTY,
  immersive,
  load,
  open,
  openNearbyResults,
  region,
  remove,
  requestLocation,
  save,
  setGeoJSON,
  simulatingLocation,
  toast,
  units,
  userLocation,
  type ViewProps,
} from '@nm/core/app';
import { getDirections, placeDetails, routeGuidance, searchAlongRoute, searchNearby, spokenInstruction, tools, type AlongPlace } from '@nm/tools';
import { cumulative, progressOn, promptDue, type Progress } from './engine.ts';

interface NavState {
  route: Route;
  cum: number[];
  destination: Place | null;
  /** Stops still ahead, kept when re-routing. */
  vias: LngLat[];
  progress: Progress | null;
  muted: boolean;
  rerouting: boolean;
  arrived: boolean;
  simulate: boolean;
  guidance: RouteGuidance | null;
  /** "Closes soon after you arrive" and the like, for the destination. */
  arrivalNote: string | null;
}

/** Navigation settings, kept on the device. */
export interface NavSettings {
  voice: boolean;
  speedometer: boolean;
  /** 3D heading-up (Google's default), flat heading-up, or flat north-up. */
  view: '3d' | '2d' | 'north';
  night: 'auto' | 'day' | 'night';
}
const DEFAULT_SETTINGS: NavSettings = { voice: true, speedometer: true, view: '3d', night: 'auto' };
const settings = signal<NavSettings>({ ...DEFAULT_SETTINGS, ...load<Partial<NavSettings>>('nav:settings', {}) });
settings.subscribe((v) => save('nav:settings', v));

/** The navigation in progress, saved so it can resume if the browser kills the page. */
interface SavedNav {
  route: Route;
  destination: Place | null;
  vias: LngLat[];
  at: number;
}
const SAVED_KEY = 'nav:active';

/** Where the user parked (saved from the arrival screen), shown on the map and home screen. */
interface Parking {
  lng: number;
  lat: number;
  at: number;
  near?: string;
}
const parking = signal<Parking | null>(load<Parking | null>('parking', null));
parking.subscribe((v) => (v ? save('parking', v) : remove('parking')));

/** Search along the route, from the overlay. */
const along = signal<{ category: string; label: string; loading: boolean; places: AlongPlace[]; error?: string } | null>(null);
const settingsOpen = signal(false);

const nav = signal<NavState | null>(null);
/** The camera follows the user (false once they pan the map, until "re-center"). */
const following = signal(true);
/** Showing the whole route ahead instead of following. */
const overview = signal(false);
/** No camera updates until the opening zoom-in to the user has played. */
let introUntil = 0;
let map: MapLibreMap;
let said = new Set<number>();
let saidFor = -1;
let offCount = 0;
let lastReroute = 0;
let wakeLock: { release(): Promise<void> } | null = null;
let simTimer: ReturnType<typeof setInterval> | null = null;
let unsubLocation: (() => void) | null = null;

// --- voice ---
let voice: SpeechSynthesisVoice | undefined;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang === 'he-IL') ?? vs.find((v) => v.lang.startsWith('he'));
}
function speak(text: string) {
  if (nav.peek()?.muted || !settings.peek().voice || typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'he-IL';
    if (voice) u.voice = voice;
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch {
    /* speech not available */
  }
}

async function keepAwake() {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl) wakeLock = await wl.request('screen');
  } catch {
    /* not supported (older iOS outside the installed app) */
  }
}

function onVisibility() {
  if (!document.hidden && nav.peek()) void keepAwake();
}

function drawProgress(s: NavState) {
  if (!map.getSource('nav-route')) return;
  const p = s.progress;
  const g = s.route.geometry;
  const ahead: LngLat[] = p ? [p.snapped, ...g.slice(p.segment + 1)] : g;
  setGeoJSON(map, 'nav-route', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ahead } });
  // A destination off the road (a building in a park, a beach): dashed walk from the end of the route.
  const end = g[g.length - 1];
  const d = s.destination;
  const tail = d && end && distance(end, [d.lng, d.lat]) > 25 ? [end, [d.lng, d.lat] as LngLat] : null;
  setGeoJSON(map, 'nav-tail', tail ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: tail } } : EMPTY);
}

const isRoad = (s: NavState) => s.route.mode === 'car' || s.route.mode === 'motorcycle';

/** Direction of travel: the GPS heading when moving, else the road's direction here. */
function travelHeading(s: NavState): number {
  const u = userLocation.peek();
  return u?.heading !== null && u?.heading !== undefined && (u.speed ?? 0) > 2 ? u.heading : s.progress?.course ?? (s.route.geometry.length > 1 ? bearing(s.route.geometry[0], s.route.geometry[1]) : map.getBearing());
}

/** The user on screen sits low, like Google: more road ahead than behind. */
const NAV_PADDING = { top: 320, bottom: 140, left: 0, right: 0 };

function cameraFor(s: NavState, pos: LngLat) {
  const u = userLocation.peek();
  const view = settings.peek().view;
  return {
    center: pos,
    bearing: view === 'north' ? 0 : travelHeading(s),
    pitch: view !== '3d' ? 0 : isRoad(s) ? 60 : 45,
    zoom: isRoad(s) ? zoomForSpeed(u?.speed, s.progress?.toNextM ?? Infinity) : 18,
    padding: NAV_PADDING,
  };
}

function camera(s: NavState, pos: LngLat, duration = 900) {
  if (!following.peek() || Date.now() < introUntil) return;
  map.easeTo({ ...cameraFor(s, pos), duration, easing: (t) => t });
}

/** Pressing "start": the map flies down to the user and tilts into the road, like Google's. */
function intro(s: NavState, pos: LngLat) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduce ? 0 : 1800;
  introUntil = Date.now() + duration;
  map.flyTo({ ...cameraFor(s, pos), duration, curve: 1.2, essential: true });
}

/** Back to following the user (the "re-center" button). */
function recenter() {
  const s = nav.peek();
  following.value = true;
  overview.value = false;
  if (s) camera(s, puckAt(s) ?? s.route.geometry[0], 700);
}

/** The whole route still ahead, flat and north-up, until "re-center". */
function showOverview() {
  const s = nav.peek();
  if (!s) return;
  following.value = false;
  overview.value = true;
  const g = s.route.geometry;
  const ahead = s.progress ? [s.progress.snapped, ...g.slice(s.progress.segment + 1)] : g;
  let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ahead) {
    w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y);
  }
  // Flat first: bounds fitting is only exact on an untilted map.
  map.stop();
  map.jumpTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  map.fitBounds([[w, so], [e, n]], { padding: { top: 190, bottom: 170, left: 40, right: 40 }, maxZoom: 17, duration: 700 });
}

/** Where the navigation arrow goes: on the road when close to it, else where the GPS says. */
function puckAt(s: NavState): LngLat | null {
  const p = s.progress;
  if (p && (p.offRouteM < 40 || s.simulate)) return p.snapped;
  const u = userLocation.peek();
  return u ? [u.lng, u.lat] : p?.snapped ?? null;
}

function drawPuck(s: NavState | null) {
  if (!map.getSource('nav-puck')) return;
  const at = s && !s.arrived ? puckAt(s) : null;
  setGeoJSON(map, 'nav-puck', at && s ? { type: 'Feature', properties: { bearing: travelHeading(s) }, geometry: { type: 'Point', coordinates: at } } : EMPTY);
}

/** Google's blue navigation arrow with a white edge, drawn once per style. */
function addPuckImage(m: MapLibreMap) {
  if (m.hasImage('nav-puck')) return;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return;
  g.translate(size / 2, size / 2);
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 2;
  g.beginPath();
  g.arc(0, 0, 34, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.shadowColor = 'transparent';
  g.beginPath();
  g.moveTo(0, -24);
  g.lineTo(19, 20);
  g.lineTo(0, 10);
  g.lineTo(-19, 20);
  g.closePath();
  g.fillStyle = cssVar('--route', '#4285f4');
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = cssVar('--route-casing', '#1967d2');
  g.stroke();
  const data = g.getImageData(0, 0, size, size);
  m.addImage('nav-puck', { width: size, height: size, data: new Uint8Array(data.data.buffer) }, { pixelRatio: 2 });
}

/** Dark map at night while navigating (unless set otherwise), checked every few minutes. */
let lastNightCheck = 0;
function applyNight(pos: LngLat, force = false) {
  const now = Date.now();
  if (!force && now - lastNightCheck < 5 * 60000) return;
  lastNightCheck = now;
  const n = settings.peek().night;
  forceDark.value = n === 'night' || (n === 'auto' && isNight(pos[0], pos[1]));
}

function persist(s: NavState) {
  if (s.simulate) return;
  save(SAVED_KEY, { route: s.route, destination: s.destination, vias: s.vias, at: Date.now() } satisfies SavedNav);
}

async function loadGuidance(route: Route, vias: LngLat[]) {
  if (route.mode === 'walk' || route.geometry.length < 2) return;
  const g = route.geometry;
  try {
    const guidance = await tools().call(routeGuidance, { waypoints: [g[0], ...vias, g[g.length - 1]], geometry: g, mode: route.mode });
    const cur = nav.peek();
    if (cur && cur.route === route) nav.value = { ...cur, guidance };
  } catch {
    /* speed limits and lanes are extras */
  }
}

/** Will the destination be open when we get there? Shown under the ETA. */
async function checkArrival(route: Route, dest: Place | null) {
  if (!dest?.id.startsWith('osm:')) return;
  try {
    const d = await tools().call(placeDetails, { id: dest.id });
    if (!d?.openingHours) return;
    const arrive = new Date(Date.now() + route.durationS * 1000);
    const { open: isOpen, next } = await openAt(d.openingHours, d.lat, d.lng, arrive, d.countryCode ?? 'il');
    const tz = region.peek().timeZone;
    let note: string | null = null;
    if (isOpen === false) note = next ? `${dest.name} כנראה סגור כשתגיעו · נפתח ב-${formatClock(next.toISOString(), tz)}` : `${dest.name} כנראה סגור כשתגיעו`;
    else if (isOpen && next && next.getTime() - arrive.getTime() < 30 * 60000) note = `${dest.name} נסגר ב-${formatClock(next.toISOString(), tz)}, זמן קצר אחרי שתגיעו`;
    const cur = nav.peek();
    if (note && cur && cur.destination?.id === dest.id) {
      nav.value = { ...cur, arrivalNote: note };
      toast(note, undefined, 6000);
    }
  } catch {
    /* no hours, no note */
  }
}

async function reroute(s: NavState, pos: LngLat) {
  const dest = s.route.geometry[s.route.geometry.length - 1];
  lastReroute = Date.now();
  nav.value = { ...s, rerouting: true };
  speak('מחשב מסלול מחדש');
  try {
    const u = userLocation.peek();
    const [r] = await tools().call(
      getDirections,
      { waypoints: [pos, ...s.vias, dest], mode: s.route.mode, alternatives: 0, heading: u?.heading ?? s.progress?.course, includeGeometry: true },
      { cache: false },
    );
    const cur = nav.peek();
    if (!cur) return;
    if (r) {
      said = new Set();
      saidFor = -1;
      nav.value = { ...cur, route: r, cum: cumulative(r.geometry), rerouting: false, progress: null, guidance: null };
      persist(nav.value);
      void loadGuidance(r, cur.vias);
    } else nav.value = { ...cur, rerouting: false };
  } catch {
    const cur = nav.peek();
    if (cur) nav.value = { ...cur, rerouting: false };
    toast('אין חיבור לחישוב מסלול חדש. ממשיכים במסלול הקודם.');
  }
}

function onPosition(pos: LngLat, accuracy: number) {
  const s = nav.peek();
  if (!s || s.arrived) return;
  const p = progressOn(s.route, s.cum, pos, s.progress?.segment ?? 0);
  // A stop we reached no longer counts when re-routing.
  const vias = s.vias.length && distance(pos, s.vias[0]) < 60 ? s.vias.slice(1) : s.vias;
  const next = { ...s, progress: p, vias };
  applyNight(pos);

  // Off route: two bad fixes in a row with decent accuracy -> new route (at most every 10 s).
  const limit = s.route.mode === 'car' ? 50 : 30;
  if (p.offRouteM > limit + Math.min(accuracy, 50)) offCount++;
  else offCount = 0;
  if (offCount >= 2 && !s.rerouting && Date.now() - lastReroute > 10000) {
    offCount = 0;
    void reroute(next, pos);
    return;
  }

  if (p.arrived) {
    batch(() => (nav.value = { ...next, arrived: true }));
    remove(SAVED_KEY);
    speak('הגעתם ליעד');
    return;
  }

  if (p.nextIndex !== saidFor) {
    said = new Set();
    saidFor = p.nextIndex;
  }
  const due = p.next ? promptDue(s.route.mode, p.toNextM, said) : null;
  if (due !== null && p.next) {
    said.add(due);
    let text = spokenInstruction(p.next, p.toNextM > 60 ? p.toNextM : undefined);
    if (p.after && p.toNextM < 150 && distanceBetweenSteps(s, p) < 120) text += `, ואז ${spokenInstruction(p.after)}`;
    speak(text);
  }

  nav.value = next;
  drawProgress(next);
  drawPuck(next);
  camera(next, puckAt(next) ?? pos);
}

function distanceBetweenSteps(s: NavState, p: Progress): number {
  if (!p.next || !p.after) return Infinity;
  return s.cum[p.after.shapeIndex] - s.cum[p.next.shapeIndex];
}

function startSimulation(s: NavState) {
  let travelled = 0;
  const speed = isRoad(s) ? 25 : s.route.mode === 'bike' ? 8 : 3; // m/s, a bit fast for demos
  simTimer = setInterval(() => {
    const cur = nav.peek();
    if (!cur) return;
    travelled += speed;
    const cum = cur.cum;
    const g = cur.route.geometry;
    let i = cum.findIndex((c) => c > travelled);
    if (i === -1) i = g.length - 1;
    const a = g[Math.max(0, i - 1)], b = g[i];
    const segLen = cum[i] - cum[Math.max(0, i - 1)] || 1;
    const t = Math.min(1, Math.max(0, (travelled - cum[Math.max(0, i - 1)]) / segLen));
    const pos: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    userLocation.value = { lng: pos[0], lat: pos[1], accuracy: 5, heading: null, speed, timestamp: Date.now() };
  }, 1000);
}

function start(route: Route, destination: Place | null, simulate: boolean, vias: LngLat[] = []) {
  said = new Set();
  saidFor = -1;
  offCount = 0;
  const s: NavState = { route, cum: cumulative(route.geometry), destination, vias, progress: null, muted: !settings.peek().voice, rerouting: false, arrived: false, simulate, guidance: null, arrivalNote: null };
  nav.value = s;
  persist(s);
  if (route.geometry[0]) applyNight(route.geometry[0], true);
  void loadGuidance(route, vias);
  void checkArrival(route, destination);
  immersive.value = true;
  if (typeof speechSynthesis !== 'undefined') {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  speak(`יוצאים לדרך. ${route.steps[1] ? spokenInstruction(route.steps[1], route.steps[0]?.distanceM) : ''}`);
  void keepAwake();
  document.addEventListener('visibilitychange', onVisibility);
  drawProgress(s);
  following.value = true;
  overview.value = false;
  hideLocationDot.value = true;
  const here = userLocation.peek();
  intro(s, here && !simulate ? [here.lng, here.lat] : route.geometry[0]);
  drawPuck({ ...s, progress: null });
  simulatingLocation.value = simulate;
  if (simulate) startSimulation(s);
  else requestLocation();
  unsubLocation = userLocation.subscribe((u) => {
    if (u) onPosition([u.lng, u.lat], u.accuracy);
  });
}

function stop() {
  const wasPreview = nav.peek()?.simulate;
  unsubLocation?.();
  unsubLocation = null;
  remove(SAVED_KEY);
  forceDark.value = false;
  simulatingLocation.value = false;
  along.value = null;
  settingsOpen.value = false;
  if (map.getSource('nav-along')) setGeoJSON(map, 'nav-along', EMPTY);
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  document.removeEventListener('visibilitychange', onVisibility);
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  batch(() => {
    nav.value = null;
    immersive.value = false;
    // The preview's made-up position is not where the user is.
    if (wasPreview) userLocation.value = null;
  });
  if (map.getSource('nav-route')) setGeoJSON(map, 'nav-route', EMPTY);
  if (map.getSource('nav-tail')) setGeoJSON(map, 'nav-tail', EMPTY);
  drawPuck(null);
  hideLocationDot.value = false;
  following.value = true;
  overview.value = false;
  introUntil = 0;
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
}

function ArrowIcon({ type }: { type: number }) {
  return (
    <span class="nav-arrow">
      <Icon name={maneuverIcon(type)} size={44} />
    </span>
  );
}

/** Speed limit sign and speedometer (red when more than 5 km/h over), like Google's. */
function SpeedPanel({ s }: { s: NavState }) {
  const u = userLocation.value;
  if (!settings.value.speedometer || !isRoad(s)) return null;
  const limit = speedLimitAt(s.guidance, s.progress?.segment ?? 0);
  const kmh = u?.speed !== null && u?.speed !== undefined ? Math.round(u.speed * 3.6) : null;
  const over = limit !== null && kmh !== null && kmh > limit + 5;
  return (
    <div class="nav-speed" aria-label="מהירות">
      {limit !== null && (
        <span class="speed-limit" aria-label={`מהירות מותרת ${limit}`}>
          {limit}
        </span>
      )}
      <span class={`speedometer ${over ? 'over' : ''}`} aria-label={kmh === null ? 'מהירות לא ידועה' : `${kmh} קמ״ש`}>
        <strong>{kmh ?? '–'}</strong>
        <span class="tiny">קמ״ש</span>
      </span>
    </div>
  );
}

/** Lane arrows for the next junction; lanes that fit the turn are lit. */
function Lanes({ s }: { s: NavState }) {
  const p = s.progress;
  const step = p?.next;
  if (!p || !step || p.toNextM > 800) return null;
  const lanes = lanesAt(s.guidance, s.route.geometry[step.shapeIndex] ?? p.snapped);
  if (!lanes) return null;
  return (
    <div class="nav-lanes" aria-label="נתיבים">
      {lanes.map((l, i) => (
        <span key={i} class={`lane ${l.valid ? 'valid' : ''}`}>
          <Icon name={laneIcon(l.indications)} size={26} />
        </span>
      ))}
    </div>
  );
}

const ALONG_CHIPS = [
  { id: 'fuel', label: 'דלק', icon: 'local_gas_station' },
  { id: 'charging', label: 'טעינה', icon: 'ev_station' },
  { id: 'cafe', label: 'קפה', icon: 'local_cafe' },
  { id: 'restaurant', label: 'אוכל', icon: 'restaurant' },
  { id: 'supermarket', label: 'סופר', icon: 'grocery' },
  { id: 'parking', label: 'חניה', icon: 'local_parking' },
];

function drawAlong() {
  if (!map.getSource('nav-along')) return;
  const a = along.peek();
  setGeoJSON(map, 'nav-along', {
    type: 'FeatureCollection',
    features: (a?.places ?? []).map((p) => ({
      type: 'Feature' as const,
      properties: { id: p.id, label: `+${Math.round(p.detourS / 60)} דק׳` },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  });
}

async function searchAlong(category: string, label: string) {
  const s = nav.peek();
  if (!s) return;
  along.value = { category, label, loading: true, places: [] };
  try {
    const places = await tools().call(searchAlongRoute, { category: category as never, geometry: s.route.geometry, fromIndex: s.progress?.segment ?? 0, limit: 12 });
    if (along.peek()?.category !== category) return;
    along.value = { category, label, loading: false, places, error: places.length ? undefined : 'לא נמצאו מקומות קרובים למסלול' };
  } catch {
    if (along.peek()?.category === category) along.value = { category, label, loading: false, places: [], error: 'החיפוש נכשל. נסו שוב.' };
  }
  drawAlong();
}

/** Add a place found along the way as a stop, and re-route through it. */
function addStop(p: AlongPlace) {
  const s = nav.peek();
  const u = userLocation.peek();
  along.value = null;
  drawAlong();
  if (!s) return;
  const pos: LngLat = u ? [u.lng, u.lat] : (s.progress?.snapped ?? s.route.geometry[0]);
  const next = { ...s, vias: [[p.lng, p.lat] as LngLat, ...s.vias] };
  nav.value = next;
  toast(`עוצרים ב${p.name}`);
  void reroute(next, pos);
}

function AlongSearch() {
  const a = along.value;
  const u = units.value;
  return (
    <div class="nav-along-panel" role="dialog" aria-label="חיפוש לאורך המסלול">
      <div class="chips">
        {ALONG_CHIPS.map((c) => (
          <button key={c.id} class="chip" aria-pressed={a?.category === c.id} onClick={() => void searchAlong(c.id, c.label)}>
            <Icon name={c.icon} size={18} />
            {c.label}
          </button>
        ))}
      </div>
      {a?.loading && <div class="skeleton line" />}
      {a?.error && <p class="muted small">{a.error}</p>}
      {a && !a.loading && a.places.length > 0 && (
        <ul class="list along-list">
          {a.places.map((p) => (
            <li key={p.id}>
              <button class="list-item" onClick={() => addStop(p)}>
                <span class="li-body">
                  <span class="li-title">{p.name}</span>
                  <span class="li-sub">
                    {formatDistance(p.alongM, u)} קדימה · {p.offM < 60 ? 'על המסלול' : `${formatDistance(p.offM, u)} מהמסלול`}
                  </span>
                </span>
                <span class="along-detour">+{Math.round(p.detourS / 60)} דק׳</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        class="link-like small"
        onClick={() => {
          along.value = null;
          drawAlong();
          settingsOpen.value = false;
        }}
      >
        סגירה
      </button>
    </div>
  );
}

function NavSettingsFields() {
  const st = settings.value;
  const set = (patch: Partial<NavSettings>) => {
    settings.value = { ...settings.peek(), ...patch };
    const s = nav.peek();
    if (!s) return;
    if ('voice' in patch) nav.value = { ...s, muted: !patch.voice };
    const u = userLocation.peek();
    if ('night' in patch && u) applyNight([u.lng, u.lat], true);
    if ('view' in patch && u) camera(s, [u.lng, u.lat]);
  };
  return (
    <div class="option-list nav-settings">
      <label>
        <input type="checkbox" checked={st.voice} onChange={(e) => set({ voice: (e.target as HTMLInputElement).checked })} /> הנחיות קוליות
      </label>
      <label>
        <input type="checkbox" checked={st.speedometer} onChange={(e) => set({ speedometer: (e.target as HTMLInputElement).checked })} /> מד מהירות ומהירות מותרת
      </label>
      <label class="field">
        תצוגת המפה
        <select class="input select" value={st.view} onChange={(e) => set({ view: (e.target as HTMLSelectElement).value as NavSettings['view'] })}>
          <option value="3d">תלת־ממד, בכיוון הנסיעה</option>
          <option value="2d">שטוחה, בכיוון הנסיעה</option>
          <option value="north">שטוחה, צפון למעלה</option>
        </select>
      </label>
      <label class="field">
        צבעי המפה
        <select class="input select" value={st.night} onChange={(e) => set({ night: (e.target as HTMLSelectElement).value as NavSettings['night'] })}>
          <option value="auto">אוטומטי (כהה אחרי השקיעה)</option>
          <option value="day">תמיד בהירה</option>
          <option value="night">תמיד כהה</option>
        </select>
      </label>
    </div>
  );
}

function NavSettingsView(_: ViewProps) {
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>הגדרות ניווט</h2>
      </header>
      <NavSettingsFields />
    </div>
  );
}

/** Arrived: parking near the destination, and "remember where I parked". */
function ArrivalCard({ s }: { s: NavState }) {
  const dest = s.destination;
  const end = s.route.geometry[s.route.geometry.length - 1];
  const center: LngLat = dest ? [dest.lng, dest.lat] : end;
  const leave = () => {
    stop();
    back();
  };
  return (
    <div class="nav-arrival" role="dialog" aria-label="הגעתם">
      <h3>{dest?.name ?? 'הגעתם ליעד'}</h3>
      {dest?.address && <p class="muted small">{dest.address}</p>}
      <div class="chips">
        {isRoad(s) && (
          <button
            class="chip"
            onClick={() => {
              const u = userLocation.peek();
              const at: LngLat = u ? [u.lng, u.lat] : end;
              parking.value = { lng: at[0], lat: at[1], at: Date.now(), near: dest?.name };
              toast('מיקום החניה נשמר');
            }}
          >
            <Icon name="local_parking" size={18} />
            {parking.value ? 'עדכון מקום החניה' : 'שמירת מקום החניה'}
          </button>
        )}
        {isRoad(s) && (
          <button
            class="chip"
            onClick={() => {
              stop();
              void openNearbyResults({
                title: `חניונים ליד ${dest?.name ?? 'היעד'}`,
                category: 'parking',
                center,
                map,
                radiusM: 700,
                fetch: (bbox) => tools().call(searchNearby, { category: 'parking', bbox, limit: 40 }),
              });
            }}
          >
            <Icon name="search" size={18} />
            חניונים בסביבה
          </button>
        )}
      </div>
      <button class="btn primary" onClick={leave}>
        סיום
      </button>
    </div>
  );
}

function drawParking() {
  if (!map?.getSource('parking')) return;
  const pk = parking.peek();
  setGeoJSON(map, 'parking', pk ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [pk.lng, pk.lat] } } : EMPTY);
}

/** Home screen card while a parking spot is saved. */
function ParkingCard() {
  const pk = parking.value;
  if (!pk) return null;
  const ago = Math.round((Date.now() - pk.at) / 60000);
  return (
    <section class="home-section parking-card" aria-label="החניה שלך">
      <span class="parking-p" aria-hidden="true">
        P
      </span>
      <span class="li-body">
        <span class="li-title">החניה שלך{pk.near ? ` ליד ${pk.near}` : ''}</span>
        <span class="li-sub">{ago < 60 ? `לפני ${Math.max(1, ago)} דק׳` : `לפני ${formatDuration(ago * 60)}`}</span>
      </span>
      <button class="chip" onClick={() => open({ kind: 'directions', props: { to: droppedPin(pk.lng, pk.lat, 'החניה שלי'), mode: 'walk' } })}>
        <Icon name="directions_walk" size={18} />
        ניווט לרכב
      </button>
      <button
        class="icon-btn small"
        aria-label="מחיקת מקום החניה"
        onClick={() => {
          const old = parking.peek();
          parking.value = null;
          toast('מקום החניה נמחק', { label: 'ביטול', run: () => (parking.value = old) });
        }}
      >
        <Icon name="close" size={20} />
      </button>
    </section>
  );
}

function Overlay() {
  const s = nav.value;
  if (!s) return null;
  const p = s.progress;
  const step = p?.next ?? s.route.steps[1] ?? s.route.steps[0];
  const u = units.value;
  return (
    <div class="nav-overlay">
      <div class={`nav-banner ${s.rerouting ? 'rerouting' : ''}`} role="status" aria-live="polite">
        {s.arrived ? (
          <div class="nav-main">
            <ArrowIcon type={4} />
            <div>
              <div class="nav-dist">הגעתם</div>
              <div class="nav-instr">{s.destination?.name ?? 'ליעד'}</div>
            </div>
          </div>
        ) : s.rerouting ? (
          <div class="nav-main">
            <span class="spinner" />
            <div class="nav-instr">מחשב מסלול מחדש…</div>
          </div>
        ) : (
          <div class="nav-main">
            {step && <ArrowIcon type={step.type} />}
            <div>
              <div class="nav-dist">{p ? formatDistance(p.toNextM, u) : ''}</div>
              <div class="nav-instr">{step?.instruction}</div>
            </div>
          </div>
        )}
        {!s.arrived && !s.rerouting && <Lanes s={s} />}
        {!s.arrived && p?.after && p.toNextM < 400 && (
          <div class="nav-then">
            ואז <Icon name={maneuverIcon(p.after.type)} size={20} /> {p.after.instruction}
          </div>
        )}
      </div>
      {s.simulate && <div class="nav-preview-badge">תצוגה מקדימה</div>}
      {!userLocation.value && !s.simulate && <div class="nav-wait">ממתין ל-GPS…</div>}
      {!s.arrived && <SpeedPanel s={s} />}
      {!s.arrived && (
        <div class="nav-side">
          {!overview.value && (
            <button class="nav-fab" aria-label="סקירת המסלול" onClick={showOverview}>
              <Icon name="alt_route" />
            </button>
          )}
        </div>
      )}
      {!s.arrived && !following.value && (
        <button class="nav-recenter" onClick={recenter}>
          <Icon name="navigation" size={20} />
          מרכז מחדש
        </button>
      )}
      {s.arrived && <ArrivalCard s={s} />}
      {!s.arrived && (along.value || settingsOpen.value) && (settingsOpen.value ? (
        <div class="nav-along-panel" role="dialog" aria-label="הגדרות ניווט">
          <NavSettingsFields />
          <button class="link-like small" onClick={() => (settingsOpen.value = false)}>
            סגירה
          </button>
        </div>
      ) : (
        <AlongSearch />
      ))}
      <div class="nav-bottom">
        <button
          class="icon-btn"
          aria-label={s.muted ? 'הפעלת קול' : 'השתקה'}
          onClick={() => {
            nav.value = { ...s, muted: !s.muted };
            if (!s.muted) speechSynthesis?.cancel();
          }}
        >
          <Icon name={s.muted ? 'volume_off' : 'volume_up'} />
        </button>
        <div class="nav-eta">
          {/* Like Google: time left big and green, then distance and arrival time. */}
          <strong class="nav-left">{formatDuration(p ? p.remainingS : s.route.durationS)}</strong>
          <span class="muted">
            {formatDistance(p ? p.remainingM : s.route.distanceM, u)} · <span class="nav-arrive">{formatArrival(p ? p.remainingS : s.route.durationS, Date.now(), region.value.timeZone)}</span>
          </span>
          {s.arrivalNote && <span class="nav-arrival-note small">{s.arrivalNote}</span>}
        </div>
        {!s.arrived && (
          <button
            class="icon-btn"
            aria-label="חיפוש לאורך המסלול"
            aria-pressed={!!along.value}
            onClick={() => {
              settingsOpen.value = false;
              along.value = along.peek() ? null : { category: '', label: '', loading: false, places: [] };
              drawAlong();
            }}
          >
            <Icon name="search" />
          </button>
        )}
        {!s.arrived && (
          <button
            class="icon-btn"
            aria-label="הגדרות ניווט"
            aria-pressed={settingsOpen.value}
            onClick={() => {
              along.value = null;
              drawAlong();
              settingsOpen.value = !settingsOpen.peek();
            }}
          >
            <Icon name="settings" />
          </button>
        )}
        <button
          class="btn danger"
          onClick={() => {
            stop();
            back();
          }}
        >
          {s.arrived ? 'סיום' : 'יציאה'}
        </button>
        <p class="nav-note">ללא נתוני תנועה בשלב הזה. שימו לב לתמרורים ולמצב הדרך.</p>
      </div>
    </div>
  );
}

/** The user's location, waiting up to `ms` for a first fix (asking for it if needed). */
function locate(ms = 15000): Promise<LngLat | null> {
  const now = userLocation.peek();
  if (now && !simulatingLocation.peek()) return Promise.resolve([now.lng, now.lat]);
  requestLocation();
  return new Promise((resolve) => {
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      resolve(null);
    }, ms);
    unsub = userLocation.subscribe((u) => {
      if (!u || simulatingLocation.peek()) return;
      clearTimeout(timer);
      queueMicrotask(() => unsub());
      resolve([u.lng, u.lat]);
    });
  });
}

const DRIVE_MODES = ['car', 'motorcycle', 'walk', 'bike'] as const;
const starting = signal<string | null>(null);

/** One tap from a place card straight into navigation, like Google's "Start": route from here, then go. */
async function navigateTo(place: Place) {
  if (starting.peek()) return;
  starting.value = place.id;
  try {
    const from = await locate();
    if (!from) {
      toast('צריך את המיקום שלך כדי לנווט. אפשר לבחור נקודת מוצא במסך המסלול.', { label: 'מסלול', run: () => open({ kind: 'directions', props: { to: place } }) }, 7000);
      return;
    }
    const to: LngLat = [place.lng, place.lat];
    // The mode last picked in directions; transit has no turn-by-turn, so walk when close, else drive.
    const last = load<string>('directions:mode', 'car');
    const mode = (DRIVE_MODES as readonly string[]).includes(last) ? (last as Route['mode']) : distance(from, to) < 1500 ? 'walk' : 'car';
    const u = userLocation.peek();
    const [route] = await tools().call(getDirections, { waypoints: [from, to], mode, alternatives: 0, heading: u?.heading ?? undefined, includeGeometry: true });
    if (!route) {
      toast('לא נמצא מסלול ליעד הזה');
      return;
    }
    open({ kind: 'navigate', props: { route, destination: place, waypoints: [from, to] } });
  } catch {
    toast('אין חיבור לחישוב מסלול. נסו שוב.');
  } finally {
    starting.value = null;
  }
}

function StartAction({ place }: { place: Place }) {
  const busy = starting.value === place.id;
  return (
    <button class="action start" aria-busy={busy} disabled={busy} onClick={() => void navigateTo(place)}>
      {busy ? <span class="spinner" /> : <Icon name="navigation" />}
      {busy ? 'מחשב…' : 'ניווט'}
    </button>
  );
}

/** The 'navigate' screen starts navigation; the UI itself is the full-screen overlay. */
const startedViews = new WeakSet<object>();

function NavigateView({ view }: ViewProps<{ route: Route; destination: Place | null; simulate?: boolean; waypoints?: LngLat[] }>) {
  // Once per screen: a re-render before the start has run (or after "exit") must not start again.
  if (!nav.value && view.props?.route && !startedViews.has(view)) {
    startedViews.add(view);
    const vias = (view.props.waypoints ?? []).slice(1, -1);
    queueMicrotask(() => start(view.props!.route, view.props!.destination ?? null, !!view.props!.simulate || /[?&]simulate=1/.test(location.search), vias));
  }
  return null;
}

export default defineFeature({
  id: 'navigation',
  title: 'ניווט קולי',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('navigate', NavigateView);
    ctx.registerView('nav-settings', NavSettingsView);
    ctx.registerSlot('overlay', Overlay, 10);
    ctx.registerMenuItem({ id: 'nav-settings', label: 'הגדרות ניווט', icon: 'navigation', order: 55, run: () => open({ kind: 'nav-settings' }) });
    ctx.registerHomeSection({ id: 'parking', order: 5, Component: ParkingCard });
    ctx.registerPlaceAction({ id: 'navigate', order: -10, Component: StartAction });
    ctx.onStyle((m) => {
      setGeoJSON(m, 'nav-route', EMPTY);
      ensureLayer(m, { id: 'nav-route-casing', type: 'line', source: 'nav-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': cssVar('--route-casing', '#1967d2'), 'line-width': 14 } });
      ensureLayer(m, { id: 'nav-route', type: 'line', source: 'nav-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': cssVar('--route', '#4285f4'), 'line-width': 10 } });
      setGeoJSON(m, 'nav-tail', EMPTY);
      ensureLayer(m, { id: 'nav-tail', type: 'line', source: 'nav-tail', layout: { 'line-cap': 'round' }, paint: { 'line-color': cssVar('--route', '#4285f4'), 'line-width': 4, 'line-dasharray': [0.1, 2] } });
      setGeoJSON(m, 'nav-puck', EMPTY);
      addPuckImage(m);
      ensureLayer(m, {
        id: 'nav-puck',
        type: 'symbol',
        source: 'nav-puck',
        layout: {
          'icon-image': 'nav-puck',
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      setGeoJSON(m, 'nav-along', EMPTY);
      ensureLayer(m, { id: 'nav-along', type: 'circle', source: 'nav-along', paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-color': '#1a73e8', 'circle-stroke-width': 3 } });
      ensureLayer(m, {
        id: 'nav-along-label',
        type: 'symbol',
        source: 'nav-along',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, -1.6], 'text-allow-overlap': true },
        paint: { 'text-color': '#1a73e8', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      });
      setGeoJSON(m, 'parking', EMPTY);
      ensureLayer(m, { id: 'parking', type: 'circle', source: 'parking', paint: { 'circle-radius': 11, 'circle-color': '#1a73e8', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      ensureLayer(m, { id: 'parking-label', type: 'symbol', source: 'parking', layout: { 'text-field': 'P', 'text-size': 14, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
      drawParking();
      const s = nav.peek();
      if (s) {
        drawProgress(s);
        drawPuck(s);
      }
    });
    // Panning or zooming the map by hand stops following, until "re-center" (like Google).
    const handUp = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && nav.peek() && following.peek()) following.value = false;
    };
    for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) ctx.map.on(ev, handUp);
    parking.subscribe(() => drawParking());
    ctx.onMapClick((_e, features) => {
      const f = features.find((x) => x.layer.id === 'parking' || x.layer.id === 'parking-label');
      const pk = parking.peek();
      if (!f || !pk) return;
      open({ kind: 'directions', props: { to: droppedPin(pk.lng, pk.lat, 'החניה שלי'), mode: 'walk' } });
      return true;
    }, 80);

    // The browser killed the page mid-drive (iOS does this often): offer to go on.
    const saved = load<SavedNav | null>(SAVED_KEY, null);
    if (saved?.route?.geometry?.length && Date.now() - saved.at < 2 * 3600_000 && !ctx.initialUrl.route) {
      const g = saved.route.geometry;
      setTimeout(
        () =>
          toast(
            saved.destination ? `להמשיך בניווט אל ${saved.destination.name}?` : 'להמשיך בניווט?',
            { label: 'המשך', run: () => open({ kind: 'navigate', props: { route: saved.route, destination: saved.destination, waypoints: [g[0], ...saved.vias, g[g.length - 1]] } }) },
            12000,
          ),
        1200,
      );
      remove(SAVED_KEY);
    }
    // Leaving the navigate screen by the back button also stops navigation.
    currentView.subscribe((v) => {
      if (v.kind !== 'navigate' && nav.peek()) stop();
    });
  },
});
