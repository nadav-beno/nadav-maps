import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS, encodePolyline, type LngLat } from '@nm/core';
import { costingOptions, lanesOf, speedLimitsOf, tripToRoute } from './providers/valhalla.ts';
import { pagesToPhotos } from './providers/commons.ts';
import { aqiLabel, airQualityAt } from './providers/air-quality.ts';
import { sortItineraries } from './providers/transitous.ts';
import { createToolClient } from './client.ts';
import { getDirections, placesAlong, searchAlongRoute } from './tools/index.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('route options and tags', () => {
  it('maps avoid choices to Valhalla costing options per mode', () => {
    expect(costingOptions('car', { avoidTolls: true, avoidFerries: true, avoidUnpaved: true })).toEqual({ auto: { use_tolls: 0, use_ferry: 0, exclude_unpaved: true } });
    expect(costingOptions('motorcycle', { avoidHighways: true })).toEqual({ motorcycle: { use_highways: 0 } });
    expect(costingOptions('walk', { avoidStairs: true, avoidTolls: true })).toEqual({ pedestrian: { step_penalty: 3600 } });
    expect(costingOptions('bike', {})).toBeUndefined();
  });
  it('reads toll and ferry from the trip summary', () => {
    const shape = encodePolyline([[34.78, 32.08], [34.79, 32.09]]);
    const r = tripToRoute({ summary: { length: 1, time: 60, has_toll: true, has_ferry: false }, legs: [{ shape, maneuvers: [{ type: 1, length: 1, time: 60, begin_shape_index: 0, toll: true }] }] }, 'car');
    expect(r.tags).toEqual(['toll']);
    expect(r.steps[0].toll).toBe(true);
  });
  it('sends motorcycle costing and the avoid options', async () => {
    let body: Record<string, unknown> = {};
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return json({ trip: { summary: { length: 1, time: 60 }, legs: [{ shape: encodePolyline([[34.78, 32.08], [34.79, 32.09]]), maneuvers: [] }] } });
    }) as typeof fetch);
    await client.call(getDirections, { waypoints: [[34.78, 32.08], [34.79, 32.09]], mode: 'motorcycle', avoidFerries: true });
    expect(body.costing).toBe('motorcycle');
    expect(body.costing_options).toEqual({ motorcycle: { use_ferry: 0 } });
  });
});

describe('guidance', () => {
  it('merges runs of the same speed limit and skips unknown ones', () => {
    expect(
      speedLimitsOf({
        edges: [
          { speed_limit: 50, begin_shape_index: 0, end_shape_index: 3 },
          { speed_limit: 50, begin_shape_index: 3, end_shape_index: 5 },
          { speed_limit: 'unlimited', begin_shape_index: 5, end_shape_index: 6 },
          { speed_limit: 90, begin_shape_index: 6, end_shape_index: 9 },
        ],
      }),
    ).toEqual([{ from: 0, to: 5, kmh: 50 }, { from: 6, to: 9, kmh: 90 }]);
  });
  it('keeps lane arrows only where some lane does not fit', () => {
    const lanes = lanesOf({
      routes: [{ legs: [{ steps: [{ intersections: [
        { location: [34.78, 32.08], lanes: [{ indications: ['left'], valid: true }, { indications: ['straight'], valid: false }] },
        { location: [34.79, 32.08], lanes: [{ indications: ['straight'], valid: true }] },
      ] }] }] }],
    });
    expect(lanes).toHaveLength(1);
    expect(lanes[0].lanes[1]).toEqual({ indications: ['straight'], valid: false });
  });
});

describe('search along the route', () => {
  const line: LngLat[] = [[34.78, 32.0], [34.78, 32.1], [34.78, 32.2]];
  it('orders by detour and drops places behind or far away', () => {
    const places = [
      { id: 'a', name: 'רחוק מהדרך', lng: 34.79, lat: 32.15 },
      { id: 'b', name: 'על הדרך', lng: 34.7801, lat: 32.12 },
      { id: 'c', name: 'מאוד רחוק', lng: 35.2, lat: 32.1 },
    ];
    const r = placesAlong(places, line, 0, 2000);
    expect(r.map((p) => p.id)).toEqual(['b', 'a']);
    expect(r[0].detourS).toBe(60);
    expect(r[0].alongM).toBeGreaterThan(13000);
  });
  it('asks Overpass for places around the line', async () => {
    let q = '';
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (_u: string, init?: RequestInit) => {
      q = decodeURIComponent(String(init?.body));
      return json({ elements: [{ type: 'node', id: 1, lat: 32.1, lon: 34.7802, tags: { amenity: 'fuel', name: 'דלק' } }] });
    }) as typeof fetch);
    const r = await client.call(searchAlongRoute, { category: 'fuel', geometry: line });
    expect(q).toContain('around:800,');
    expect(r[0]).toMatchObject({ id: 'osm:n1', name: 'דלק' });
  });
});

describe('photos and air quality', () => {
  it('keeps images with their author and licence', () => {
    const r = pagesToPhotos([
      { title: 'File:Azrieli.jpg', imageinfo: [{ url: 'https://u/a.jpg', thumburl: 'https://u/t.jpg', descriptionurl: 'https://c/File:Azrieli.jpg', mime: 'image/jpeg', extmetadata: { Artist: { value: '<a href="x">Dana</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
      { title: 'File:Plan.pdf', imageinfo: [{ url: 'https://u/p.pdf', descriptionurl: 'x', mime: 'application/pdf' }] },
    ]);
    expect(r).toEqual([{ url: 'https://u/a.jpg', thumbUrl: 'https://u/t.jpg', pageUrl: 'https://c/File:Azrieli.jpg', title: 'Azrieli', author: 'Dana', license: 'CC BY-SA 4.0', width: undefined, height: undefined }]);
  });
  it('reads Open-Meteo answers for several points', async () => {
    const ctx = {
      config: DEFAULT_PROVIDERS,
      lang: 'he',
      fetch: (async () => json([{ latitude: 32, longitude: 34.8, current: { european_aqi: 35, pm2_5: 9, pm10: 20 } }, { latitude: 31, longitude: 35, current: { european_aqi: null } }])) as typeof fetch,
    };
    const r = await airQualityAt(ctx, [[34.8, 32], [35, 31]]);
    expect(r.map((x) => x.aqi)).toEqual([35, null]);
    expect(aqiLabel(35)).toBe('סבירה');
  });
});

describe('transit preferences', () => {
  const it_ = (durationS: number, transfers: number, walkM: number) => ({ start: '', end: '', durationS, transfers, walkM, legs: [] });
  it('sorts by transfers or walking when asked', () => {
    const list = [it_(1800, 2, 300), it_(2400, 0, 900), it_(2000, 1, 100)];
    expect(sortItineraries(list, { fewerTransfers: true }).map((x) => x.transfers)).toEqual([0, 1, 2]);
    expect(sortItineraries(list, { lessWalking: true }).map((x) => x.walkM)).toEqual([100, 300, 900]);
    expect(sortItineraries(list, {})).toBe(list);
  });
});
