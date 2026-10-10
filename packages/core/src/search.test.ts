import { describe, expect, it } from 'vitest';
import { decodeGeohash, parseMapLink } from './map-link.ts';
import { matchLocalPlaces, matchText, mergeSuggestions, movedEnough, nameMatches, samePlace, type LocalFeature } from './local-search.ts';
import { filterOpenNow, openNowStates } from './hours.ts';
import { buildUrl, parseUrl } from './url-state.ts';
import type { Place } from './types.ts';

describe('url state for result lists', () => {
  it('round-trips a category search with the open-now filter', () => {
    const url = buildUrl('https://maps.example/', { cat: 'cafe', filter: 'open' });
    expect(url).toBe('https://maps.example/?cat=cafe&filter=open');
    expect(parseUrl(url)).toEqual({ cat: 'cafe', filter: 'open' });
    expect(parseUrl('https://maps.example/?cat=%3Cscript%3E&filter=%3C')).toEqual({});
  });
});

describe('parseMapLink: Google Maps', () => {
  it('reads the camera from /@lat,lng,zoom', () => {
    expect(parseMapLink('https://www.google.com/maps/@32.0853,34.7818,16z')).toEqual({ kind: 'point', source: 'google', lat: 32.0853, lng: 34.7818, zoom: 16 });
  });
  it('accepts links without a scheme and other Google domains', () => {
    expect(parseMapLink('google.co.il/maps/@31.7683,35.2137,13z')).toMatchObject({ kind: 'point', lat: 31.7683, lng: 35.2137, zoom: 13 });
    expect(parseMapLink('  https://maps.google.com/?ll=32.1,34.8&z=14  ')).toMatchObject({ kind: 'point', lat: 32.1, lng: 34.8, zoom: 14 });
  });
  it('prefers the place position (!3d!4d) over the camera, and keeps the place name', () => {
    const r = parseMapLink(
      'https://www.google.com/maps/place/%D7%A7%D7%A0%D7%99%D7%95%D7%9F+%D7%A2%D7%96%D7%A8%D7%99%D7%90%D7%9C%D7%99/@32.0740,34.7900,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d32.0745!4d34.7918!16s',
    );
    expect(r).toEqual({ kind: 'point', source: 'google', lat: 32.0745, lng: 34.7918, zoom: 17, name: 'קניון עזריאלי' });
  });
  it('reads ?q=lat,lng, ?query= and directions destinations', () => {
    expect(parseMapLink('https://www.google.com/maps?q=32.08,34.78')).toMatchObject({ kind: 'point', lat: 32.08, lng: 34.78 });
    expect(parseMapLink('https://www.google.com/maps/search/?api=1&query=32.08%2C34.78')).toMatchObject({ kind: 'point', lat: 32.08, lng: 34.78 });
    expect(parseMapLink('https://www.google.com/maps/dir/?api=1&destination=31.5,34.9')).toMatchObject({ kind: 'point', lat: 31.5, lng: 34.9 });
    expect(parseMapLink('https://maps.google.com/maps?q=loc:32.1,34.8')).toMatchObject({ kind: 'point', lat: 32.1, lng: 34.8 });
  });
  it('reads coordinates in the path', () => {
    expect(parseMapLink('https://www.google.com/maps/place/32.0801,34.7792')).toMatchObject({ kind: 'point', lat: 32.0801, lng: 34.7792 });
  });
  it('turns satellite altitude (m) into a zoom', () => {
    const r = parseMapLink('https://www.google.com/maps/@32.08,34.78,1200m/data=!3m1!1e3');
    expect(r).toMatchObject({ kind: 'point', lat: 32.08, lng: 34.78 });
    expect((r as { zoom: number }).zoom).toBeGreaterThan(14);
    expect((r as { zoom: number }).zoom).toBeLessThan(17);
  });
  it('turns a search link without coordinates into a text query', () => {
    expect(parseMapLink('https://www.google.com/maps/search/%D7%A4%D7%99%D7%A6%D7%94')).toEqual({ kind: 'query', source: 'google', query: 'פיצה' });
    expect(parseMapLink('https://www.google.com/maps?q=Dizengoff+Center')).toEqual({ kind: 'query', source: 'google', query: 'Dizengoff Center' });
  });
  it('reports short links, which only resolve on Google’s servers', () => {
    expect(parseMapLink('https://maps.app.goo.gl/AbCdEf123')).toEqual({ kind: 'short', source: 'google' });
    expect(parseMapLink('https://goo.gl/maps/xyz')).toEqual({ kind: 'short', source: 'google' });
  });
  it('ignores google links that are not maps', () => {
    expect(parseMapLink('https://www.google.com/search?q=32.1,34.8')).toBeNull();
  });
});

