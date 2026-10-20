import { signal } from '@preact/signals';
import { incognito, load, requestLocation, save, simulatingLocation, toast, userLocation } from '@nm/core/app';
import { lastPoint, putPoints } from './db.ts';
import { keepPoint } from './segment.ts';
import type { TrackPoint } from './types.ts';

/**
 * Recording. A web app (and an iPhone home-screen app) can only read the location while
 * it is open on screen, so this records while the app is visible and says so in the UI.
 * It reuses the location feature's GPS (via the shared userLocation signal) and starts its
 * own watch only when that is not running (location feature switched off).
 * Fixes go to IndexedDB on this device, nowhere else.
 */
export const recording = signal<boolean>(load('timeline:recording', false));
recording.subscribe((v) => save('timeline:recording', v));
export const keepAwake = signal<boolean>(load('timeline:keepAwake', false));
keepAwake.subscribe((v) => save('timeline:keepAwake', v));

export type WakeState = 'off' | 'on' | 'unsupported' | 'failed';
export const wakeState = signal<WakeState>('off');
/** Fixes stored since recording was switched on in this session. */
export const savedCount = signal(0);
export const lastSavedAt = signal<number | null>(null);

let prev: TrackPoint | undefined;
let prevLoaded: Promise<void> | null = null;
let ownWatch: number | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
let lastShared = 0;
// Simulated drives (?simulate=1) move the shared location; they are not where you went.
const simulated = typeof location !== 'undefined' && new URLSearchParams(location.search).has('simulate');

async function record(p: TrackPoint): Promise<void> {
  if (!recording.value || document.hidden || incognito.peek()) return;
  prevLoaded ??= lastPoint()
    .then((lp) => {
      if (lp && (!prev || lp.t > prev.t)) prev = lp;
    })
    .catch(() => {});
  await prevLoaded;
  if (!keepPoint(prev, p)) return;
  prev = p;
  try {
    await putPoints([p]);
    savedCount.value++;
    lastSavedAt.value = p.t;
  } catch {
    /* storage blocked (private mode): nothing to do */
  }
}

function startOwnWatch() {
  if (ownWatch !== null || !('geolocation' in navigator)) return;
  ownWatch = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      void record({ t: pos.timestamp, lng: c.longitude, lat: c.latitude, acc: c.accuracy, speed: c.speed, alt: c.altitude });
    },
    (err) => {
      if (err.code === 1) {
        toast('אין הרשאת מיקום, ולכן ציר הזמן לא מקליט.');
        recording.value = false;
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}

function stopOwnWatch() {
  if (ownWatch !== null) navigator.geolocation.clearWatch(ownWatch);
  ownWatch = null;
}

type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void };
let lock: Sentinel | null = null;

async function syncWakeLock(): Promise<void> {
  const want = recording.value && keepAwake.value && !document.hidden;
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (want && !lock) {
    if (!wl) {
      wakeState.value = 'unsupported';
      return;
    }
    try {
      const l = await wl.request('screen');
      lock = l;
      wakeState.value = 'on';
      l.addEventListener('release', () => {
        if (lock === l) lock = null;
        if (wakeState.value === 'on') wakeState.value = 'off';
      });
    } catch {
      // Low battery mode, or the browser refused: recording goes on, the screen may sleep.
      wakeState.value = 'failed';
    }
  } else if (!want) {
    const l = lock;
    lock = null;
    if (wakeState.value !== 'unsupported') wakeState.value = 'off';
    try {
      await l?.release();
    } catch {
      /* already released */
    }
  }
}

function recordShared() {
  const u = userLocation.value;
  if (!u || simulated) return;
  void record({ t: u.timestamp, lng: u.lng, lat: u.lat, acc: u.accuracy, speed: u.speed ?? null });
}

function start() {
  if (document.hidden) return;
  requestLocation();
  // The GPS may already be on (the blue dot): start from its latest fix if it is fresh.
  if (userLocation.value && Date.now() - userLocation.value.timestamp < 60_000) recordShared();
  clearTimeout(fallbackTimer);
  // If the shared GPS gives nothing within 10 s, run our own watch.
  fallbackTimer = setTimeout(() => {
    if (recording.value && !document.hidden && Date.now() - lastShared > 9000) startOwnWatch();
  }, 10_000);
  void syncWakeLock();
}

function stop() {
  clearTimeout(fallbackTimer);
  stopOwnWatch();
  void syncWakeLock();
}

let started = false;
export function initRecorder(): void {
  if (started) return;
  started = true;
  userLocation.subscribe((u) => {
    if (!u || simulated || simulatingLocation.peek()) return;
    lastShared = Date.now();
    if (ownWatch === null) recordShared();
  });
  recording.subscribe((on) => {
    if (on) {
      savedCount.value = 0;
      start();
    } else stop();
  });
  keepAwake.subscribe(() => void syncWakeLock());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopOwnWatch();
      void syncWakeLock();
    } else if (recording.value) start();
  });
}
