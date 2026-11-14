/**
 * Step-by-step public transit navigation, like Google Maps': walk to the stop, wait for the line,
 * ride with stops counted down, get off, transfer, walk to the destination. The logic is the pure
 * state machine in @nm/core (transit-nav.ts); this file draws it, follows the user, and raises
 * the alerts: spoken, vibration, a banner, and a system notification while the page is hidden.
 */
import { batch, signal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  distance,
  formatClock,
  formatDistance,
  lineLength,
  startTransitNav,
  transitAlertText,
  updateTransitNav,
  type LngLat,
  type Place,
  type TransitAlert,
  type TransitItinerary,
  type TransitLeg,
  type TransitNavState,
} from '@nm/core';
import {
  back,
  currentView,
  EMPTY,
  ensureLayer,
  hideLocationDot,
  Icon,
  immersive,
  lineColors,
  LineChip,
  region,
  requestLocation,
  setGeoJSON,
  simulatingLocation,
  TRANSIT_ICON,
  units,
  userLocation,
  type FeatureContext,
  type ViewProps,
} from '@nm/core/app';

interface TransitNav {
  it: TransitItinerary;
  destination: Place | null;
  state: TransitNavState;
  /** The last alert, shown as a banner until the next one. */
  alert: { kind: TransitAlert; text: string; at: number } | null;
  muted: boolean;
  simulate: boolean;
  /** The clock the journey runs on (sped up in the preview). */
  now: number;
}

export const transitNav = signal<TransitNav | null>(null);
const following = signal(true);
let map: MapLibreMap;
let unsub: (() => void) | null = null;
let simTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let voiceOn: () => boolean = () => true;

