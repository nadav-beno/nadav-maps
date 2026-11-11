import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { clampBbox, coverCircles, middleCircles, openskyCredits, parseOpenSky, resetOpenSkyPause } from './providers/live-aircraft.ts';
import { parseAdsb } from './providers/adsb.ts';
import { liveFlights, TOOLS } from './tools/index.ts';
import { adsbAreaResponse, openskyResponse } from '../../../e2e/flight-fixture.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('live flights', () => {
  it('covers a city or a country with a few 250 NM circles, and gives up on a continent', () => {
    const israel = coverCircles([34.2, 29.4, 35.9, 33.4]);
    expect(israel).toHaveLength(1);
    expect(israel![0].radiusNm).toBeLessThanOrEqual(250);
    expect(israel![0]).toMatchObject({ lat: 31.4, lon: 35.05 });
    const city = coverCircles([34.7, 32.0, 34.9, 32.15])!;
    expect(city[0].radiusNm).toBeLessThan(10);
    expect(coverCircles([-10, 35, 30, 60])).toBeNull(); // Europe
    expect(coverCircles([-180, -85, 180, 85])).toBeNull();
  });

  it('clamps wrapped map bounds and prices OpenSky calls by area', () => {
    expect(clampBbox([-200, -95, 200, 95])).toEqual([-180, -90, 180, 90]);
    expect(clampBbox([190, 10, 200, 20])).toEqual([-170, 10, -160, 20]);
    expect(clampBbox([170, 0, 190, 10])).toEqual([170, 0, 180, 10]);
    expect(openskyCredits([34, 29, 36, 33])).toBe(1);
    expect(openskyCredits([-10, 35, 30, 60])).toBe(4);
  });

  it('parses OpenSky state vectors into the same shape as ADS-B', () => {
    const { at, aircraft } = parseOpenSky(openskyResponse(1000));
    expect(at).toBe(1_000_000);
    expect(aircraft).toHaveLength(3);
    expect(aircraft[0]).toMatchObject({ hex: '738075', callsign: 'ELY001', lngLat: [30.1, 34.5], altitudeM: 11200, groundSpeedKmh: 900, track: 292.4, ageS: 2, country: 'Israel', onGround: false });
    expect(aircraft[1].verticalRateMs).toBe(-6.5);
    expect(aircraft[2]).toMatchObject({ onGround: true, altitudeM: 0, ageS: null });
    expect(parseOpenSky(null).aircraft).toEqual([]);
    expect(parseOpenSky({ states: 'x' }).aircraft).toEqual([]);
  });

  it('reads model, operator and climb rate from readsb', () => {
    const [a] = parseAdsb(adsbAreaResponse());
    expect(a).toMatchObject({ description: 'BOEING 787-9 Dreamliner', operator: 'El Al', verticalRateMs: 10.2 });
  });

  it('asks adsb.lol close up, OpenSky zoomed out, and falls back when OpenSky is out of credits', async () => {
    const urls: string[] = [];
    let opensky = 200;
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string | URL | Request) => {
      const url = String(u);
      urls.push(url);
      if (url.includes('opensky')) return opensky === 200 ? json(openskyResponse()) : json({}, opensky);
      return json(adsbAreaResponse());
    }) as typeof fetch);

    const near = await client.call(liveFlights, { bbox: [34.7, 32.0, 34.9, 32.15] }, { cache: false });
    expect(near.source).toBe('adsb');
    expect(near.aircraft).toHaveLength(2);
    expect(urls[0]).toMatch(/^https:\/\/api\.adsb\.lol\/v2\/point\/32\.075\/34\.8\/\d+$/);

    const world = await client.call(liveFlights, { bbox: [-200, -90, 200, 90] }, { cache: false });
    expect(world.source).toBe('opensky');
    expect(world.aircraft).toHaveLength(3);
    expect(urls[1]).toBe('https://opensky-network.org/api/states/all?extended=1');

    const europe = await client.call(liveFlights, { bbox: [-10, 35, 30, 60] }, { cache: false });
    expect(urls[2]).toBe('https://opensky-network.org/api/states/all?lamin=35&lomin=-10&lamax=60&lomax=30&extended=1');
    expect(europe.source).toBe('opensky');

    opensky = 429;
    let before = urls.length;
    const limited = await client.call(liveFlights, { bbox: [-10, 35, 30, 60] }, { cache: false });
    expect(limited).toMatchObject({ source: 'adsb', partial: true });
    expect(limited.note).toContain('מכסה');
    const fallback = urls.slice(before + 1);
    expect(fallback).toHaveLength(4);
    expect(fallback.every((u) => u.startsWith('https://api.adsb.lol/v2/point/') && u.endsWith('/250'))).toBe(true);

    // While paused, OpenSky is not asked again (each failed call would be a long wait).
    before = urls.length;
    const again = await client.call(liveFlights, { bbox: [-10, 35, 30, 60] }, { cache: false });
    expect(again.note).toContain('מכסה');
    expect(urls.slice(before).some((u) => u.includes('opensky'))).toBe(false);
    resetOpenSkyPause();
  });

  it('treats an unreachable OpenSky (blocked, no CORS) like an outage and pauses it', async () => {
    resetOpenSkyPause();
    const urls: string[] = [];
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string | URL | Request) => {
      urls.push(String(u));
      if (String(u).includes('opensky')) throw new TypeError('Failed to fetch');
      return json(adsbAreaResponse());
    }) as typeof fetch);
    const res = await client.call(liveFlights, { bbox: [-180, -85, 180, 85] }, { cache: false });
    expect(res).toMatchObject({ source: 'adsb', partial: true });
    expect(res.note).toContain('לא זמין');
    expect(res.aircraft).toHaveLength(2);
    await client.call(liveFlights, { bbox: [-180, -85, 180, 85] }, { cache: false });
    expect(urls.filter((u) => u.includes('opensky'))).toHaveLength(1);
    resetOpenSkyPause();
  });

  it('puts the fallback circles around the middle, inside the box', () => {
    const c = middleCircles([-10, 35, 30, 60]);
    expect(c).toHaveLength(4);
    for (const x of c) expect(Math.hypot(x.lon - 10, x.lat - 47.5)).toBeLessThan(6);
    // A box narrower than the block keeps only the circles inside it.
    expect(middleCircles([9, 30, 11, 65]).length).toBeGreaterThanOrEqual(1);
  });

  it('is in the tool list (REST + MCP)', () => {
    expect(TOOLS).toContain(liveFlights);
  });
});

