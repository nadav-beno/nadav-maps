import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS, type Place } from '@nm/core';
import { categoryFromText, parseCategoryQuery } from './categories.ts';
import { createToolClient } from './client.ts';
import { confidentResult, hasStrongMatch, rankResults, searchPlaces } from './tools/index.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const feature = (name: string, id: number, extra: Record<string, unknown> = {}) => ({
  geometry: { coordinates: [34.78, 32.08] },
  properties: { osm_type: 'W', osm_id: id, osm_key: 'highway', osm_value: 'primary', name, city: 'תל אביב-יפו', country: 'ישראל', countrycode: 'IL', ...extra },
});

/** A Photon stub answering only exact queries; records what was asked. */
function photon(answers: Record<string, unknown[]>) {
  const asked: string[] = [];
  const fetchImpl = (async (u: string | URL | Request) => {
    const q = new URL(String(u)).searchParams.get('q') ?? '';
    asked.push(q);
    return json({ features: answers[q] ?? [] });
  }) as typeof fetch;
  return { asked, client: createToolClient(DEFAULT_PROVIDERS, 'he', fetchImpl) };
}

const place = (name: string, extra: Partial<Place> = {}): Place => ({ id: `osm:n${name.length}${Math.random()}`, name, lng: 34.78, lat: 32.08, ...extra });

describe('search_places corrects typos', () => {
  it('re-asks with the corrected name when nothing matches, and marks the results', async () => {
    const { asked, client } = photon({ דיזנגוף: [feature('דיזנגוף', 1)] });
    const res = await client.call(searchPlaces, { query: 'דיזנגוב' });
    expect(res.map((r) => r.name)).toEqual(['דיזנגוף']);
    expect(res[0].correctedQuery).toBe('דיזנגוף');
    expect(asked).toContain('דיזנגוף');
  });
  it('fixes a word inside a longer query', async () => {
    const { client } = photon({ 'דיזנגוף תל אביב': [feature('דיזנגוף', 1)] });
    const res = await client.call(searchPlaces, { query: 'דיזנגוב תל אביב' });
    expect(res[0]).toMatchObject({ name: 'דיזנגוף', correctedQuery: 'דיזנגוף תל אביב' });
  });
  it('fixes English typos and keyboard layout slips', async () => {
    const { client } = photon({ Jerusalem: [feature('ירושלים', 3, { osm_key: 'place', osm_value: 'city' })], דיזנגוף: [feature('דיזנגוף', 1)] });
    expect((await client.call(searchPlaces, { query: 'jerusalm' }))[0]).toMatchObject({ name: 'ירושלים', correctedQuery: 'Jerusalem' });
    expect((await client.call(searchPlaces, { query: 'shzbdu;' }))[0]).toMatchObject({ name: 'דיזנגוף', correctedQuery: 'דיזנגוף' });
  });
  it('tries the other-language form when the corrected one finds nothing', async () => {
    const { asked, client } = photon({ ירושלים: [feature('ירושלים', 3)] });
    const res = await client.call(searchPlaces, { query: 'jerusalm' });
    expect(res[0]?.name).toBe('ירושלים');
    expect(asked.filter((q) => q !== 'jerusalm').length).toBeLessThanOrEqual(2);
  });
  it('asks at most two more times', async () => {
    const { asked, client } = photon({});
    expect(await client.call(searchPlaces, { query: 'חיפא' })).toEqual([]);
    expect(asked.filter((q) => q !== 'חיפא').length).toBeLessThanOrEqual(2);
  });
  it('leaves good results and exact searches alone', async () => {
    const good = photon({ דיזנגוף: [feature('דיזנגוף', 1)] });
    expect(await good.client.call(searchPlaces, { query: 'דיזנגוף' })).toHaveLength(1);
    expect(good.asked).toEqual(['דיזנגוף']);
    const exact = photon({ דיזנגוף: [feature('דיזנגוף', 1)] });
    expect(await exact.client.call(searchPlaces, { query: 'דיזנגוב', exact: true })).toEqual([]);
    expect(exact.asked).toEqual(['דיזנגוב']);
  });
});

