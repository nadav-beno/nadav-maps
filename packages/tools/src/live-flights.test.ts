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
    expect(urls[1]).toBe('https://opensky-network.org/api/states/all');

    const europe = await client.call(liveFlights, { bbox: [-10, 35, 30, 60] }, { cache: false });
    expect(urls[2]).toBe('https://opensky-network.org/api/states/all?lamin=35&lomin=-10&lamax=60&lomax=30');
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
