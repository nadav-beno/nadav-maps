import { describe, expect, it } from 'vitest';
import { providersFromEnv, withDevOverrides } from './config.ts';
import { bboxAreaKm2, incidentCategory, incidentDetailsUrl, samplePoints, tomtomFlowTiles, tomtomIncidentTiles, trafficRouteUrl } from './tomtom.ts';

describe('tomtom config', () => {
  it('is off without a key and reads it from env (web and server names)', () => {
    expect(providersFromEnv({}).tomtomKey).toBe('');
    expect(providersFromEnv({ VITE_TOMTOM_KEY: ' abc ' }, 'VITE_').tomtomKey).toBe('abc');
    expect(providersFromEnv({ TOMTOM_KEY: 'srv' }).tomtomKey).toBe('srv');
  });
  it('takes ?tomtom= only on localhost', () => {
    const cfg = providersFromEnv({});
    expect(withDevOverrides(cfg, 'http://localhost:4173/?tomtom=test').tomtomKey).toBe('test');
    expect(withDevOverrides(cfg, 'http://127.0.0.1:5173/#x?tomtom=nope').tomtomKey).toBe('');
    expect(withDevOverrides(cfg, 'https://nadav-beno.github.io/nadav-maps/?tomtom=evil').tomtomKey).toBe('');
    expect(withDevOverrides(cfg, 'not a url')).toBe(cfg);
  });
});

describe('tomtom urls', () => {
  it('builds flow and incident tile templates with the key and placeholders intact', () => {
    const flow = tomtomFlowTiles('k&1');
    expect(flow).toBe('https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=k%261&tags=[road_type,traffic_level,road_closure,traffic_road_coverage,left_hand_traffic]');
    const inc = tomtomIncidentTiles('k');
    expect(inc.startsWith('https://api.tomtom.com/traffic/map/4/tile/incidents/{z}/{x}/{y}.pbf?')).toBe(true);
    const q = new URL(inc.replace('{z}/{x}/{y}', '1/2/3')).searchParams;
    expect(q.get('key')).toBe('k');
    expect(q.get('t')).toBe('-1');
    expect(q.get('language')).toBe('he-IL');
  });
  it('builds an incident details request for a box', () => {
    const u = new URL(incidentDetailsUrl('k', [34.7, 32.0, 34.9, 32.15]));
    expect(u.origin + u.pathname).toBe('https://api.tomtom.com/traffic/services/5/incidentDetails');
    expect(u.searchParams.get('bbox')).toBe('34.70000,32.00000,34.90000,32.15000');
    expect(u.searchParams.get('language')).toBe('he-IL');
    expect(u.searchParams.get('fields')).toContain('events{description');
  });
  it('builds a traffic route request lat,lon:lat,lon', () => {
    const u = new URL(trafficRouteUrl('k', [[34.7741, 32.0787], [34.7918, 32.0745]]));
    expect(u.pathname).toBe('/routing/1/calculateRoute/32.078700,34.774100:32.074500,34.791800/json');
    expect(u.searchParams.get('traffic')).toBe('true');
    expect(u.searchParams.get('computeTravelTimeFor')).toBe('all');
  });
  it('measures boxes and thins lines', () => {
    expect(bboxAreaKm2([34, 31, 35, 32])).toBeGreaterThan(9000);
    expect(bboxAreaKm2([34, 31, 35, 32])).toBeLessThan(11000);
    const line = Array.from({ length: 1000 }, (_, i) => [i, 0] as [number, number]);
    const s = samplePoints(line, 150);
    expect(s).toHaveLength(150);
    expect(s[0]).toEqual([0, 0]);
    expect(s[149]).toEqual([999, 0]);
    expect(samplePoints(line.slice(0, 5), 150)).toHaveLength(5);
  });
  it('knows incident categories and falls back for unknown ones', () => {
    expect(incidentCategory(1).id).toBe('accident');
    expect(incidentCategory(8).label).toBe('כביש סגור');
    expect(incidentCategory(99).id).toBe('unknown');
  });
});
