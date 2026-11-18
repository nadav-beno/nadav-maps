import { Capacitor, registerPlugin } from '@capacitor/core';
import { signal } from '@preact/signals';

/**
 * The iPhone app (apps/mobile) is a native shell around the deployed site. Inside it,
 * `window.Capacitor` is injected and the native plugins below are reachable; on the web
 * everything here is a no-op, so features never need to care where they run.
 */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/**
 * Keep location running while the app is in the background (a feature turns it on while it
 * needs it, e.g. "אנשים" while sharing). Only the native app can honour it; the web stops GPS
 * when the page is hidden.
 */
export const backgroundLocation = signal(false);

// @capacitor-community/background-geolocation, registered by name so the site bundle needs
// only @capacitor/core. Types follow the plugin's definitions.d.ts.
interface NativeFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  bearing: number | null;
  speed: number | null;
  time: number | null;
}
interface NativeError extends Error {
  code?: string;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    callback: (fix?: NativeFix, error?: NativeError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/** Opens this app's page in the iPhone's Settings (location permission lives there). */
export function openAppSettings(): void {
  if (isNativeApp()) void BackgroundGeolocation.openSettings().catch(() => {});
}

/** A native fix in the shape of the web's GeolocationPosition. */
export function toPosition(f: NativeFix): GeolocationPosition {
  const coords = {
    latitude: f.latitude,
    longitude: f.longitude,
    accuracy: f.accuracy,
    altitude: f.altitude,
    altitudeAccuracy: f.altitudeAccuracy,
    heading: f.bearing !== null && f.bearing >= 0 ? f.bearing : null,
    speed: f.speed !== null && f.speed >= 0 ? f.speed : null,
  };
  const timestamp = f.time ?? Date.now();
  return { coords: { ...coords, toJSON: () => coords }, timestamp, toJSON: () => ({ coords, timestamp }) } as GeolocationPosition;
}

/** A native failure in the shape of the web's GeolocationPositionError. */
export function toPositionError(code: 1 | 2 | 3, message: string): GeolocationPositionError {
  return { code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}
const fromNative = (e: NativeError) => toPositionError(e.code === 'NOT_AUTHORIZED' ? 1 : 2, e.message || 'location error');

interface Watch {
  onFix: PositionCallback;
  onError?: PositionErrorCallback | null;
  id?: Promise<string | null>;
  background: boolean;
}

/**
 * In the app, `navigator.geolocation` is served by the native location manager instead of
 * WebKit's: no second "the website wants your location" prompt, real background updates while
 * `backgroundLocation` is on, and the app's own permission (Settings > Nadav Maps > Location).
 * Every feature keeps calling the standard web API.
 */
export function installNativeGeolocation(): void {
  if (!isNativeApp()) return;
  const watches = new Map<number, Watch>();
  let next = 1;

  const start = (w: Watch) => {
    w.background = backgroundLocation.peek();
    w.id = BackgroundGeolocation.addWatcher(
      {
        // Setting a message is what turns on background updates (iOS shows the blue location pill).
        backgroundMessage: w.background ? 'המיקום שלך משותף עם חברים' : undefined,
        backgroundTitle: 'Nadav Maps',
        requestPermissions: true,
        stale: false,
        // In the background, every 10 m is plenty for friends and saves battery.
        distanceFilter: w.background ? 10 : 0,
      },
      (fix, error) => {
        if (error) w.onError?.(fromNative(error));
        else if (fix) w.onFix(toPosition(fix));
      },
    ).catch((e: NativeError) => {
      w.onError?.(fromNative(e));
      return null;
    });
  };
  const stop = (w: Watch) => {
    void w.id?.then((id) => (id ? BackgroundGeolocation.removeWatcher({ id }) : undefined)).catch(() => {});
    w.id = undefined;
  };

  // Turning background on or off restarts the running watches in the new mode.
  backgroundLocation.subscribe((on) => {
    for (const w of watches.values()) if (w.id && w.background !== on) (stop(w), start(w));
  });

  const geolocation: Geolocation = {
    watchPosition(onFix, onError) {
      const n = next++;
      const w: Watch = { onFix, onError, background: false };
      watches.set(n, w);
      start(w);
      return n;
    },
    clearWatch(n) {
      const w = watches.get(n);
      if (!w) return;
      stop(w);
      watches.delete(n);
    },
    getCurrentPosition(onFix, onError, options) {
      let done = false;
      const n = geolocation.watchPosition(
        (p) => {
          if (done) return;
          done = true;
          geolocation.clearWatch(n);
          onFix(p);
        },
        (e) => {
          if (done) return;
          done = true;
          geolocation.clearWatch(n);
          onError?.(e);
        },
      );
      const timeout = options?.timeout;
      if (timeout !== undefined && Number.isFinite(timeout))
        setTimeout(() => {
          if (done) return;
          done = true;
          geolocation.clearWatch(n);
          onError?.(toPositionError(3, 'timeout'));
        }, timeout);
    },
  };
  Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
}