describe('parseMapLink: Waze, Apple, OSM, geo:', () => {
  it('reads Waze ll in both encodings', () => {
    expect(parseMapLink('https://waze.com/ul?ll=32.0853,34.7818&navigate=yes')).toMatchObject({ kind: 'point', source: 'waze', lat: 32.0853, lng: 34.7818 });
    expect(parseMapLink('https://www.waze.com/ul?ll=32.0853%2C34.7818&navigate=yes&zoom=17')).toMatchObject({ kind: 'point', lat: 32.0853, lng: 34.7818 });
  });
  it('reads Waze live-map directions and geohash links', () => {
    expect(parseMapLink('https://www.waze.com/he/live-map/directions?to=ll.32.0745%2C34.7918')).toMatchObject({ kind: 'point', lat: 32.0745, lng: 34.7918 });
    const g = parseMapLink('https://waze.com/ul/hsv8wrvzz8');
    expect(g).toMatchObject({ kind: 'point', source: 'waze' });
    const [lat, lng] = decodeGeohash('sv8wrvzz8')!;
    expect((g as { lat: number }).lat).toBeCloseTo(lat, 6);
    expect((g as { lng: number }).lng).toBeCloseTo(lng, 6);
    expect(lat).toBeGreaterThan(31);
    expect(lng).toBeGreaterThan(34);
  });
  it('decodes a known geohash', () => {
    const [lat, lng] = decodeGeohash('u4pruydqqvj')!;
    expect(lat).toBeCloseTo(57.64911, 4);
    expect(lng).toBeCloseTo(10.40744, 4);
    expect(decodeGeohash('abc!')).toBeNull();
  });
  it('reads Apple Maps ll with the q name', () => {
    expect(parseMapLink('https://maps.apple.com/?ll=32.0853,34.7818&q=%D7%91%D7%99%D7%AA')).toEqual({ kind: 'point', source: 'apple', lat: 32.0853, lng: 34.7818, zoom: 16, name: 'בית' });
    expect(parseMapLink('https://maps.apple.com/place?coordinate=32.1,34.8&name=Cafe')).toMatchObject({ lat: 32.1, lng: 34.8, name: 'Cafe' });
    expect(parseMapLink('https://maps.apple.com/?q=32.1,34.8')).toMatchObject({ lat: 32.1, lng: 34.8 });
    expect(parseMapLink('https://maps.apple.com/?address=Tel%20Aviv')).toEqual({ kind: 'query', source: 'apple', query: 'Tel Aviv' });
  });
  it('reads OpenStreetMap links', () => {
    expect(parseMapLink('https://www.openstreetmap.org/#map=15/32.0800/34.7800')).toEqual({ kind: 'point', source: 'osm', lat: 32.08, lng: 34.78, zoom: 15 });
    expect(parseMapLink('https://www.openstreetmap.org/?mlat=32.1&mlon=34.9#map=17/32.1/34.9')).toMatchObject({ lat: 32.1, lng: 34.9, zoom: 17 });
  });
  it('reads geo: URIs', () => {
    expect(parseMapLink('geo:32.0853,34.7818')).toMatchObject({ kind: 'point', source: 'geo', lat: 32.0853, lng: 34.7818 });
    expect(parseMapLink('geo:32.0853,34.7818;u=35?z=12')).toMatchObject({ lat: 32.0853, zoom: 12 });
    expect(parseMapLink('geo:0,0?q=32.1,34.8(Home)')).toMatchObject({ lat: 32.1, lng: 34.8, name: 'Home' });
    expect(parseMapLink('geo:0,0?q=Haifa')).toEqual({ kind: 'query', source: 'geo', query: 'Haifa' });
  });
  it('reads typed coordinates', () => {
    expect(parseMapLink('32.0853, 34.7818')).toMatchObject({ kind: 'point', source: 'coords', lat: 32.0853, lng: 34.7818 });
  });
  it('leaves ordinary search text alone', () => {
    for (const s of ['פיצה', 'הרצל 12, חיפה', 'Main St 5', 'example.com', '12, 3', '', '32.1,200.5', 'https://example.com/maps/@32,34,15z']) {
      expect(parseMapLink(s)).toBeNull();
    }
  });
  it('rejects out-of-range coordinates', () => {
    expect(parseMapLink('https://www.google.com/maps/@95.1,34.1,15z')).toEqual({ kind: 'unknown', source: 'google' });
    expect(parseMapLink('https://waze.com/ul?ll=0,0')).toEqual({ kind: 'unknown', source: 'waze' });
  });
});

