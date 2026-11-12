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

/** An adsb.lol /v2/point response around Tel Aviv: El Al 1 climbing out, and one on the ground at TLV. */
export function adsbAreaResponse() {
  return {
    ac: [
      { hex: '738075', flight: 'ELY001  ', r: '4X-EDF', t: 'B789', category: 'A5', desc: 'BOEING 787-9 Dreamliner', ownOp: 'El Al', alt_baro: 9000, alt_geom: 9150, gs: 300, track: 270, baro_rate: 2000, lat: 32.1, lon: 34.6, seen_pos: 0.5 },
      { hex: '4ca123', flight: 'RYR1234 ', r: 'EI-ABC', t: 'B738', category: 'A3', alt_baro: 'ground', gs: 4, track: 90, lat: 32.0055, lon: 34.8854, seen_pos: 2 },
    ],
    msg: 'No error',
    now: 1760000000000,
    total: 2,
  };
}

/** adsb.im /api/0/routeset for El Al 1: Tel Aviv to New York. */
export function routesetResponse() {
  return [
    {
      callsign: 'ELY001',
      _airport_codes_iata: 'TLV-JFK',
      _airports: [
        { name: 'Ben Gurion International Airport', iata: 'TLV', icao: 'LLBG', location: 'Tel Aviv', countryiso2: 'IL', lat: 32.011, lon: 34.887 },
        { name: 'John F Kennedy International Airport', iata: 'JFK', icao: 'KJFK', location: 'New York', countryiso2: 'US', lat: 40.64, lon: -73.779 },
      ],
      plausible: 1,
    },
  ];
}

/** An OpenSky /states/all response: three aircraft across the world. */
export function openskyResponse(time = 1760000000) {
  return {
    time,
    states: [
      ['738075', 'ELY001  ', 'Israel', time - 2, time, 30.1, 34.5, 11000, false, 250, 292.4, 0, null, 11200, '1000', false, 0],
      ['a1b2c3', 'UAL90   ', 'United States', time - 5, time, -74.1, 40.6, 3000, false, 140, 45, -6.5, null, 3050, '2000', false, 0],
      ['abcdef', 'JAL5    ', 'Japan', null, time, 139.8, 35.5, null, true, 0, 0, null, null, null, null, false, 0],
      ['bad', 'NOPOS', 'Nowhere', null, time, null, null, null, false, null, null, null, null, null, null, false, 0],
    ],
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
