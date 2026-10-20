import { signal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { circle, formatDistance, plausibleFix, type Fix } from '@nm/core';
import { cssVar, defineFeature, ensureLayer, EMPTY, Icon, immersive, load, locationRequests, open, save, setGeoJSON, toast, units, userLocation } from '@nm/core/app';
import { PermissionsView } from './permissions.tsx';

/**
 * The "my location" button, six states (see spec):
 *  off -> locating -> shown (dot on map) -> follow (map tracks you) -> compass (map turns with you)
 *  denied / unavailable -> explain how to fix.
 * Location stays on the device; we never send it anywhere unless you ask for a route from it.
 */
export type LocState = 'off' | 'locating' | 'shown' | 'follow' | 'compass' | 'error';
export const locState = signal<LocState>('off');
const errorKind = signal<'denied' | 'unavailable' | 'timeout' | null>(null);
/** GPS jamming/spoofing suspected: fixes jump impossibly far, so we keep the last good one. */
const gpsSuspect = signal(false);
/** Asking before the browser's own permission prompt, so people know why (once). */
const prePrompt = signal<null | (() => void)>(null);
const approxDismissed = signal(false);
let lastGood: Fix | null = null;

/**
 * Permissions we remember on the device. A web app cannot grant itself permissions (only the
 * user can, in the phone's settings); what we can do is ask again at the right moment by itself,
 * so once allowed, location and the compass simply work on every launch.
 */
const LOC_OK = 'location:granted';
const MOTION_OK = 'motion:granted';
export type PermState = 'granted' | 'denied' | 'ask';
export const locPermission = signal<PermState>(load<boolean | null>(LOC_OK, null) === false ? 'denied' : load(LOC_OK, false) ? 'granted' : 'ask');
export const motionPermission = signal<PermState>(load<boolean | null>(MOTION_OK, null) === false ? 'denied' : load(MOTION_OK, false) ? 'granted' : 'ask');
function rememberLocation(v: PermState) {
  locPermission.value = v;
  if (v !== 'ask') save(LOC_OK, v === 'granted');
}
let suspectSince = 0;

let map: MapLibreMap;
let watchId: number | null = null;
let firstFix = true;
let compassHeading: number | null = null;
/** State to enter on the first fix: follow (button press) or shown (quiet start). */
let stateAfterFix: LocState = 'follow';

function render() {
  const u = userLocation.value;
  if (!map.getSource('me-accuracy')) return;
  if (!u) {
    setGeoJSON(map, 'me-accuracy', EMPTY);
    setGeoJSON(map, 'me-dot', EMPTY);
    return;
  }
  setGeoJSON(map, 'me-accuracy', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle([u.lng, u.lat], Math.min(u.accuracy, 2000))] } }],
  });
  const heading = compassHeading ?? (u.speed && u.speed > 1 ? u.heading : null);
  setGeoJSON(map, 'me-dot', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { heading: heading ?? 0, hasHeading: heading !== null && heading !== undefined }, geometry: { type: 'Point', coordinates: [u.lng, u.lat] } }],
  });
}

function follow(animate = true) {
  const u = userLocation.value;
  if (!u) return;
  const opts = { center: [u.lng, u.lat] as [number, number], bearing: locState.value === 'compass' && compassHeading !== null ? compassHeading : map.getBearing() };
  if (animate) map.easeTo({ ...opts, duration: 500 });
  else map.jumpTo(opts);
}

function onPosition(pos: GeolocationPosition) {
  const c = pos.coords;
  const fix: Fix = { lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, timestamp: pos.timestamp };
  if (!plausibleFix(lastGood, fix)) {
    // Keep the last good position. After 3 minutes of steady "impossible" fixes, believe them
    // (the device really moved while the page slept and the clock jumped less than it should).
    const now = Date.now();
    if (!gpsSuspect.peek()) {
      suspectSince = now;
      gpsSuspect.value = true;
      toast('זוהתה קפיצה חשודה במיקום (שיבוש GPS). מציגים את המיקום האחרון הידוע.', undefined, 7000);
    }
    if (now - suspectSince < 3 * 60000) return;
  }
  gpsSuspect.value = false;
  lastGood = fix;
  if (locPermission.peek() !== 'granted') rememberLocation('granted');
  userLocation.value = { lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, heading: c.heading, speed: c.speed, timestamp: pos.timestamp };
  errorKind.value = null;
  if (locState.value === 'locating' || locState.value === 'error') {
    locState.value = stateAfterFix;
    stateAfterFix = 'follow';
  }
  if (firstFix) {
    firstFix = false;
    // Zoom so the accuracy circle fits comfortably.
    const z = c.accuracy > 2000 ? 12 : c.accuracy > 300 ? 14 : 16;
    map.flyTo({ center: [c.longitude, c.latitude], zoom: Math.max(map.getZoom(), z), duration: 900 });
  } else if (locState.value === 'follow' || locState.value === 'compass') {
    if (!immersive.value) follow();
  }
  render();
}

