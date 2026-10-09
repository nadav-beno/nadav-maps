import { batch, signal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { formatArrival, formatDistance, formatDuration, maneuverIcon, type LngLat, type Place, type Route } from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  ensureLayer,
  Icon,
  EMPTY,
  immersive,
  region,
  requestLocation,
  setGeoJSON,
  toast,
  units,
  userLocation,
  type ViewProps,
} from '@nm/core/app';
import { getDirections, spokenInstruction, tools } from '@nm/tools';
import { cumulative, progressOn, promptDue, type Progress } from './engine.ts';

interface NavState {
  route: Route;
  cum: number[];
  destination: Place | null;
  progress: Progress | null;
  muted: boolean;
  rerouting: boolean;
  arrived: boolean;
  simulate: boolean;
}

const nav = signal<NavState | null>(null);
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
  if (nav.peek()?.muted || typeof speechSynthesis === 'undefined') return;
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
}

function camera(s: NavState, pos: LngLat) {
  const p = s.progress;
  const u = userLocation.peek();
  const heading = u?.heading !== null && u?.heading !== undefined && (u.speed ?? 0) > 2 ? u.heading : p?.course ?? map.getBearing();
  map.easeTo({
    center: pos,
    bearing: heading,
    pitch: s.route.mode === 'car' ? 55 : 35,
    zoom: s.route.mode === 'car' ? (p && p.toNextM < 300 ? 17.5 : 16.5) : 18,
    duration: 900,
    easing: (t) => t,
    padding: { top: 160, bottom: 140, left: 0, right: 0 },
  });
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
      { waypoints: [pos, dest], mode: s.route.mode, alternatives: 0, heading: u?.heading ?? s.progress?.course, includeGeometry: true },
      { cache: false },
    );
    const cur = nav.peek();
    if (!cur) return;
    if (r) {
      said = new Set();
      saidFor = -1;
      nav.value = { ...cur, route: r, cum: cumulative(r.geometry), rerouting: false, progress: null };
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
  const next = { ...s, progress: p };

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
  camera(next, s.simulate ? p.snapped : pos);
}

function distanceBetweenSteps(s: NavState, p: Progress): number {
  if (!p.next || !p.after) return Infinity;
  return s.cum[p.after.shapeIndex] - s.cum[p.next.shapeIndex];
}

function startSimulation(s: NavState) {
  let travelled = 0;
  const speed = s.route.mode === 'car' ? 25 : s.route.mode === 'bike' ? 8 : 3; // m/s, a bit fast for demos
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

function start(route: Route, destination: Place | null, simulate: boolean) {
  said = new Set();
  saidFor = -1;
  offCount = 0;
  const s: NavState = { route, cum: cumulative(route.geometry), destination, progress: null, muted: false, rerouting: false, arrived: false, simulate };
  nav.value = s;
  immersive.value = true;
  if (typeof speechSynthesis !== 'undefined') {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  speak(`יוצאים לדרך. ${route.steps[1] ? spokenInstruction(route.steps[1], route.steps[0]?.distanceM) : ''}`);
  void keepAwake();
  document.addEventListener('visibilitychange', onVisibility);
  drawProgress(s);
  if (simulate) startSimulation(s);
  else requestLocation();
  unsubLocation = userLocation.subscribe((u) => {
    if (u) onPosition([u.lng, u.lat], u.accuracy);
  });
}

function stop() {
  unsubLocation?.();
  unsubLocation = null;
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  document.removeEventListener('visibilitychange', onVisibility);
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  batch(() => {
    nav.value = null;
    immersive.value = false;
  });
  if (map.getSource('nav-route')) setGeoJSON(map, 'nav-route', EMPTY);
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
}

function ArrowIcon({ type }: { type: number }) {
  return (
    <span class="nav-arrow">
      <Icon name={maneuverIcon(type)} size={44} />
    </span>
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
        {!s.arrived && p?.after && p.toNextM < 400 && (
          <div class="nav-then">
            ואז <Icon name={maneuverIcon(p.after.type)} size={20} /> {p.after.instruction}
          </div>
        )}
      </div>
      {!userLocation.value && !s.simulate && <div class="nav-wait">ממתין ל-GPS…</div>}
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
          {p ? (
            <>
              <strong>{formatArrival(p.remainingS, Date.now(), region.value.timeZone)}</strong>
              <span class="muted">
                {formatDuration(p.remainingS)} · {formatDistance(p.remainingM, u)}
              </span>
            </>
          ) : (
            <>
              <strong>{formatArrival(s.route.durationS, Date.now(), region.value.timeZone)}</strong>
              <span class="muted">
                {formatDuration(s.route.durationS)} · {formatDistance(s.route.distanceM, u)}
              </span>
            </>
          )}
        </div>
        <button
          class="btn danger"
          onClick={() => {
            stop();
            back();
          }}
        >
          {s.arrived ? 'סיום' : 'יציאה'}
        </button>
      </div>
      <p class="nav-note">ללא נתוני תנועה בשלב הזה. שימו לב לתמרורים ולמצב הדרך.</p>
    </div>
  );
}

/** The 'navigate' screen starts navigation; the UI itself is the full-screen overlay. */
function NavigateView({ view }: ViewProps<{ route: Route; destination: Place | null; simulate?: boolean }>) {
  if (!nav.value && view.props?.route) {
    queueMicrotask(() => start(view.props!.route, view.props!.destination ?? null, !!view.props!.simulate || /[?&]simulate=1/.test(location.search)));
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
    ctx.registerSlot('overlay', Overlay, 10);
    ctx.onStyle((m) => {
      setGeoJSON(m, 'nav-route', EMPTY);
      ensureLayer(m, { id: 'nav-route-casing', type: 'line', source: 'nav-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0d47a1', 'line-width': 14 } });
      ensureLayer(m, { id: 'nav-route', type: 'line', source: 'nav-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4285f4', 'line-width': 10 } });
      const s = nav.peek();
      if (s) drawProgress(s);
    });
    // Leaving the navigate screen by the back button also stops navigation.
    currentView.subscribe((v) => {
      if (v.kind !== 'navigate' && nav.peek()) stop();
    });
  },
});
