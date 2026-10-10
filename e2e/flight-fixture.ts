/** An adsb.lol /v2/callsign response (readsb format) for El Al 1 over the Mediterranean. */
export function adsbResponse(callsign = 'ELY001') {
  return {
    ac: [
      {
        hex: '738075',
        type: 'adsb_icao',
        flight: `${callsign}  `,
        r: '4X-EDF',
        t: 'B789',
        alt_baro: 37000,
        alt_geom: 37650,
        gs: 482.3,
        track: 292.4,
        lat: 34.512,
        lon: 30.118,
        seen_pos: 1.4,
        seen: 0.3,
      },
    ],
    msg: 'No error',
    now: 1760000000000,
    total: 1,
    ctime: 1760000000000,
    ptime: 3,
  };
}

export interface FakeFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  /** Seconds after the first fix (GPS timestamps). */
  at: number;
}

/** A flight west over Greece at 240 m/s and 11 km, one fix every 20 s of GPS time. */
export const FLIGHT_FIXES: FakeFix[] = Array.from({ length: 12 }, (_, i) => ({
  latitude: 39.6 + i * 0.01,
  longitude: 22.6 - i * 0.05,
  accuracy: 12,
  altitude: 11000,
  speed: 240,
  heading: 285,
  at: i * 20,
}));

/**
 * Replaces navigator.geolocation in the page with a scripted GPS: fixes come every
 * 300 ms (an empty list means no fix ever, as before a plane's GPS locks on).
 */
export async function fakeGps(page: import('@playwright/test').Page, fixes: FakeFix[]): Promise<void> {
  await page.addInitScript((list: FakeFix[]) => {
    const base = Date.now();
    let i = 0;
    let next = 1;
    const timers = new Map<number, ReturnType<typeof setInterval>>();
    const emit = (ok: PositionCallback) => {
      const f = list[Math.min(i, list.length - 1)];
      i++;
      ok({
        coords: { ...f, altitudeAccuracy: null, toJSON: () => f } as unknown as GeolocationCoordinates,
        timestamp: base + f.at * 1000,
        toJSON: () => f,
      } as GeolocationPosition);
    };
    const geo = {
      getCurrentPosition(ok: PositionCallback) {
        if (list.length) setTimeout(() => emit(ok), 50);
      },
      watchPosition(ok: PositionCallback) {
        const id = next++;
        if (list.length) {
          setTimeout(() => emit(ok), 50);
          // Then quiet, like a GPS that only reports changes.
          timers.set(id, setInterval(() => i < list.length && emit(ok), 300));
        }
        return id;
      },
      clearWatch(id: number) {
        clearInterval(timers.get(id));
        timers.delete(id);
      },
    };
    Object.defineProperty(navigator, 'geolocation', { get: () => geo, configurable: true });
  }, fixes);
}
