import { describe, expect, it } from 'vitest';
import {
  cellOf,
  cellsAround,
  indexTokens,
  normHouse,
  parseHouseQuery,
  queryInfo,
  rankRecords,
  recordToPlace,
  reverseLookup,
  searchKey,
  shardFile,
  shardPrefix,
  streetAddrKey,
  type ReverseTile,
  type SearchRecord,
} from './geoindex.ts';
import { providersFromEnv } from './config.ts';
import { geodataRegionAt } from './region.ts';

describe('searchKey', () => {
  it('folds final letters, quotes, punctuation, niqqud, case and accents', () => {
    expect(searchKey('תל אביב-יפו')).toBe('תל אביב יפו');
    expect(searchKey('תל־אביב–יפו')).toBe('תל אביב יפו'); // maqaf is a hyphen
    expect(searchKey('ז׳בוטינסקי')).toBe(searchKey("ז'בוטינסקי"));
    expect(searchKey('ז׳בוטינסקי')).toBe('זבוטינסקי');
    expect(searchKey('קניון')).toBe('קניונ');
    expect(searchKey('שָׁלוֹם')).toBe('שלומ');
    expect(searchKey('Café  Noir')).toBe('cafe noir');
    expect(searchKey('רח\' הרצל')).toBe('רחוב הרצל');
    expect(searchKey('ת"א')).toBe('תל אביב');
    expect(searchKey('קרית שמונה')).toBe('קריית שמונה');
  });

  it('indexes every word with and without the article', () => {
    expect(indexTokens(['הכרמל', 'שוק'])).toEqual(['הכרמל', 'כרמל', 'שוק']);
    expect(indexTokens(['A b'])).toEqual([]);
  });
});

describe('shards', () => {
  it('uses 2-character prefixes, longer ones where split', () => {
    expect(shardPrefix('דיזנגוף', new Set())).toBe('די');
    expect(shardPrefix('דיזנגוף', new Set(['די']))).toBe('דיז');
    expect(shardPrefix('די', new Set(['די']))).toBe('די$');
    expect(shardPrefix('דיז', new Set(['די', 'דיז']))).toBe('דיז$');
    expect(shardFile('די')).toBe('s/5d3-5d9.json');
    expect(shardFile('ab$')).toBe('s/61-62-24.json');
  });

  it('cells are stable at their edges', () => {
    expect(cellOf(34.8, 32.02, 0.02)).toEqual([1740, 1601]);
    expect(cellsAround(34.7901, 32.0901, 0.02)).toHaveLength(1);
    expect(cellsAround(34.8001, 32.0999, 0.02)).toHaveLength(4);
  });

  it('address keys and housenumbers', () => {
    expect(streetAddrKey('w1', 'x', 'y')).toBe('w1');
    expect(streetAddrKey(undefined, 'דיזנגוף', 'תל אביב-יפו')).toBe('דיזנגופ|תל אביב יפו');
    expect(normHouse('12 א')).toBe('12א');
    expect(normHouse('12A')).toBe('12a');
    expect(parseHouseQuery(searchKey('דיזנגוף 50 תל אביב'))).toEqual({ number: '50', rest: ['דיזנגופ', 'תל', 'אביב'] });
    expect(parseHouseQuery(searchKey('הרצל 12 א'))).toEqual({ number: '12א', rest: ['הרצל'] });
    // A leading number is part of a name ("6 כביש" is unusual, but "1 במאי" is a street).
    expect(parseHouseQuery(searchKey('1 במאי')).number).toBeUndefined();
  });
});

const rec = (r: Partial<SearchRecord> & Pick<SearchRecord, 'n'>): SearchRecord => ({ k: 'poi', l: [34.78, 32.08], w: 15, ...r });