describe('local business search', () => {
  const f = (id: string, name: string, lng: number, lat: number, extra: Record<string, unknown> = {}): LocalFeature => ({
    properties: { id, '@name': name, basic_category: 'restaurant', confidence: 0.9, ...extra },
    lng,
    lat,
  });
  const center: [number, number] = [34.78, 32.08];

  it('normalizes text for matching', () => {
    expect(matchText('  קפה  "נוגה" ')).toBe('קפה נוגה');
    expect(matchText("Joe's Café")).toBe('joes café');
  });
  it('matches word prefixes and Hebrew prefixes', () => {
    expect(nameMatches('ביסטרו הכרמל', 'ביסטרו')).toBe(true);
    expect(nameMatches('ביסטרו הכרמל', 'ביס כרמ')).toBe(true);
    expect(nameMatches('Bistro Carmel', 'bistro')).toBe(true);
    expect(nameMatches('קפה רוטשילד', 'ברוטשילד')).toBe(true);
    expect(nameMatches('קפה רוטשילד', 'פיצה')).toBe(false);
    expect(nameMatches('קפה', 'ק')).toBe(false);
  });
  it('finds, de-duplicates and ranks tile features by distance', () => {
    const features = [
      f('far', 'ביסטרו רחוק', 34.9, 32.2),
      f('near', 'ביסטרו הכרמל', 34.7801, 32.0801),
      f('near', 'ביסטרו הכרמל', 34.7801, 32.0801), // the same feature from a neighbouring tile
      f('closed', 'ביסטרו סגור', 34.78, 32.08, { operating_status: 'permanently_closed' }),
      f('weak', 'ביסטרו מפוקפק', 34.78, 32.08, { confidence: 0.2 }),
      f('other', 'מספרה', 34.78, 32.08),
    ];
    const r = matchLocalPlaces(features, 'ביסטרו', center);
    expect(r.map((p) => p.id)).toEqual(['ovt:near', 'ovt:far']);
    expect(r[0]).toMatchObject({ name: 'ביסטרו הכרמל', category: { key: 'overture', value: 'restaurant' } });
  });
  it('drops businesses the search engine already returned nearby', () => {
    const photon: Place = { id: 'osm:n1', name: 'ביסטרו הכרמל', lng: 34.7802, lat: 32.0802 };
    expect(matchLocalPlaces([f('a', 'ביסטרו הכרמל', 34.7801, 32.0801)], 'ביסטרו', center, [photon])).toEqual([]);
    // Same name far away is a different branch.
    expect(matchLocalPlaces([f('a', 'ביסטרו הכרמל', 34.79, 32.09)], 'ביסטרו', center, [photon])).toHaveLength(1);
  });
  it('limits to 3 and ignores one-letter queries', () => {
    const many = Array.from({ length: 6 }, (_, i) => f(`id${i}`, `פיצה ${i}`, 34.78 + i / 1000, 32.08));
    expect(matchLocalPlaces(many, 'פיצה', center)).toHaveLength(3);
    expect(matchLocalPlaces(many, 'פ', center)).toEqual([]);
  });
  it('compares places by name and distance', () => {
    expect(samePlace({ name: 'קפה נוגה', lng: 34.78, lat: 32.08 }, { name: 'נוגה', lng: 34.7805, lat: 32.08 })).toBe(true);
    expect(samePlace({ name: 'קפה נוגה', lng: 34.78, lat: 32.08 }, { name: 'קפה נוגה', lng: 34.79, lat: 32.08 })).toBe(false);
    expect(samePlace({ name: 'קפה נוגה', lng: 34.78, lat: 32.08 }, { name: 'מספרה', lng: 34.78, lat: 32.08 })).toBe(false);
  });
  it('merges local businesses into the suggestions', () => {
    const remote = ['r1', 'r2', 'r3', 'r4'].map((id) => ({ id, name: id, lng: 0, lat: 0 }));
    const local = [
      { id: 'l1', name: 'ביסטרו א', lng: 0, lat: 0 },
      { id: 'l2', name: 'בר ביסטרו', lng: 0, lat: 0 },
    ];
    expect(mergeSuggestions(remote, local, 'ביסטרו').map((p) => p.id)).toEqual(['l1', 'r1', 'r2', 'r3', 'l2', 'r4']);
  });
});

