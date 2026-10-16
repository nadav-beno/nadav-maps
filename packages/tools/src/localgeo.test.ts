import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { resetLocalGeo } from './providers/localgeo.ts';
import { identifyPlace, placeDetails, reverseGeocode, searchPlaces } from './tools/index.ts';

// The tiny dataset the e2e tests use, built from scripts/geodata/fixtures/tel-aviv.geojsonseq.
const DATA = join(import.meta.dirname, '..', '..', '..', 'e2e', 'geodata');
const BASE = 'https://maps.example/data/';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(opts: { geodata?: boolean; photon?: unknown[]; failPhoton?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (u: string | URL | Request) => {
    const url = new URL(String(u));
    calls.push(url.host === 'maps.example' ? `data:${url.pathname.replace('/data/', '')}` : url.host);
    if (url.host === 'maps.example') {
      const f = join(DATA, url.pathname.replace('/data/', ''));
      if (opts.geodata === false || !existsSync(f)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': 'application/json' } });
    }
    if (url.host === 'photon.komoot.io') {
      if (opts.failPhoton) return new Response('busy', { status: 503 });
      return json({ features: opts.photon ?? [] });
    }
    if (url.host === 'overpass-api.de') return json({ elements: [] });
    return new Response('', { status: 500 });
  }) as typeof fetch;
  const client = createToolClient({ ...DEFAULT_PROVIDERS, geodataUrl: BASE }, 'he', fetchImpl);
  return { client, calls, external: () => calls.filter((c) => !c.startsWith('data:')) };
}

const paris = { geometry: { coordinates: [2.35, 48.85] }, properties: { osm_type: 'R', osm_id: 7444, osm_key: 'place', osm_value: 'city', name: 'Paris', country: 'France', countrycode: 'FR' } };

beforeEach(() => resetLocalGeo());

describe('typo corrections from the region names list', () => {
  it('loads names.json only when a query finds nothing good, then corrects with it', async () => {
    const good = setup();
    await good.client.call(searchPlaces, { query: 'דיזנגוף', near: [34.78, 32.08] });
    expect(good.calls).not.toContain('data:il/names.json');
    const typo = setup();
    // "מאפיית אורנה" is in the region's names list, not in the built-in dictionary.
    const res = await typo.client.call(searchPlaces, { query: 'מאפיית אורנא', near: [34.78, 32.08] });
    expect(typo.calls).toContain('data:il/names.json');
    expect(res[0]).toMatchObject({ name: 'מאפיית אורנה', correctedQuery: 'מאפיית אורנה' });
  });
});

describe('search from our own data', () => {
  it('resolves "street number city" to the address point without Photon', async () => {
    const { client, external } = setup();
    const res = await client.call(searchPlaces, { query: 'אבן גבירול 71 תל אביב', near: [34.78, 32.08] });
    expect(res[0]).toMatchObject({ name: 'אבן גבירול 71', address: 'תל אביב-יפו', id: 'pt:34.78195,32.08180', category: { key: 'place', value: 'house' } });
    expect(external()).toEqual([]);
  });

  it('takes the closest number on the same side when the exact one is not mapped', async () => {
    const { client } = setup();
    const res = await client.call(searchPlaces, { query: 'דיזנגוף 54', near: [34.78, 32.08] });
    expect(res[0]).toMatchObject({ name: 'דיזנגוף 54', lng: 34.7745, lat: 32.0795 });
  });

  it('finds a POI by any word, with its city and street, and a street while typing', async () => {
    const { client, external } = setup();
    const bakery = await client.call(searchPlaces, { query: 'מאפיית אורנה', near: [34.78, 32.08] });
    expect(bakery[0]).toMatchObject({ id: 'osm:n7000001', name: 'מאפיית אורנה', address: 'דיזנגוף 120, תל אביב-יפו', category: { key: 'shop', value: 'bakery' } });
    const typing = await client.call(searchPlaces, { query: 'דיזנ', near: [34.78, 32.08], zoom: 15 });
    expect(typing[0]).toMatchObject({ id: 'osm:w4290511', name: 'דיזנגוף', address: 'תל אביב-יפו' });
    const city = await client.call(searchPlaces, { query: 'תל אביב' });
    expect(city[0]).toMatchObject({ id: 'osm:n29090735', extent: [34.739, 32.03, 34.84, 32.146] });
    expect(external()).toEqual([]);
  });

  it('strips glued prefixes like Photon does ("בתל אביב")', async () => {
    const { client, external } = setup();
    const res = await client.call(searchPlaces, { query: 'בתל אביב' });
    expect(res[0].id).toBe('osm:n29090735');
    expect(external()).toEqual([]);
  });

  it('asks Photon when we have nothing, and for Latin-script queries (foreign places)', async () => {
    const miss = setup({ photon: [paris] });
    expect((await miss.client.call(searchPlaces, { query: 'מגדל אייפל' }))[0].name).toBe('Paris');
    expect(miss.external()).toContain('photon.komoot.io');
    const latin = setup({ photon: [paris] });
    const res = await latin.client.call(searchPlaces, { query: 'Tel Aviv' });
    // A settlement first; then what matches the name (re-ranked by similarity) before Photon's unrelated one.
    expect(res.map((r) => r.name)).toEqual(['תל אביב-יפו', 'מוזיאון תל אביב לאמנות', 'Paris']);
  });

  it('keeps local results when Photon fails', async () => {
    const { client } = setup({ failPhoton: true });
    const res = await client.call(searchPlaces, { query: 'Dizengoff' });
    expect(res[0].id).toBe('osm:w4290511');
  });

  it('falls back to Photon when there is no dataset, and only reads the manifest once', async () => {
    const { client, calls } = setup({ geodata: false, photon: [paris] });
    await client.call(searchPlaces, { query: 'דיזנגוף' });
    await client.call(searchPlaces, { query: 'אבן גבירול' });
    expect(calls.filter((c) => c === 'data:il/manifest.json')).toHaveLength(1);
    expect(calls.filter((c) => c === 'photon.komoot.io').length).toBeGreaterThanOrEqual(2);
  });

  it('outside the region goes straight to Photon', async () => {
    const { client, calls } = setup({ photon: [paris] });
    await client.call(searchPlaces, { query: 'דיזנגוף', near: [2.35, 48.85] });
    expect(calls).toEqual(['photon.komoot.io']);
  });
});

describe('reverse geocoding, details and identify from our own data', () => {
  it('names the address at a long-press', async () => {
    const { client, external } = setup();
    expect(await client.call(reverseGeocode, { lng: 34.78196, lat: 32.08182 })).toMatchObject({ name: 'אבן גבירול 71', address: 'תל אביב-יפו' });
    expect(await client.call(reverseGeocode, { lng: 34.8243, lat: 32.214 })).toMatchObject({ name: 'שפיים' });
    expect(external()).toEqual([]);
  });

  it('asks Photon in the sea', async () => {
    const { client, external } = setup({ photon: [paris] });
    await client.call(reverseGeocode, { lng: 34.5, lat: 32.5 });
    expect(external()).toEqual(['photon.komoot.io']);
  });

  it('reads place details by OSM id, with the city, and falls back to Overpass on a miss', async () => {
    const { client, external } = setup();
    const d = await client.call(placeDetails, { id: 'osm:n7000001' });
    expect(d).toMatchObject({ name: 'מאפיית אורנה', openingHours: 'Su-Th 07:00-20:00; Fr 07:00-15:00', phone: '+972 3 555 0101', wheelchair: 'yes', address: 'דיזנגוף 120, תל אביב-יפו', countryCode: 'il' });
    const museum = await client.call(placeDetails, { id: 'osm:w29014234' });
    expect(museum).toMatchObject({ wikidata: 'Q1281751', website: 'https://www.tamuseum.org.il', category: { key: 'tourism', value: 'museum' } });
    expect(external()).toEqual([]);
    expect(await client.call(placeDetails, { id: 'osm:n42' })).toBeNull();
    expect(external()).toEqual(['overpass-api.de']);
  });

  it('identifies a tapped label, and knows our own address names need no lookup', async () => {
    const { client, external } = setup();
    expect(await client.call(identifyPlace, { name: 'קפה נואר', lng: 34.7766, lat: 32.0743 })).toMatchObject({ id: 'osm:n7000002', openingHours: 'Mo-Su 08:00-23:00' });
    expect(await client.call(identifyPlace, { name: 'אבן גבירול 71', lng: 34.78196, lat: 32.08182 })).toBeNull();
    expect(external()).toEqual([]);
    await client.call(identifyPlace, { name: 'בית קפה אחר', lng: 34.7766, lat: 32.0743 });
    expect(external()).toEqual(['overpass-api.de']);
  });
});