describe('ranking', () => {
  const recs: SearchRecord[] = [
    rec({ i: 'n1', n: 'תל אביב-יפו', en: 'Tel Aviv-Yafo', k: 'city', w: 137, l: [34.7805, 32.0853], t: 'place=city' }),
    rec({ i: 'w2', n: 'דיזנגוף', k: 'street', w: 45, c: 'תל אביב-יפו', t: 'highway=secondary', a: 'w2' }),
    rec({ i: 'w3', n: 'דיזנגוף', k: 'street', w: 33, c: 'נתניה', l: [34.86, 32.32] }),
    rec({ i: 'n4', n: 'דיזנגוף סנטר', k: 'poi', w: 27, c: 'תל אביב-יפו', t: 'shop=mall' }),
    rec({ i: 'n5', n: 'קפה תל אביב', k: 'poi', w: 15, c: 'חיפה', l: [34.99, 32.8] }),
  ];
  const top = (q: string, opts = {}) => rankRecords(recs, queryInfo(q), opts).map((s) => s.rec.i);

  it('prefers the whole name, then prefixes, and drops non-matches', () => {
    expect(top('דיזנגוף')).toEqual(['w2', 'w3', 'n4']);
    expect(top('דיזנ')[0]).toBe('w2');
    expect(top('סנטר')).toEqual(['n4']);
    expect(top('xyz')).toEqual([]);
  });

  it('lets query words match the city', () => {
    expect(top('דיזנגוף נתניה')).toEqual(['w3']);
    expect(top('תל אביב')[0]).toBe('n1');
    expect(top('Tel Aviv')[0]).toBe('n1');
  });

  it('closeness to the map centre breaks ties', () => {
    expect(top('דיזנגוף', { near: [34.86, 32.32], zoom: 15 })[0]).toBe('w3');
  });

  it('filters to a box', () => {
    expect(top('דיזנגוף', { bbox: [34.8, 32.2, 35, 32.4] })).toEqual(['w3']);
  });

  it('marks a whole-name match complete, one word of a long name not', () => {
    const [s] = rankRecords([recs[3]], queryInfo('סנטר'));
    expect(s.complete).toBe(false);
    expect(rankRecords([recs[3]], queryInfo('דיזנגוף ס'))[0].complete).toBe(true);
  });

  it('turns records into places', () => {
    expect(recordToPlace(recs[1], 'he', 'il')).toEqual({
      id: 'osm:w2',
      name: 'דיזנגוף',
      lng: 34.78,
      lat: 32.08,
      address: 'תל אביב-יפו',
      category: { key: 'highway', value: 'secondary' },
      osm: { type: 'way', id: 2 },
      countryCode: 'il',
    });
    expect(recordToPlace(recs[0], 'en', 'il').name).toBe('Tel Aviv-Yafo');
    expect(recordToPlace(rec({ n: 'רחוב', k: 'street', l: [34.1, 31.2] }), 'he', 'il').id).toBe('pt:34.10000,31.20000');
  });
});

describe('reverseLookup', () => {
  // Cell 1739_1604 starts at 34.78, 32.08.
  const tile: ReverseTile = {
    n: ['אבן גבירול', 'קפה'],
    c: ['תל אביב-יפו'],
    a: [[195, 180, 0, '71', 0]],
    s: [[0, 0, 'w5', 'primary', 160, -300, 200, 500]],
    p: [[600, 600, 1, 0, 'n9', 'amenity=cafe']],
  };
  const at = (lng: number, lat: number) => reverseLookup([lng, lat], [{ x: 1739, y: 1604, tile }], 0.02, [[3478050, 3208530, 'תל אביב-יפו', 'city', 'n1', '']], 'il');

  it('address, then POI, then street, then settlement', () => {
    expect(at(34.78196, 32.08181)).toMatchObject({ kind: 'address', place: { name: 'אבן גבירול 71', address: 'תל אביב-יפו', id: 'pt:34.78195,32.08180' } });
    expect(at(34.786, 32.086)).toMatchObject({ kind: 'poi', place: { id: 'osm:n9', name: 'קפה' } });
    expect(at(34.7825, 32.0830)).toMatchObject({ kind: 'street', place: { name: 'אבן גבירול', id: 'osm:w5', category: { key: 'highway', value: 'primary' } } });
    expect(at(34.79, 32.09)).toMatchObject({ kind: 'place', place: { name: 'תל אביב-יפו', category: { key: 'place', value: 'city' } } });
    expect(at(34.5, 31.5)).toBeNull();
  });
});

describe('geodata config', () => {
  it('defaults to the site folder in the web build, off on the server, "" switches it off', () => {
    expect(providersFromEnv({ BASE_URL: '/nadav-maps/' }, 'VITE_').geodataUrl).toBe('/nadav-maps/data/');
    expect(providersFromEnv({}).geodataUrl).toBe('');
    expect(providersFromEnv({ GEODATA_URL: 'https://example.org/maps/data' }).geodataUrl).toBe('https://example.org/maps/data/');
    expect(providersFromEnv({ BASE_URL: '/', VITE_GEODATA_URL: '' }, 'VITE_').geodataUrl).toBe('');
  });

  it('knows which regions have their own data', () => {
    expect(geodataRegionAt([34.78, 32.08])?.geodata.id).toBe('il');
    expect(geodataRegionAt([2.35, 48.85])).toBeNull();
  });
});
