import { signal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { circle } from '@nm/core';
import { cssVar, defineFeature, ensureLayer, EMPTY, immersive, locationRequests, setGeoJSON, toast, userLocation } from '@nm/core/app';

/**
 * The "my location" button, six states (see spec):
 *  off -> locating -> shown (dot on map) -> follow (map tracks you) -> compass (map turns with you)
 *  denied / unavailable -> explain how to fix.
 * Location stays on the device; we never send it anywhere unless you ask for a route from it.
 */
export type LocState = 'off' | 'locating' | 'shown' | 'follow' | 'compass' | 'error';
export const locState = signal<LocState>('off');
const errorKind = signal<'denied' | 'unavailable' | 'timeout' | null>(null);

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
        ? 'אין הרשאת מיקום. בהגדרות האייפון: פרטיות ואבטחה ← שירותי מיקום ← Safari (או האפליקציה) ← בזמן השימוש.'
        : 'אין הרשאת מיקום. אפשר לאשר אותה בהגדרות האתר בדפדפן (סמל המנעול ליד הכתובת).',
      undefined,
      8000,
    );
  } else if (errorKind.value === 'timeout') toast('לא הצלחנו למצוא את המיקום. נסו שוב במקום פתוח יותר.');
  else toast('המיקום לא זמין במכשיר הזה כרגע.');
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
function onOrientation(e: DeviceOrientationEvent) {
  const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  const h = ios ?? (e.absolute && e.alpha !== null ? (360 - e.alpha) % 360 : null);
  if (h === null || h === undefined) return;
  compassHeading = h;
  if (locState.value === 'compass' && !immersive.value) map.setBearing(h);
  render();
}

async function startCompass(): Promise<boolean> {
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
  try {
    if (typeof DOE.requestPermission === 'function') {
      if ((await DOE.requestPermission()) !== 'granted') return false;
    }
  } catch {
    return false;
  }
  addEventListener('deviceorientationabsolute' as 'deviceorientation', onOrientation);
  addEventListener('deviceorientation', onOrientation);
  return true;
}

function stopCompass() {
  removeEventListener('deviceorientationabsolute' as 'deviceorientation', onOrientation);
  removeEventListener('deviceorientation', onOrientation);
  compassHeading = null;
  map.easeTo({ bearing: 0, duration: 400 });
  render();
}

async function onButton() {
  switch (locState.value) {
    case 'off':
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
  off: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  locating: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  shown: 'M20.94 11A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  follow: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  compass: 'M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z',
  error: 'M20.94 11A8.99 8.99 0 0 0 13 3.06V1h-2v2.06c-1.13.12-2.19.46-3.16.97l1.5 1.5A6.97 6.97 0 0 1 19 12c0 .94-.19 1.84-.52 2.65l1.5 1.5c.5-.96.84-2.02.97-3.15H23v-2h-2.06ZM3 4.27l2.04 2.04A8.94 8.94 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06c1.77-.2 3.38-.91 4.69-1.98L19.73 21 21 19.73 4.27 3 3 4.27Zm13.27 13.27A6.97 6.97 0 0 1 5 12c0-1.61.55-3.09 1.46-4.27l9.81 9.81Z',
};
const LABEL: Record<LocState, string> = {
  off: 'הצגת המיקום שלי',
  locating: 'מחפש את המיקום…',
  shown: 'מרכוז על המיקום שלי',
  follow: 'המפה עוקבת אחריך. לחיצה מפעילה מצפן',
  compass: 'מצב מצפן. לחיצה מחזירה צפון למעלה',
  error: 'המיקום לא זמין. לחיצה לניסיון חוזר',
};

function LocationButton() {
  const s = locState.value;
  return (
    <button
      class={`fab loc-${s} ${s === 'follow' || s === 'compass' ? 'active' : ''}`}
      aria-label={LABEL[s]}
      title={LABEL[s]}
      onClick={() => void onButton()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" class={s === 'locating' ? 'pulse' : ''}>
        <path fill="currentColor" d={ICONS[s]} />
      </svg>
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

    ctx.onStyle((m) => {
      setGeoJSON(m, 'me-accuracy', EMPTY);
      setGeoJSON(m, 'me-dot', EMPTY);
      const accent = cssVar('--accent', '#1a73e8');
      ensureLayer(m, { id: 'me-accuracy-fill', type: 'fill', source: 'me-accuracy', paint: { 'fill-color': accent, 'fill-opacity': 0.12 } }, null);
      ensureLayer(m, { id: 'me-accuracy-line', type: 'line', source: 'me-accuracy', paint: { 'line-color': accent, 'line-opacity': 0.35, 'line-width': 1 } }, null);
      ensureLayer(m, { id: 'me-halo', type: 'circle', source: 'me-dot', paint: { 'circle-radius': 12, 'circle-color': '#ffffff', 'circle-pitch-alignment': 'map' } }, null);
      ensureLayer(m, { id: 'me-dot', type: 'circle', source: 'me-dot', paint: { 'circle-radius': 8, 'circle-color': '#1a73e8', 'circle-pitch-alignment': 'map' } }, null);
      render();
    });
    userLocation.subscribe(() => render());

    // Other features (directions) can ask for the location without moving the map.
    locationRequests.subscribe((n) => {
      if (!n || watchId !== null) return;
      firstFix = false;
      stateAfterFix = 'shown';
      startWatch();
    });

    // The user dragging the map ends follow mode (like every map app).
    ctx.map.on('dragstart', () => {
      if (locState.value === 'follow' || locState.value === 'compass') {
        if (locState.value === 'compass') stopCompass();
        locState.value = 'shown';
      }
    });

    // Resume quietly if permission was already granted, so the dot is there on launch.
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((st) => {
        if (st.state === 'granted') {
          startWatch();
          // Don't steal the view from a shared link.
          if (ctx.initialUrl.view || ctx.initialUrl.place || ctx.initialUrl.route) {
            firstFix = false;
            stateAfterFix = 'shown';
          }
        }
      })
      .catch(() => {});

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