function speak(text: string) {
  const s = transitNav.peek();
  if (!s || s.muted || !voiceOn() || typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'he-IL';
    const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith('he'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {
    /* no speech */
  }
}

/** Alerts that matter enough to buzz and, in the background, to notify. */
const URGENT: TransitAlert[] = ['leave-now', 'bus-soon', 'get-off-next', 'get-off', 'arrived'];

async function notify(text: string) {
  if (typeof document === 'undefined' || !document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    // Android Chrome only shows notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification('ניווט בתחבורה ציבורית', { body: text, tag: 'transit-nav', lang: 'he', dir: 'rtl' } as NotificationOptions);
    else new Notification('ניווט בתחבורה ציבורית', { body: text, tag: 'transit-nav' });
  } catch {
    /* notifications blocked */
  }
}

function raise(alerts: TransitAlert[], s: TransitNav) {
  if (!alerts.length) return s;
  // Several at once (a transfer right as a ride ends): the last one says what to do now.
  const kind = alerts[alerts.length - 1];
  const text = transitAlertText(kind, s.it, s.state);
  speak(text);
  if (URGENT.includes(kind)) {
    try {
      navigator.vibrate?.(kind === 'get-off' || kind === 'leave-now' ? [300, 120, 300] : 200);
    } catch {
      /* no vibration */
    }
    void notify(text);
  }
  return { ...s, alert: { kind, text, at: s.now } };
}

function onPosition(pos: LngLat, now: number) {
  const s = transitNav.peek();
  if (!s || s.state.phase === 'arrived') return;
  const { state, alerts } = updateTransitNav(s.it, s.state, pos, now);
  const next = raise(alerts, { ...s, state, now });
  transitNav.value = next;
  draw(next, pos);
  camera(next, pos);
}

// --- map ---

function legFeatures(it: TransitItinerary, from: number) {
  return it.legs.map((l, i) => ({
    type: 'Feature' as const,
    properties: { walk: l.kind === 'walk', done: i < from, color: l.kind === 'ride' ? lineColors(l.mode ?? 'bus', l.color).bg : '#1a73e8' },
    geometry: { type: 'LineString' as const, coordinates: l.geometry.length >= 2 ? l.geometry : [[l.from.lng, l.from.lat], [l.to.lng, l.to.lat]] },
  }));
}

function draw(s: TransitNav | null, pos?: LngLat) {
  if (!map?.getSource('tnav-legs')) return;
  setGeoJSON(map, 'tnav-legs', s ? { type: 'FeatureCollection', features: legFeatures(s.it, s.state.leg) } : EMPTY);
  setGeoJSON(
    map,
    'tnav-stops',
    s
      ? {
          type: 'FeatureCollection',
          features: s.it.legs
            .filter((l) => l.kind === 'ride')
            .flatMap((l) => [l.from, l.to])
            .map((p) => ({ type: 'Feature' as const, properties: { name: p.name }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
        }
      : EMPTY,
  );
  setGeoJSON(map, 'tnav-me', s && pos && s.simulate ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pos } } : EMPTY);
}

let lastCam: { pos: LngLat; zoom: number } | null = null;

function camera(s: TransitNav, pos: LngLat, duration = 800, force = false) {
  if (!following.peek()) return;
  // On foot close in; on a ride further out, so the stop to get off at comes into view early.
  const zoom = s.state.phase === 'ride' ? (s.state.toEndM < 1200 ? 15.5 : 14) : 17;
  // Only when the view would change visibly: a map that never stops animating starves slow phones.
  if (!force && lastCam && lastCam.zoom === zoom && distance(lastCam.pos, pos) < (zoom >= 17 ? 15 : 60)) return;
  lastCam = { pos, zoom };
  const opts = { center: pos, zoom, pitch: 0, bearing: 0, padding: { top: 200, bottom: 240, left: 0, right: 0 } };
  // The sped-up preview jumps instead of easing: at 4 steps a second the animations never end.
  if (s.simulate && !force) map.jumpTo(opts);
  else map.easeTo({ ...opts, duration });
}

function here(s: TransitNav): LngLat | null {
  const u = userLocation.peek();
  return u ? [u.lng, u.lat] : s.it.legs[0]?.geometry[0] ?? null;
}

function recenter() {
  following.value = true;
  const s = transitNav.peek();
  const p = s && here(s);
  if (s && p) camera(s, p, 600, true);
}

// --- preview: the journey played back quickly, the clock sped up ---

/** Where a traveller on schedule is at time `t`. */
export function positionAt(it: TransitItinerary, t: number): LngLat {
  const ms = (iso: string) => new Date(iso).getTime();
  for (let i = 0; i < it.legs.length; i++) {
    const l = it.legs[i];
    const g = l.geometry.length >= 2 ? l.geometry : ([[l.from.lng, l.from.lat], [l.to.lng, l.to.lat]] as LngLat[]);
    if (t < ms(l.start)) return g[0];
    if (t <= ms(l.end)) return along(g, (t - ms(l.start)) / Math.max(1, ms(l.end) - ms(l.start)));
  }
  const last = it.legs[it.legs.length - 1];
  return last ? [last.to.lng, last.to.lat] : [0, 0];
}

function along(g: LngLat[], f: number): LngLat {
  const target = lineLength(g) * Math.min(1, Math.max(0, f));
  let run = 0;
  for (let i = 0; i < g.length - 1; i++) {
    const d = distance(g[i], g[i + 1]);
    if (run + d >= target) {
      const k = d ? (target - run) / d : 0;
      return [g[i][0] + (g[i + 1][0] - g[i][0]) * k, g[i][1] + (g[i + 1][1] - g[i][1]) * k];
    }
    run += d;
  }
  return g[g.length - 1];
}

/** Preview speed: seconds of journey per real second (`?simrate=` speeds it up for tests). */
// Read at load: the shell's URL sync drops parameters it does not know.
const SIM_RATE = typeof location === 'undefined' ? 20 : Number(new URLSearchParams(location.search).get('simrate')) || 20;
const simRate = () => SIM_RATE;

function startSimulation(it: TransitItinerary) {
  let t = new Date(it.start).getTime() - 4 * 60_000;
  const end = new Date(it.end).getTime() + 60_000;
  const rate = simRate();
  simTimer = setInterval(() => {
    t = Math.min(end, t + rate * 250);
    const pos = positionAt(it, t);
    userLocation.value = { lng: pos[0], lat: pos[1], accuracy: 5, heading: null, speed: 1.3, timestamp: Date.now() };
    onPosition(pos, t);
    if (t >= end && simTimer) clearInterval(simTimer);
  }, 250);
}

// --- start / stop ---

function start(it: TransitItinerary, destination: Place | null, simulate: boolean) {
  const now = simulate ? new Date(it.start).getTime() - 4 * 60_000 : Date.now();
  const s: TransitNav = { it, destination, state: startTransitNav(it), alert: null, muted: !voiceOn(), simulate, now };
  batch(() => {
    transitNav.value = s;
    immersive.value = true;
    following.value = true;
  });
  // Asked from the tap on "start", which browsers require; only used while the page is hidden.
  if (!simulate && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
  const first = it.legs[0];
  const ride = it.legs.find((l) => l.kind === 'ride');
  speak(first?.kind === 'walk' && ride ? `יוצאים לדרך. הלכו לתחנה ${ride.from.name}` : 'יוצאים לדרך');
  draw(s);
  const p = here(s);
  lastCam = null;
  if (p) camera(s, p, 1200, true);
  simulatingLocation.value = simulate;
  if (simulate) {
    hideLocationDot.value = true;
    startSimulation(it);
    return;
  }
  requestLocation();
  unsub = userLocation.subscribe((u) => {
    if (u) onPosition([u.lng, u.lat], Date.now());
  });
  // Times count down even when standing still at the stop.
  clockTimer = setInterval(() => {
    const u = userLocation.peek();
    if (u) onPosition([u.lng, u.lat], Date.now());
    else if (transitNav.peek()) transitNav.value = { ...transitNav.peek()!, now: Date.now() };
  }, 15_000);
}

export function stopTransitNav() {
  const s = transitNav.peek();
  if (!s) return;
  unsub?.();
  unsub = null;
  if (simTimer) clearInterval(simTimer);
  if (clockTimer) clearInterval(clockTimer);
  simTimer = clockTimer = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  batch(() => {
    transitNav.value = null;
    immersive.value = false;
    simulatingLocation.value = false;
    hideLocationDot.value = false;
    if (s.simulate) userLocation.value = null;
  });
  draw(null);
}

// --- UI ---

const mins = (sec: number) => Math.max(0, Math.round(sec / 60));

function rideOf(s: TransitNav): TransitLeg | undefined {
  return s.it.legs.slice(s.state.leg).find((l) => l.kind === 'ride');
}

/** "בעוד 4 דק׳", "עכשיו", "לפני 2 דק׳". */
function inMinutes(sec: number): string {
  const m = Math.round(sec / 60);
  if (m > 0) return `בעוד ${m} דק׳`;
  if (m === 0) return 'עכשיו';
  return `לפני ${-m} דק׳`;
}

function Banner({ s }: { s: TransitNav }) {
  const st = s.state;
  const leg = s.it.legs[st.leg];
  const ride = rideOf(s);
  const u = units.value;
  if (st.phase === 'arrived') {
    return (
      <div class="nav-main">
        <span class="nav-arrow">
          <Icon name="sports_score" size={40} />
        </span>
        <div>
          <div class="nav-dist">הגעתם</div>
          <div class="nav-instr">{s.destination?.name ?? 'ליעד'}</div>
        </div>
      </div>
    );
  }
  if (st.phase === 'walk') {
    const toStop = ride && leg?.to.name === ride.from.name;
    const late = st.departInS !== undefined && st.walkS !== undefined && st.departInS < st.walkS;
    return (
      <div class="nav-main">
        <span class="nav-arrow">
          <Icon name="directions_walk" size={40} />
        </span>
        <div>
          <div class="nav-dist">{formatDistance(st.toEndM, u)}</div>
          <div class="nav-instr">{toStop ? `הליכה לתחנה ${ride!.from.name}` : `הליכה אל ${s.destination?.name ?? leg?.to.name ?? 'היעד'}`}</div>
          {ride && st.departInS !== undefined && (
            <div class={`tnav-sub ${late ? 'late' : ''}`}>
              <LineChip mode={ride.mode ?? 'bus'} line={ride.line} color={ride.color} textColor={ride.textColor} small /> יוצא {inMinutes(st.departInS)}
              {late ? ' · כדאי למהר' : ''}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (st.phase === 'wait' && leg) {
    return (
      <div class="nav-main">
        <span class="nav-arrow">
          <Icon name="schedule" size={40} />
        </span>
        <div>
          <div class="nav-dist">{st.departInS !== undefined && st.departInS > 30 ? `${mins(st.departInS)} דק׳` : 'מגיע'}</div>
          <div class="nav-instr">
            המתינו ל<LineChip mode={leg.mode ?? 'bus'} line={leg.line} color={leg.color} textColor={leg.textColor} small />
            {leg.headsign ? ` לכיוון ${leg.headsign}` : ''}
          </div>
          <div class="tnav-sub">
            תחנה {leg.from.name}
            {leg.from.track ? ` · רציף ${leg.from.track}` : ''} · {formatClock(leg.start, region.value.timeZone)}
            {leg.realtime ? ' · זמן אמת' : ''}
          </div>
        </div>
      </div>
    );
  }
  // Riding.
  const left = st.stopsLeft ?? 0;
  return (
    <div class="nav-main">
      <span class="nav-arrow">
        <Icon name={TRANSIT_ICON[leg?.mode ?? 'bus']} size={40} />
      </span>
      <div>
        <div class="nav-dist">{left === 0 ? 'רדו כאן' : left === 1 ? 'התחנה הבאה' : `עוד ${left} תחנות`}</div>
        <div class="nav-instr">רדו ב{leg?.to.name ? `תחנה ${leg.to.name}` : 'תחנה'}</div>
        {leg && (
          <div class="tnav-sub">
            <LineChip mode={leg.mode ?? 'bus'} line={leg.line} color={leg.color} textColor={leg.textColor} small />
            {leg.headsign ? ` לכיוון ${leg.headsign}` : ''} · הגעה {formatClock(leg.end, region.value.timeZone)}
          </div>
        )}
      </div>
    </div>
  );
}

/** The journey as a short list, the current part highlighted (Google's bottom sheet). */
function Legs({ s }: { s: TransitNav }) {
  return (
    <ol class="tnav-legs" aria-label="שלבי הנסיעה">
      {s.it.legs.map((l, i) => (
        <li key={i} class={i < s.state.leg || s.state.phase === 'arrived' ? 'done' : i === s.state.leg ? 'now' : ''}>
          {l.kind === 'walk' ? <Icon name="directions_walk" size={18} /> : <LineChip mode={l.mode ?? 'bus'} line={l.line} color={l.color} textColor={l.textColor} small />}
          <span class="tnav-leg-text">
            {l.kind === 'walk' ? `הליכה ${formatDistance(l.distanceM ?? lineLength(l.geometry), units.value)} אל ${i === s.it.legs.length - 1 ? s.destination?.name ?? l.to.name : l.to.name}` : `${l.from.name} ← ${l.to.name}${l.stops ? ` · ${l.stops} תחנות` : ''}`}
          </span>
          <span class="muted tiny">{formatClock(l.start, region.value.timeZone)}</span>
        </li>
      ))}
    </ol>
  );
}

export function TransitOverlay() {
  const s = transitNav.value;
  if (!s) return null;
  const arrived = s.state.phase === 'arrived';
  const leftS = Math.max(0, (new Date(s.it.end).getTime() - s.now) / 1000);
  const fresh = s.alert && s.now - s.alert.at < 90_000 && !arrived;
  return (
    <div class="nav-overlay tnav">
      <div class="nav-banner tnav-banner" role="status" aria-live="polite">
        <Banner s={s} />
        {fresh && s.alert && <div class="tnav-alert">{s.alert.text}</div>}
      </div>
      {s.simulate && <div class="nav-preview-badge">תצוגה מקדימה</div>}
      {!userLocation.value && !s.simulate && <div class="nav-wait">ממתין ל-GPS…</div>}
      {!following.value && !arrived && (
        <button class="nav-recenter" onClick={recenter}>
          <Icon name="navigation" size={20} />
          מרכז מחדש
        </button>
      )}
      <div class="nav-bottom tnav-bottom">
        <button
          class="icon-btn"
          aria-label={s.muted ? 'הפעלת קול' : 'השתקה'}
          onClick={() => {
            transitNav.value = { ...s, muted: !s.muted };
            if (!s.muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
          }}
        >
          <Icon name={s.muted ? 'volume_off' : 'volume_up'} />
        </button>
        <div class="nav-eta">
          <strong class="nav-left">{arrived ? 'הגעתם' : `${mins(leftS)} דק׳`}</strong>
          <span class="muted">הגעה {formatClock(s.it.end, region.value.timeZone)}</span>
        </div>
        <button
          class="btn danger"
          onClick={() => {
            stopTransitNav();
            back();
          }}
        >
          {arrived ? 'סיום' : 'יציאה'}
        </button>
        <Legs s={s} />
        <p class="nav-note">הזמנים לפי לוחות הזמנים וזמני אמת כשיש. כדאי לוודא בתחנה.</p>
      </div>
    </div>
  );
}

const started = new WeakSet<object>();

function TransitNavView({ view }: ViewProps<{ itinerary: TransitItinerary; destination?: Place | null; simulate?: boolean }>) {
  if (!transitNav.value && view.props?.itinerary && !started.has(view)) {
    started.add(view);
    queueMicrotask(() => start(view.props!.itinerary, view.props!.destination ?? null, !!view.props!.simulate || /[?&]simulate=1/.test(location.search)));
  }
  return null;
}

export function setupTransitNav(ctx: FeatureContext, opts: { voice: () => boolean }) {
  map = ctx.map;
  voiceOn = opts.voice;
  ctx.registerView('transit-nav', TransitNavView);
  ctx.registerSlot('overlay', TransitOverlay, 11);
  ctx.onStyle((m) => {
    setGeoJSON(m, 'tnav-legs', EMPTY);
    setGeoJSON(m, 'tnav-stops', EMPTY);
    setGeoJSON(m, 'tnav-me', EMPTY);
    const done = ['get', 'done'] as never;
    ensureLayer(m, { id: 'tnav-ride-casing', type: 'line', source: 'tnav-legs', filter: ['!', ['get', 'walk']] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 11 } });
    ensureLayer(m, { id: 'tnav-ride', type: 'line', source: 'tnav-legs', filter: ['!', ['get', 'walk']] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'] as never, 'line-width': 8, 'line-opacity': ['case', done, 0.35, 1] as never } });
    ensureLayer(m, { id: 'tnav-walk', type: 'line', source: 'tnav-legs', filter: ['get', 'walk'] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 6, 'line-dasharray': [0.1, 1.8], 'line-opacity': ['case', done, 0.35, 1] as never } });
    ensureLayer(m, { id: 'tnav-stops', type: 'circle', source: 'tnav-stops', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#202124', 'circle-stroke-width': 2.5 } });
    ensureLayer(m, { id: 'tnav-stops-label', type: 'symbol', source: 'tnav-stops', layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' }, paint: { 'text-color': '#202124', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    ensureLayer(m, { id: 'tnav-me', type: 'circle', source: 'tnav-me', paint: { 'circle-radius': 9, 'circle-color': '#1a73e8', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
    const s = transitNav.peek();
    if (s) draw(s, here(s) ?? undefined);
  });
  const handUp = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent && transitNav.peek() && following.peek()) following.value = false;
  };
  for (const ev of ['dragstart', 'zoomstart', 'rotatestart'] as const) ctx.map.on(ev, handUp);
  currentView.subscribe((v) => {
    if (v.kind !== 'transit-nav' && transitNav.peek()) stopTransitNav();
  });
}