describe('search this area', () => {
  const vp = { width: 400, height: 800 };
  const from = { center: [34.78, 32.08] as [number, number], zoom: 15 };
  it('ignores small pans', () => {
    expect(movedEnough(from, { center: [34.781, 32.08], zoom: 15 }, vp)).toBe(false);
    expect(movedEnough(from, { center: [34.78, 32.08], zoom: 15.5 }, vp)).toBe(false);
  });
  it('triggers on a third of the viewport or a zoom level', () => {
    // At z15 a 512px tile spans 360/2^15 degrees: 0.0035° of longitude is ~165 px > 120 px.
    expect(movedEnough(from, { center: [34.7835, 32.08], zoom: 15 }, vp)).toBe(true);
    expect(movedEnough(from, { center: [34.78, 32.08], zoom: 14 }, vp)).toBe(true);
    expect(movedEnough(from, { center: [34.78, 32.083], zoom: 15 }, vp)).toBe(false); // ~165 px of 800
    expect(movedEnough(from, { center: [34.78, 32.086], zoom: 15 }, vp)).toBe(true);
  });
});

describe('open now filter', () => {
  // A Tuesday at 10:00 local time.
  const tuesday10 = new Date(2026, 9, 13, 10, 0);
  const places = [
    { id: 'open', lat: 32.08, lng: 34.78, openingHours: 'Mo-Fr 08:00-17:00' },
    { id: 'closed', lat: 32.08, lng: 34.78, openingHours: 'Mo-Fr 18:00-23:00' },
    { id: 'none', lat: 32.08, lng: 34.78 },
    { id: 'bad', lat: 32.08, lng: 34.78, openingHours: 'whenever we feel like it' },
    { id: 'always', lat: 32.08, lng: 34.78, openingHours: '24/7' },
  ];
  it('evaluates opening hours now', async () => {
    const s = await openNowStates(places, tuesday10);
    expect(Object.fromEntries(s)).toEqual({ open: true, closed: false, none: null, bad: null, always: true });
  });
  it('keeps open places and counts unknown ones', async () => {
    const s = await openNowStates(places, tuesday10);
    const r = filterOpenNow(places, s);
    expect(r.places.map((p) => p.id)).toEqual(['open', 'always']);
    expect(r.unknown).toBe(2);
  });
});
