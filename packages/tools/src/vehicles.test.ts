import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { israelDate, strideVehicles } from './providers/openbus.ts';
import { motisVehicles } from './providers/transitous.ts';
import { transitVehiclesTool } from './tools/index.ts';
import { motisTrips, strideLocations, strideRoutes } from '../../../e2e/vehicles-fixture.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const TLV: [number, number, number, number] = [34.76, 32.06, 34.80, 32.09];
const PARIS: [number, number, number, number] = [2.33, 48.85, 2.36, 48.87];

describe('live vehicles', () => {
  it('groups MOTIS segments by trip and places each vehicle on its path', () => {
    const now = Date.now();
    const list = motisVehicles(motisTrips(now) as never, now);
    expect(list).toHaveLength(2);
    const tram = list.find((v) => v.line === 'R')!;
    expect(tram).toMatchObject({ mode: 'tram', color: 'e2001a', source: 'realtime', delayS: 60 });
    expect(tram.legs).toHaveLength(2);
    // Half way between the first two stops.
    expect(tram.lng).toBeCloseTo((34.7815 + 34.788) / 2, 3);
    expect(list.find((v) => v.line === '5')).toMatchObject({ mode: 'bus', source: 'schedule' });
  });

  it('keeps the newest GPS fix of each bus, drops old ones, names the line', () => {
    const now = Date.now();
    const list = strideVehicles(strideLocations(now), strideRoutes(), now);
    // The light rail train (route_type 0) is left to Transitous.
    expect(list).toHaveLength(2);
    expect(list.find((v) => v.line === '18')).toMatchObject({ source: 'gps', mode: 'bus', agency: 'דן', headsign: 'ת. מרכזית בת ים', lng: 34.779, bearing: 90, speedKph: 24 });
    expect(list.find((v) => v.line === '25')?.headsign).toBe('ת. רכבת בת ים יוספטל');
    // Without routes the Ministry's line id stands in for the number.
    expect(strideVehicles(strideLocations(now), [], now).map((v) => v.line).sort()).toEqual(['10755', '2148', '34448']);
  });

  it('gives the service day in Israel', () => {
    expect(israelDate(Date.parse('2026-11-11T22:30:00Z'))).toBe('2026-11-12');
  });

  function fakeFetch(urls: string[], fail: { stride?: boolean; motis?: boolean } = {}) {
    return (async (u: string | URL | Request) => {
      const url = String(u);
      urls.push(url);
      if (url.includes('/siri_vehicle_locations/')) return fail.stride ? json({ detail: 'down' }, 500) : json(strideLocations());
      if (url.includes('/gtfs_routes/')) return json(strideRoutes());
      if (url.includes('/map/trips')) return fail.motis ? json({}, 500) : json(motisTrips());
      return json({}, 404);
    }) as typeof fetch;
  }

  it('in Israel: GPS buses from Open Bus plus trains and trams from Transitous', async () => {
    const urls: string[] = [];
    const res = await createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch(urls)).call(transitVehiclesTool, { bbox: TLV, zoom: 14 });
    expect(res.sources).toEqual(['openbus', 'transitous']);
    expect(res.vehicles.map((v) => `${v.mode}:${v.line}:${v.source}`).sort()).toEqual(['bus:18:gps', 'bus:25:gps', 'tram:R:realtime']);
    const q = new URL(urls.find((u) => u.includes('siri_vehicle_locations'))!).searchParams;
    expect(q.get('lat__greater_or_equal')).toBe('32.06000');
    expect(q.get('order_by')).toBe('recorded_at_time desc');
    const r = new URL(urls.find((u) => u.includes('gtfs_routes'))!).searchParams;
    expect(r.get('line_refs')?.split(',').sort()).toEqual(['10755', '2148', '34448']);
  });

  it('falls back to computed buses when Open Bus is down, and uses only Transitous abroad', async () => {
    const urls: string[] = [];
    const down = await createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch(urls, { stride: true })).call(transitVehiclesTool, { bbox: TLV, zoom: 14 });
    expect(down.sources).toEqual(['transitous']);
    expect(down.vehicles.map((v) => v.line).sort()).toEqual(['5', 'R']);
    const abroad: string[] = [];
    const paris = await createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch(abroad)).call(transitVehiclesTool, { bbox: PARIS, zoom: 14 });
    expect(paris.sources).toEqual(['transitous']);
    expect(abroad.some((u) => u.includes('hasadna'))).toBe(false);
    const m = new URL(abroad[0]).searchParams;
    expect(m.get('min')).toBe('48.85000,2.33000');
    expect(m.get('max')).toBe('48.87000,2.36000');
  });

  it('refuses boxes wider than 1°', async () => {
    await expect(createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch([])).call(transitVehiclesTool, { bbox: [34, 31, 35.5, 32.5], zoom: 9 })).rejects.toThrow();
  });
});