describe('aircraft kinds and quality', () => {
  it('picks the silhouette from the emitter category, then the type', async () => {
    const { aircraftKind } = await import('./providers/adsb.ts');
    expect(aircraftKind('A5')).toBe('heavy');
    expect(aircraftKind('A7')).toBe('heli');
    expect(aircraftKind('A1')).toBe('light');
    expect(aircraftKind('A3', 'B738')).toBe('jet');
    expect(aircraftKind('', 'B789')).toBe('heavy');
    expect(aircraftKind(undefined, 'C172')).toBe('light');
    expect(aircraftKind(undefined, 'EC35')).toBe('heli');
    expect(aircraftKind('C1')).toBeNull(); // airport vehicle
    expect(aircraftKind(6)).toBe('heavy');
    expect(aircraftKind(8)).toBe('heli');
    expect(aircraftKind(17)).toBeNull();
    expect(aircraftKind(0)).toBe('jet');
  });

  it('drops stale positions and ground vehicles', async () => {
    const { liveOnly } = await import('./providers/live-aircraft.ts');
    const base = { callsign: 'X', hex: 'a', lngLat: [0, 0] as [number, number], altitudeM: 1000, onGround: false, groundSpeedKmh: 500, track: 0 };
    const out = liveOnly([
      { ...base, hex: 'fresh', ageS: 3, kind: 'jet' },
      { ...base, hex: 'stale', ageS: 300, kind: 'jet' },
      { ...base, hex: 'van', ageS: 1, kind: null },
      { ...base, hex: 'unknown-age', ageS: null },
    ]);
    expect(out.map((a) => a.hex)).toEqual(['fresh', 'unknown-age']);
  });
});

describe('flight route', () => {
  const TLV = { name: 'Ben Gurion', iata: 'TLV', icao: 'LLBG', location: 'Tel Aviv', countryiso2: 'IL', lat: 32.011, lon: 34.887 };
  const ATH = { name: 'Athens', iata: 'ATH', icao: 'LGAV', location: 'Athens', countryiso2: 'GR', lat: 37.936, lon: 23.947 };
  const JFK = { name: 'John F Kennedy', iata: 'JFK', icao: 'KJFK', location: 'New York', countryiso2: 'US', lat: 40.64, lon: -73.78 };

  it('reads the airports, and the current leg of a multi-stop route', async () => {
    const { parseRouteset } = await import('./providers/flight-route.ts');
    const direct = parseRouteset([{ callsign: 'ELY001', _airports: [TLV, JFK], plausible: 1 }], 'ELY001', [30, 34.5])!;
    expect(direct).toMatchObject({ from: { iata: 'TLV', city: 'Tel Aviv' }, to: { iata: 'JFK' }, plausible: true, stops: [] });
    // Between Athens and New York: the second leg.
    const multi = parseRouteset([{ callsign: 'ELY001', _airports: [TLV, ATH, JFK], plausible: 1 }], 'ELY001', [0, 45])!;
    expect(multi.from.iata).toBe('ATH');
    expect(multi.to.iata).toBe('JFK');
    expect(multi.stops.map((s) => s.iata)).toEqual(['TLV']);
    expect(parseRouteset([{ callsign: 'ELY001', _airports: [TLV, JFK], plausible: 0 }], 'ELY001', [0, 0])!.plausible).toBe(false);
    expect(parseRouteset([{ callsign: 'X', airport_codes: 'unknown' }], 'X', [0, 0])).toBeNull();
    expect(parseRouteset(null, 'X', [0, 0])).toBeNull();
  });

  it('posts only the callsign and the aircraft position', async () => {
    const { flightRouteTool } = await import('./tools/index.ts');
    const seen: { url: string; body: string }[] = [];
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(u), body: String(init?.body) });
      return json([{ callsign: 'ELY001', _airports: [TLV, JFK], plausible: true }]);
    }) as typeof fetch);
    const r = await client.call(flightRouteTool, { callsign: 'ely001', at: [30, 34.5] });
    expect(r?.to.iata).toBe('JFK');
    expect(seen[0].url).toBe('https://api.adsb.lol/api/0/routeset');
    expect(JSON.parse(seen[0].body)).toEqual({ planes: [{ callsign: 'ELY001', lat: 34.5, lng: 30 }] });
  });
});
