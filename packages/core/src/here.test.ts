import { describe, expect, it } from 'vitest';
import { providersFromEnv, withDevOverrides } from './config.ts';
import { hereBboxOk, hereIncidentCategory, hereIncidentsUrl, hereMagnitude, herePassPoints, hereRouteUrl, hereTrafficTiles } from './here.ts';
import { REGIONS, regionAt, trafficProvider } from './region.ts';
import type { LngLat } from './types.ts';

describe('here config', () => {
  it('is off without a key and reads it from env (web and server names)', () => {
    expect(providersFromEnv({}).hereKey).toBe('');
    expect(providersFromEnv({ VITE_HERE_KEY: ' abc ' }, 'VITE_').hereKey).toBe('abc');
    expect(providersFromEnv({ HERE_KEY: 'srv' }).hereKey).toBe('srv');
  });
  it('takes ?here= only on localhost, alone or with ?tomtom=', () => {
    const cfg = providersFromEnv({});
    expect(withDevOverrides(cfg, 'http://localhost:4173/?here=test').hereKey).toBe('test');
    const both = withDevOverrides(cfg, 'http://localhost:4173/?here=h&tomtom=t');
    expect([both.hereKey, both.tomtomKey]).toEqual(['h', 't']);
    expect(withDevOverrides(cfg, 'https://nadav-beno.github.io/nadav-maps/?here=evil').hereKey).toBe('');
  });
});

describe('trafficProvider', () => {
  const il = regionAt([34.78, 32.08]);
  const gb = regionAt([-0.12, 51.5]);
  const world = regionAt([150, -30]);
  it('is null without keys', () => {
    for (const r of REGIONS) expect(trafficProvider(r, {})).toBeNull();
  });
  it('prefers HERE in Israel and TomTom where both cover, when both keys exist', () => {
    const keys = { tomtomKey: 't', hereKey: 'h' };
    expect(trafficProvider(il, keys)).toEqual({ id: 'here', live: true });
    expect(trafficProvider(gb, keys)).toEqual({ id: 'tomtom', live: true });
    expect(trafficProvider(regionAt([-74, 40.7]), keys)).toEqual({ id: 'tomtom', live: true });
  });
  it('uses HERE alone wherever it covers, and TomTom alone (not live) in Israel', () => {
    expect(trafficProvider(il, { hereKey: 'h' })).toEqual({ id: 'here', live: true });
    expect(trafficProvider(gb, { hereKey: 'h' })).toEqual({ id: 'here', live: true });
    expect(trafficProvider(il, { tomtomKey: 't' })).toEqual({ id: 'tomtom', live: false });
  });
  it('falls back to any key (TomTom first) where no coverage is known', () => {
    expect(trafficProvider(world, { tomtomKey: 't', hereKey: 'h' })).toEqual({ id: 'tomtom', live: false });
    expect(trafficProvider(world, { hereKey: 'h' })).toEqual({ id: 'here', live: false });
  });
});

describe('here urls', () => {
  it('builds the traffic vector tile template with the key and placeholders intact', () => {
    expect(hereTrafficTiles('k&1')).toBe('https://traffic.vector.hereapi.com/v2/traffictiles/traffic/mc/{z}/{x}/{y}/omv?apiKey=k%261');
  });
  it('asks v7 for incidents in a box with shapes, in Hebrew', () => {
    const u = new URL(hereIncidentsUrl('k', [34.75, 32.05, 34.82, 32.1], 'he-IL'));
    expect(u.origin + u.pathname).toBe('https://data.traffic.hereapi.com/v7/incidents');
    expect(u.searchParams.get('in')).toBe('bbox:34.75000,32.05000,34.82000,32.10000');
    expect(u.searchParams.get('locationReferencing')).toBe('shape');
    expect(u.searchParams.get('lang')).toBe('he-IL');
    expect(u.searchParams.get('apiKey')).toBe('k');
  });
  it('limits boxes to 1° by 1°', () => {
    expect(hereBboxOk([34.7, 32, 35.6, 32.9])).toBe(true);
    expect(hereBboxOk([34, 31, 35.5, 32])).toBe(false);
    expect(hereBboxOk([35, 32, 34, 33])).toBe(false);
  });
  it('asks Routing v8 for a car route leaving now through pass-through points', () => {
    const at = new Date('2026-10-10T07:15:42.123Z');
    const u = new URL(hereRouteUrl('k', [34.7741, 32.0787], [34.7918, 32.0745], [[34.785, 32.0765]], at));
    expect(u.origin + u.pathname).toBe('https://router.hereapi.com/v8/routes');
    expect(u.searchParams.get('transportMode')).toBe('car');
    expect(u.searchParams.get('origin')).toBe('32.078700,34.774100');
    expect(u.searchParams.get('destination')).toBe('32.074500,34.791800');
    expect(u.searchParams.getAll('via')).toEqual(['32.076500,34.785000!passThrough=true']);
    expect(u.searchParams.get('departureTime')).toBe('2026-10-10T07:15:42Z');
    expect(u.searchParams.get('return')).toBe('summary,typicalDuration');
  });
  it('picks evenly spaced pass points plus the point nearest each stop, in route order', () => {
    const line: LngLat[] = Array.from({ length: 101 }, (_, i) => [34 + i / 100, 32]);
    const pts = herePassPoints(line, [[34.333, 32.001]], 5);
    expect(pts.length).toBe(5);
    expect(pts).toContainEqual([34.33, 32]);
    expect(pts.map((p) => p[0])).toEqual([...pts.map((p) => p[0])].sort((a, b) => a - b));
    expect(pts.some((p) => p[0] === 34 || p[0] === 35)).toBe(false);
    expect(herePassPoints([[0, 0], [1, 1]])).toEqual([]);
  });
});

describe('here categories', () => {
  it('maps v7 and tile kinds to our categories, closures first', () => {
    expect(hereIncidentCategory('accident')).toBe(1);
    expect(hereIncidentCategory('roadClosure')).toBe(8);
    expect(hereIncidentCategory('construction', true)).toBe(8);
    expect(hereIncidentCategory('accident', true)).toBe(1);
    expect(hereIncidentCategory('disabled_vehicle')).toBe(14);
    expect(hereIncidentCategory('something new')).toBe(0);
    expect(hereMagnitude('critical')).toBe(3);
    expect(hereMagnitude('minor', true)).toBe(4);
    expect(hereMagnitude(undefined)).toBe(0);
  });
});