function onError(err: GeolocationPositionError) {
  errorKind.value = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable';
  if (err.code === 1) rememberLocation('denied');
  if (err.code === 3 && userLocation.value) return; // a slow fix after a good one is fine
  locState.value = 'error';
  stopWatch();
  explainError();
}

function explainError() {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (errorKind.value === 'denied') {
    toast(
      isIOS
        ? 'אין הרשאת מיקום. בהגדרות האייפון: פרטיות ואבטחה ← שירותי מיקום ← אתרי Safari ← בזמן השימוש.'
        : 'אין הרשאת מיקום. אפשר לאשר אותה בהגדרות האתר בדפדפן (סמל המנעול ליד הכתובת).',
      { label: 'איך מאשרים', run: () => open({ kind: 'permissions' }) },
      8000,
    );
  } else if (errorKind.value === 'timeout') toast('לא הצלחנו למצוא את המיקום. נסו שוב במקום פתוח יותר.');
  else toast('המיקום לא זמין במכשיר הזה כרגע.');
}

/** Start GPS, first explaining why if the browser is about to ask for permission. */
async function askThenWatch(then?: () => void) {
  const go = () => {
    startWatch();
    then?.();
  };
  if (load('location:explained', false)) return go();
  let state: PermissionState | 'unknown' = 'unknown';
  try {
    state = (await navigator.permissions?.query({ name: 'geolocation' as PermissionName }))?.state ?? 'unknown';
  } catch {
    /* Safari before 16 */
  }
  if (state === 'granted' || state === 'denied') return go();
  prePrompt.value = () => {
    save('location:explained', true);
    go();
  };
}