describe('result ranking', () => {
  it('moves a clear name match up, keeps the engine order otherwise', () => {
    const list = [place('קפה נמרוד'), place('מסעדת הים'), place('דיזנגוף סנטר')];
    expect(rankResults(list, 'דיזנגוף סנטר')[0].name).toBe('דיזנגוף סנטר');
    expect(rankResults(list, 'אוכל').map((p) => p.name)).toEqual(['קפה נמרוד', 'מסעדת הים', 'דיזנגוף סנטר']);
  });
  it('prefers the nearer of two equal matches', () => {
    const far = place('הרצל', { lat: 31.25, lng: 34.79 });
    const nearby = place('הרצל', { lat: 32.08, lng: 34.78 });
    expect(rankResults([far, nearby], 'הרצל', [34.78, 32.08])[0]).toBe(nearby);
  });
  it('puts the branch in your city before the one in the next city, and a far city last', () => {
    // The engine lists them by its own importance; the user is in central Tel Aviv.
    const haifa = place('גירף', { lat: 32.8, lng: 34.99, address: 'חיפה, ישראל' });
    const ramatGan = place('גירף', { lat: 32.083, lng: 34.812, address: 'רמת גן, ישראל' });
    const telAviv = place('גירף', { lat: 32.074, lng: 34.78, address: 'תל אביב-יפו, ישראל' });
    const here: [number, number] = [34.776, 32.08];
    expect(rankResults([haifa, ramatGan, telAviv], 'גירף', here)).toEqual([telAviv, ramatGan, haifa]);
  });
  it('knows a strong match from a weak one', () => {
    expect(hasStrongMatch([place('קניון עזריאלי')], 'עזראלי')).toBe(true);
    expect(hasStrongMatch([place('דיזנגוף', { address: 'תל אביב-יפו, ישראל' })], 'דיזנגוף תל אביב')).toBe(true);
    expect(hasStrongMatch([place('קניון עזריאלי')], 'דיזנגוב')).toBe(false);
  });
});

describe('confidentResult', () => {
  const street = (name: string, extra: Partial<Place> = {}) => place(name, { category: { key: 'highway', value: 'primary' }, address: 'תל אביב-יפו, ישראל', ...extra });
  it('opens a street, city or landmark that clearly matches', () => {
    const dz = street('דיזנגוף', { correctedQuery: 'דיזנגוף תל אביב' });
    expect(confidentResult([dz, street('דיזנגוף', { correctedQuery: 'דיזנגוף תל אביב' }), place('קפה דיזנגוף 99')], 'דיזנגוב תל אביב')).toBe(dz);
  });
  it('shows a list when the match is a business, weak or not alone', () => {
    expect(confidentResult([place('קפה נמרוד', { category: { key: 'amenity', value: 'cafe' } })], 'קפה נמרוד')).toBeNull();
    expect(confidentResult([street('הרצל'), street('הרצל', { lat: 31.25, address: 'באר שבע, ישראל' })], 'הרצל')).toBeNull();
    expect(confidentResult([street('דיזנגוף')], 'פיצה')).toBeNull();
  });
});

describe('category near a place', () => {
  it.each([
    ['מסעדות ליד דיזנגוף סנטר', 'restaurant', 'דיזנגוף סנטר'],
    ['קפה בפלורנטין', 'cafe', 'פלורנטין'],
    ['בתי קפה באזור רמת אביב', 'cafe', 'רמת אביב'],
    ['חניה ליד עזריאלי', 'parking', 'עזריאלי'],
    ['חניה קרוב לעזריאלי', 'parking', 'עזריאלי'],
    ['חניון קרוב ל עזריאלי', 'parking', 'עזריאלי'],
    ['pizza near azrieli', 'restaurant', 'azrieli'],
    ['cafes in florentin', 'cafe', 'florentin'],
    ['מסעדוט ליד עזריאלי', 'restaurant', 'עזריאלי'],
    ['בית מרקחת בבית שמש', 'pharmacy', 'בית שמש'],
    ['מסעדות בית שמש', 'restaurant', 'בית שמש'],
  ])('"%s" -> %s around "%s"', (q, cat, anchor) => {
    expect(parseCategoryQuery(q)).toEqual({ category: expect.objectContaining({ id: cat }), anchor });
  });
  it('leaves other searches alone', () => {
    for (const q of ['דיזנגוף סנטר', 'קפה', 'בית קפה', 'קפה נמרוד', 'קניון עזריאלי', 'tel aviv', 'רחוב הקפה 5', 'ליד']) {
      expect(parseCategoryQuery(q), q).toBeNull();
    }
  });
  it('reads category words with typos', () => {
    expect(categoryFromText('מסעדות')?.id).toBe('restaurant');
    expect(categoryFromText('בתי קפא')?.id).toBe('cafe');
    expect(categoryFromText('hotles')?.id).toBe('hotel');
    expect(categoryFromText('דיזנגוף')).toBeUndefined();
  });
});

