import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { clampBbox, coverCircles, openskyCredits, parseOpenSky } from './providers/live-aircraft.ts';
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
    const limited = await client.call(liveFlights, { bbox: [-10, 35, 30, 60] }, { cache: false });
    expect(limited).toMatchObject({ source: 'adsb', partial: true });
    expect(limited.note).toContain('מכסה');
    expect(urls[urls.length - 1]).toBe('https://api.adsb.lol/v2/point/47.5/10/250');
  });

  it('is in the tool list (REST + MCP)', () => {
    expect(TOOLS).toContain(liveFlights);
  });
});