function startWatch() {
  if (!('geolocation' in navigator)) {
    errorKind.value = 'unavailable';
    locState.value = 'error';
    explainError();
    return;
  }
  if (watchId !== null) return;
  firstFix = !userLocation.value;
  locState.value = 'locating';
  watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function stopWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

// --- compass (device orientation) ---
// Once motion is allowed the blue dot shows which way you face (a beam, like Google Maps);
// compass mode also turns the map. Redraws are limited, the sensor fires ~60 times a second.
let lastBeam = { h: -999, at: 0 };
function onOrientation(e: DeviceOrientationEvent) {
  const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  const h = ios ?? (e.absolute && e.alpha !== null ? (360 - e.alpha) % 360 : null);
  if (h === null || h === undefined) return;
  compassHeading = h;
  if (locState.value === 'compass' && !immersive.value) map.setBearing(h);
  const now = performance.now();
  const turned = Math.abs(((h - lastBeam.h + 540) % 360) - 180);
  if (turned < 3 || now - lastBeam.at < 100) return;
  lastBeam = { h, at: now };
  render();
}

let listening = false;
function listenOrientation() {
  if (listening) return;
  listening = true;
  addEventListener('deviceorientationabsolute' as 'deviceorientation', onOrientation);
  addEventListener('deviceorientation', onOrientation);
}

type MotionAPI = { requestPermission?: () => Promise<'granted' | 'denied'> };
const motionApi = () => (typeof DeviceOrientationEvent === 'undefined' ? null : (DeviceOrientationEvent as unknown as MotionAPI));

/** Ask for motion sensors (iPhone asks the user; must run inside a tap) and start listening. */
export async function requestMotion(): Promise<boolean> {
  const api = motionApi();
  if (!api) return false;
  try {
    if (typeof api.requestPermission === 'function' && (await api.requestPermission()) !== 'granted') {
      motionPermission.value = 'denied';
      save(MOTION_OK, false);
      return false;
    }
  } catch {
    // Not inside a tap (iPhone) or no sensor: nothing remembered, we try again on the next tap.
    return false;
  }
  motionPermission.value = 'granted';
  save(MOTION_OK, true);
  listenOrientation();
  return true;
}

async function startCompass(): Promise<boolean> {
  return listening || (await requestMotion());
}

function stopCompass() {
  map.easeTo({ bearing: 0, duration: 400 });
  render();
}

/** Ask for location now (from a tap in the permissions screen): no explanation card first. */
export function requestLocation() {
  save('location:explained', true);
  if (errorKind.peek() || watchId === null) {
    stopWatch();
    stateAfterFix = 'follow';
    startWatch();
  }
}

async function onButton() {
  switch (locState.value) {
    case 'off':
      void askThenWatch();
      break;
    case 'error':
      startWatch();
      break;
    case 'locating':
      break;
    case 'shown':
      locState.value = 'follow';
      follow();
      break;
    case 'follow':
      if (await startCompass()) {
        locState.value = 'compass';
      } else {
        toast('המצפן לא זמין במכשיר הזה');
      }
      break;
    case 'compass':
      stopCompass();
      locState.value = 'follow';
      break;
  }
}

const ICONS: Record<LocState, string> = {
  off: 'location_searching',
  locating: 'location_searching',
  shown: 'location_searching',
  follow: 'my_location',
  compass: 'navigation',
  error: 'location_disabled',
};
const LABEL: Record<LocState, string> = {
  off: 'הצגת המיקום שלי',
  locating: 'מחפש את המיקום…',
  shown: 'מרכוז על המיקום שלי',
  follow: 'המפה עוקבת אחריך. לחיצה מפעילה מצפן',
  compass: 'מצב מצפן. לחיצה מחזירה צפון למעלה',
  error: 'המיקום לא זמין. לחיצה לניסיון חוזר',
};

function PrePrompt() {
  const go = prePrompt.value;
  if (!go) return null;
  return (
    <div class="modal-backdrop" onClick={() => (prePrompt.value = null)}>
      <div class="modal loc-preprompt" role="dialog" aria-labelledby="loc-pp-title" onClick={(e) => e.stopPropagation()}>
        <Icon name="my_location" size={36} style={{ color: 'var(--accent)' }} />
        <h2 id="loc-pp-title">להראות איפה אתם?</h2>
        <p>כדי להציג את המיקום שלכם על המפה ולנווט ממנו, הדפדפן יבקש עכשיו הרשאת מיקום. כדאי לבחור "בזמן השימוש".</p>
        <p class="muted small">המיקום נשאר במכשיר. אנחנו לא שומרים אותו ולא שולחים אותו לשרתים שלנו.</p>
        <div class="modal-actions">
          <button class="btn" onClick={() => (prePrompt.value = null)}>
            לא עכשיו
          </button>
          <button
            class="btn primary"
            onClick={() => {
              prePrompt.value = null;
              go();
            }}
          >
            המשך
          </button>
        </div>
      </div>
    </div>
  );
}

/** Under the search bar: the position is only approximate, or looks jammed. */
function LocationNotice() {
  const u = userLocation.value;
  if (gpsSuspect.value)
    return (
      <div class="loc-notice warn" role="status">
        <Icon name="warning" size={18} />
        המיקום נראה משובש (שיבוש GPS). מוצג המיקום האחרון שנראה תקין.
      </div>
    );
  if (!u || u.accuracy <= 1000 || approxDismissed.value) return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <div class="loc-notice" role="status">
      <Icon name="location_searching" size={18} />
      <span>
        המיקום משוער בלבד (±{formatDistance(u.accuracy, units.value)}).{' '}
        {ios ? 'כדי לדייק: הגדרות ← פרטיות ← שירותי מיקום ← Safari ← "מיקום מדויק".' : 'כדאי להפעיל GPS או "דיוק מיקום" בהגדרות המכשיר.'}
      </span>
      <button class="icon-btn small" aria-label="סגירה" onClick={() => (approxDismissed.value = true)}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

function LocationButton() {
  const s = locState.value;
  return (
    <button
      class={`fab loc-${s} ${s === 'follow' || s === 'compass' ? 'active' : ''}`}
      aria-label={LABEL[s]}
      title={LABEL[s]}
      onClick={() => void onButton()}
    >
      <Icon name={ICONS[s]} class={s === 'locating' ? 'pulse' : ''} />
    </button>
  );
}

export default defineFeature({
  id: 'location',
  title: 'המיקום שלי',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerFab({ id: 'location', order: 0, Component: LocationButton });
    ctx.registerSlot('overlay', PrePrompt, 50);
    ctx.registerSlot('top', LocationNotice, 50);

    ctx.onStyle((m) => {
      setGeoJSON(m, 'me-accuracy', EMPTY);
      setGeoJSON(m, 'me-dot', EMPTY);
      // The familiar blue dot: blue disc, white ring, soft shadow, light blue accuracy circle.
      const me = cssVar('--me', '#4285f4');
      ensureLayer(m, { id: 'me-accuracy-fill', type: 'fill', source: 'me-accuracy', paint: { 'fill-color': me, 'fill-opacity': 0.16 } }, null);
      ensureLayer(m, { id: 'me-accuracy-line', type: 'line', source: 'me-accuracy', paint: { 'line-color': me, 'line-opacity': 0.4, 'line-width': 1 } }, null);
      ensureLayer(m, { id: 'me-shadow', type: 'circle', source: 'me-dot', paint: { 'circle-radius': 13, 'circle-color': '#000000', 'circle-opacity': 0.22, 'circle-blur': 0.6, 'circle-translate': [0, 1], 'circle-pitch-alignment': 'map' } }, null);
      ensureLayer(m, { id: 'me-halo', type: 'circle', source: 'me-dot', paint: { 'circle-radius': 11, 'circle-color': '#ffffff', 'circle-pitch-alignment': 'map' } }, null);
      ensureLayer(m, { id: 'me-dot', type: 'circle', source: 'me-dot', paint: { 'circle-radius': 8, 'circle-color': me, 'circle-pitch-alignment': 'map' } }, null);
      render();
    });
    userLocation.subscribe(() => render());

    // Other features (directions) can ask for the location without moving the map.
    locationRequests.subscribe((n) => {
      if (!n || watchId !== null || prePrompt.peek()) return;
      void askThenWatch();
      firstFix = false;
      stateAfterFix = 'shown';
    });

    // The user dragging the map ends follow mode (like every map app).
    ctx.map.on('dragstart', () => {
      if (locState.value === 'follow' || locState.value === 'compass') {
        if (locState.value === 'compass') stopCompass();
        locState.value = 'shown';
      }
    });

    // Resume quietly if permission was granted before, so the dot is there on launch. The
    // browser may say "granted" itself; an installed iPhone app often forgets and says "prompt",
    // so we also trust our own memory of the last answer (iPhone then asks again, at launch).
    const resume = (state: PermissionState | 'unknown') => {
      if (state === 'denied') return rememberLocation('denied');
      if (state !== 'granted' && locPermission.peek() !== 'granted') return;
      startWatch();
      // Don't steal the view from a shared link.
      if (ctx.initialUrl.view || ctx.initialUrl.place || ctx.initialUrl.route) {
        firstFix = false;
        stateAfterFix = 'shown';
      }
    };
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((st) => {
          resume(st.state);
          // Changed in the browser's own settings while the app is open.
          st.onchange = () => {
            if (st.state === 'denied') rememberLocation('denied');
            else if (st.state === 'granted' && watchId === null && locPermission.peek() !== 'granted') startWatch();
          };
        })
        .catch(() => resume('unknown'));
    } else resume('unknown');

    // Motion sensors (the direction beam and compass mode). Android and desktop need no prompt;
    // an iPhone only lets a page ask inside a tap, so once allowed we ask again on the first tap
    // of each launch, and the beam is back without going through any menu.
    const api = motionApi();
    if (api && typeof api.requestPermission !== 'function') listenOrientation();
    else if (api && motionPermission.peek() === 'granted') {
      const onTap = () => {
        document.removeEventListener('click', onTap, true);
        document.removeEventListener('touchend', onTap, true);
        void requestMotion();
      };
      document.addEventListener('click', onTap, true);
      document.addEventListener('touchend', onTap, true);
    }

    ctx.registerView('permissions', PermissionsView, { title: 'הרשאות' });
    ctx.registerMenuItem({ id: 'permissions', label: 'הרשאות מיקום ותנועה', icon: 'my_location', order: 58, run: () => open({ kind: 'permissions' }) });

    // Save battery: stop GPS when the app is in the background, unless navigating.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !immersive.value) stopWatch();
      else if (!document.hidden && locState.value !== 'off' && locState.value !== 'error' && watchId === null) {
        const prev = locState.value;
        firstFix = false;
        startWatch();
        locState.value = prev === 'locating' ? 'locating' : prev;
      }
    });
  },
});