describe('search like Google: near first, layout slips, villages', () => {
  const here: [number, number] = [34.776, 32.08];
  it('reads a Latin query typed on the wrong keyboard as Hebrew when nothing near matches it', async () => {
    const manila = { geometry: { coordinates: [121.0, 14.6] }, properties: { osm_type: 'N', osm_id: 9, osm_key: 'highway', osm_value: 'bus_stop', name: 'CTU', countrycode: 'PH' } };
    const { client } = photon({ ctu: [manila], באו: [feature('באולינג', 4, { osm_key: 'leisure', osm_value: 'bowling_alley' })] });
    const res = await client.call(searchPlaces, { query: 'ctu', near: here, zoom: 14 });
    expect(res[0]).toMatchObject({ name: 'באולינג', correctedQuery: 'באו' });
  });
  it('keeps a Latin query that finds something nearby', async () => {
    const { asked, client } = photon({ aroma: [feature('Aroma', 5, { osm_key: 'amenity', osm_value: 'cafe' })] });
    const res = await client.call(searchPlaces, { query: 'aroma', near: here });
    expect(res[0].name).toBe('Aroma');
    expect(asked).toEqual(['aroma']);
  });
  it('puts the mall around the corner before a village of a similar name', () => {
    const village = place('עזריאל', { lat: 32.3, lng: 34.93, category: { key: 'place', value: 'village' }, correctedQuery: 'עזריאל' });
    const mall = place('עזריאלי', { lat: 32.074, lng: 34.792, category: { key: 'shop', value: 'mall' } });
    expect(rankResults([village, mall], 'עזרילי', here)[0]).toBe(mall);
  });
  it('still knows a city by its name', () => {
    const paris = place('פריז', { lat: 48.85, lng: 2.35, category: { key: 'place', value: 'city' } });
    const street = place('פריז', { lat: 32.07, lng: 34.77, category: { key: 'highway', value: 'residential' } });
    expect(rankResults([paris, street], 'פריז', here)[0]).toBe(paris);
  });
  it('drops a result on another continent below anything within reach', () => {
    const far = place('CTU', { lat: 14.6, lng: 121, category: { key: 'highway', value: 'bus_stop' } });
    const near = place('CTU Acupuncture', { lat: 32.07, lng: 34.78 });
    expect(rankResults([far, near], 'ctu', here)[0]).toBe(near);
  });
});

describe('businesses from our own places index', () => {
  it('finds every branch in the region, not only what the map has loaded, nearest first', async () => {
    const { buildPlacesIndex, placesShardFile } = await import('@nm/core');
    const shards = buildPlacesIndex([
      { id: 'far', name: 'ארומה', lng: 34.79, lat: 31.25, brand: 'ארומה', town: 'באר שבע' },
      { id: 'near', name: 'ארומה', lng: 34.779, lat: 32.081, brand: 'ארומה', town: 'תל אביב-יפו' },
    ]);
    const asked: string[] = [];
    const fetchImpl = (async (u: string | URL | Request) => {
      const url = new URL(String(u));
      asked.push(url.pathname);
      if (url.hostname === 'photon.komoot.io') return json({ features: [] });
      if (url.pathname.endsWith('/il/places-search/index.json')) return json({ v: 1, built: 'x', shards: [...shards.keys()] });
      const key = [...shards.keys()].find((k) => url.pathname.endsWith(`/il/places-search/${placesShardFile(k)}`));
      if (key) return json(shards.get(key));
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const client = createToolClient({ ...DEFAULT_PROVIDERS, geodataUrl: 'https://example.test/data/' }, 'he', fetchImpl);
    const res = await client.call(searchPlaces, { query: 'ארומה', near: [34.776, 32.08] });
    expect(res.map((r) => r.id)).toEqual(['ovt:near', 'ovt:far']);
    expect(res[0].address).toBe('תל אביב-יפו');
  });
});
