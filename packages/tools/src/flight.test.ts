import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { callsignCandidates, parseAdsb } from './providers/adsb.ts';
import { flightPosition, TOOLS } from './tools/index.ts';
import { adsbResponse } from '../../../e2e/flight-fixture.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('flight position (ADS-B)', () => {
  it('turns flight numbers into ADS-B callsigns', () => {
    expect(callsignCandidates('LY001')).toEqual(['ELY1', 'ELY001', 'LY001']);
    expect(callsignCandidates('ly 315')).toEqual(['ELY315', 'LY315']);
    expect(callsignCandidates('BAW123')).toEqual(['BAW123']);
    expect(callsignCandidates('ELY0081')).toEqual(['ELY0081', 'ELY81']);
    expect(callsignCandidates('ZZ12')).toEqual(['ZZ12']);
    expect(callsignCandidates('4X-ABC')).toEqual(['4XABC']);
  });

  it('parses a readsb response into metric values', () => {
    const [a] = parseAdsb(adsbResponse());
    expect(a).toMatchObject({ callsign: 'ELY001', hex: '738075', registration: '4X-EDF', type: 'B789', lngLat: [30.118, 34.512], onGround: false });
    expect(a.altitudeM).toBe(Math.round(37650 * 0.3048));
    expect(a.groundSpeedKmh).toBe(Math.round(482.3 * 1.852));
    expect(a.track).toBeCloseTo(292.4);
    expect(a.ageS).toBe(1.4);
  });

  it('is defensive about odd responses', () => {
    expect(parseAdsb(null)).toEqual([]);
    expect(parseAdsb({ ac: 'nope' })).toEqual([]);
    expect(parseAdsb({ ac: [null, 4, { hex: 'x' }, { lat: 200, lon: 0 }] })).toEqual([]);
    const [ground] = parseAdsb({ ac: [{ hex: '~abc', lat: 32, lon: 34.9, alt_baro: 'ground', gs: 'fast', track: -10 }] });
    expect(ground).toMatchObject({ hex: 'abc', onGround: true, altitudeM: 0, groundSpeedKmh: null, track: 350, callsign: '' });
    const [last] = parseAdsb({ aircraft: [{ hex: 'a', lastPosition: { lat: 1, lon: 2, seen_pos: 60 } }] });
    expect(last).toMatchObject({ lngLat: [2, 1], ageS: 60, altitudeM: null });
  });

  it('tries callsigns until one is found, sending only the flight number', async () => {
    const urls: string[] = [];
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string | URL | Request) => {
      urls.push(String(u));
      return json(String(u).endsWith('/ELY001') ? adsbResponse() : { ac: [], total: 0 });
    }) as typeof fetch);
    const res = await client.call(flightPosition, { callsign: 'LY001' });
    expect(urls).toEqual(['https://api.adsb.lol/v2/callsign/ELY1', 'https://api.adsb.lol/v2/callsign/ELY001']);
    expect(res.tried).toEqual(['ELY1', 'ELY001']);
    expect(res.aircraft).toHaveLength(1);
  });

  it('can be switched off and is listed for REST and MCP', async () => {
    const client = createToolClient({ ...DEFAULT_PROVIDERS, flightsUrl: '' }, 'he', (async () => json({})) as typeof fetch);
    await expect(client.call(flightPosition, { callsign: 'LY001' })).rejects.toThrow();
    expect(TOOLS.map((t) => t.name)).toContain('flight_position');
    expect(() => flightPosition.input.parse({ callsign: 'LY1/../x' })).toThrow();
  });
});
