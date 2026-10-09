import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROVIDERS, encodePolyline, type LngLat } from '@nm/core';
import { photonToPlace } from './providers/photon.ts';
import { tripToRoute } from './providers/valhalla.ts';
import { elementToDetails, commonsThumb } from './providers/overpass.ts';
import { hebrewInstruction, spokenInstruction } from './instructions-he.ts';
import { CATEGORIES, categoryById, categoryLabel, placeIcon } from './categories.ts';
import { createToolClient } from './client.ts';
import { getDirections, searchNearby, searchPlaces, placeDetails } from './tools/index.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const feature = (name: string, id: number, extra: Record<string, unknown> = {}) => ({
  geometry: { coordinates: [34.78, 32.08] },
  properties: { osm_type: 'N', osm_id: id, osm_key: 'amenity', osm_value: 'cafe', name, city: 'תל אביב-יפו', country: 'ישראל', countrycode: 'IL', ...extra },
});

describe('photon mapping', () => {
  it('maps a POI', () => {
    const p = photonToPlace(feature('קפה', 1, { street: 'דיזנגוף', housenumber: '50' }) as never);
    expect(p).toMatchObject({ id: 'osm:n1', name: 'קפה', address: 'דיזנגוף 50, תל אביב-יפו, ישראל', countryCode: 'il', category: { key: 'amenity', value: 'cafe' } });
  });
  it('names an address by its street and converts extent', () => {
    const p = photonToPlace({ geometry: { coordinates: [1, 2] }, properties: { street: 'הרצל', housenumber: '3', city: 'חיפה', extent: [0, 3, 2, 1] } } as never);
    expect(p.name).toBe('הרצל 3');
    expect(p.id).toBe('pt:1.00000,2.00000');
    expect(p.extent).toEqual([0, 1, 2, 3]);
  });
});

describe('valhalla mapping', () => {
  const shape = encodePolyline([[34.78, 32.08], [34.79, 32.08], [34.79, 32.09]]);
  const trip = {
    summary: { length: 2.1, time: 300 },
    legs: [{ shape, maneuvers: [
      { type: 1, street_names: ['דיזנגוף'], length: 0.9, time: 120, begin_shape_index: 0 },
      { type: 15, street_names: ['ארלוזורוב'], length: 1.2, time: 180, begin_shape_index: 1 },
      { type: 4, length: 0, time: 0, begin_shape_index: 2 },
    ] }],
  };
  it('builds a route with hebrew steps', () => {
    const r = tripToRoute(trip, 'car');
    expect(r.distanceM).toBe(2100);
    expect(r.durationS).toBe(300);
    expect(r.geometry).toHaveLength(3);
    expect(r.steps.map((s) => s.instruction)).toEqual(['צאו לדרך בדיזנגוף', 'פנו שמאלה אל ארלוזורוב', 'הגעתם ליעד']);
    expect(r.summary).toBe('ארלוזורוב, דיזנגוף');
  });
  it('joins multi-leg trips without duplicate points or intermediate arrivals', () => {
    const r = tripToRoute({ ...trip, legs: [trip.legs[0], { ...trip.legs[0], shape: encodePolyline([[34.79, 32.09], [34.8, 32.1]]) }] }, 'walk');
    expect(r.geometry).toHaveLength(4);
    expect(r.steps.filter((s) => s.type === 4)).toHaveLength(1);
    expect(r.steps.filter((s) => s.type === 1)).toHaveLength(1);
  });
});

describe('hebrew instructions', () => {
  it('covers roundabouts and streets', () => {
    expect(hebrewInstruction({ type: 26, roundaboutExit: 2, street: 'הרצל' })).toBe('בכיכר, צאו ביציאה השנייה אל הרצל');
    expect(hebrewInstruction({ type: 10, street: 'הרצל' })).toBe('פנו ימינה אל הרצל');
    expect(hebrewInstruction({ type: 20, street: 'חיפה' })).toBe('צאו ביציאה מימין לכיוון חיפה');
    expect(hebrewInstruction({ type: 999 })).toBe('המשיכו');
  });
  it('speaks distances in words', () => {
    expect(spokenInstruction({ type: 10 }, 300)).toBe('בעוד 300 מטר, פנו ימינה');
    expect(spokenInstruction({ type: 10 }, 1500)).toBe('בעוד 1.5 קילומטר, פנו ימינה');
    expect(spokenInstruction({ type: 10 }, 10)).toBe('פנו ימינה');
  });
});

describe('overpass mapping', () => {
  it('extracts details', () => {
    const d = elementToDetails({ type: 'way', id: 7, center: { lat: 32, lon: 34 }, tags: { name: 'Museum', 'name:he': 'מוזיאון', tourism: 'museum', opening_hours: 'Mo-Fr 09:00-17:00', wikimedia_commons: 'File:A b.jpg' } }, 'he');
    expect(d).toMatchObject({ id: 'osm:w7', name: 'מוזיאון', lng: 34, lat: 32, category: { key: 'tourism', value: 'museum' }, openingHours: 'Mo-Fr 09:00-17:00' });
    expect(d?.imageUrl).toBe(commonsThumb('File:A b.jpg'));
    expect(commonsThumb('File:A b.jpg')).toContain('A_b.jpg');
  });
  it('skips elements without coordinates', () => {
    expect(elementToDetails({ type: 'relation', id: 1 }, 'he')).toBeNull();
  });
});

describe('categories', () => {
  it('has unique ids and labels', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    expect(categoryById('cafe')?.label).toBe('בתי קפה');
    expect(categoryLabel({ key: 'amenity', value: 'cafe' })).toBeTruthy();
    expect(placeIcon({ category: { key: 'amenity', value: 'cafe' } })).toBe('☕');
    expect(placeIcon({})).toBe('📍');
  });
});

describe('tools via client', () => {
  it('retries thin hebrew searches with variants', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u));
      const q = new URL(String(u)).searchParams.get('q');
      return json({ features: q === 'פיצה תל אביב' ? [feature('א', 1), feature('ב', 2), feature('ג', 3)] : [] });
    });
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', fetchImpl as typeof fetch);
    const res = await client.call(searchPlaces, { query: 'פיצה בתל אביב' });
    expect(res.map((r) => r.id)).toEqual(['osm:n1', 'osm:n2', 'osm:n3']);
    expect(urls.length).toBe(2);
    // cached
    await client.call(searchPlaces, { query: 'פיצה בתל אביב' });
    expect(urls.length).toBe(2);
  });
  it('validates input', async () => {
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async () => json({})) as typeof fetch);
    await expect(client.call(placeDetails, { id: 'nope' })).rejects.toThrow();
    await expect(client.call(searchNearby, { category: 'cafe', bbox: [34, 31, 35, 32] })).rejects.toThrow('גדול מדי');
  });
  it('returns no routes on valhalla 400 and does not cache failures', async () => {
    let calls = 0;
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async () => {
      calls++;
      return json({ error: 'No path' }, 400);
    }) as typeof fetch);
    const pts: LngLat[] = [[34.78, 32.08], [35.2, 31.77]];
    const res = await client.call(getDirections, { waypoints: pts });
    expect(res).toEqual([]);
    expect(calls).toBe(1);
  });
});
