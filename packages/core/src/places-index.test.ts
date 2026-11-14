import { describe, expect, it } from 'vitest';
import { buildPlacesIndex, placesQueryShard, placesShardFile, placeTokens, searchPlacesShard, type PlaceInput } from './places-index.ts';

const here: [number, number] = [34.776, 32.08];
const p = (id: string, name: string, lat: number, lng: number, extra: Partial<PlaceInput> = {}): PlaceInput => ({ id, name, lat, lng, category: 'coffee_shop', ...extra });

describe('places search index', () => {
  const places = [
    p('a1', 'ארומה', 32.081, 34.779, { brand: 'ארומה', town: 'תל אביב-יפו', street: 'דיזנגוף 100', mz: 13 }),
    p('a2', 'ארומה', 32.79, 34.99, { brand: 'ארומה', town: 'חיפה' }),
    p('a3', 'ארומה אספרסו בר', 31.25, 34.79, { brand: 'ארומה', town: 'באר שבע' }),
    p('s1', 'סופר-פארם', 32.09, 34.774, { category: 'pharmacy', town: 'תל אביב-יפו' }),
    p('x1', 'מסעדת הכרמל', 32.07, 34.77, { category: 'restaurant', altName: 'HaCarmel Restaurant' }),
    p('c1', 'סגור', 32.07, 34.77, { closed: true }),
  ];
  const shards = buildPlacesIndex(places);

  it('indexes every word, the glued name and the word without ה', () => {
    expect(placeTokens(['סופר-פארם'])).toEqual(expect.arrayContaining(['סופר', 'פארמ', 'סופרפארמ']));
    expect(placeTokens(['מסעדת הכרמל'])).toEqual(expect.arrayContaining(['הכרמל', 'כרמל']));
    expect([...shards.keys()]).toEqual(expect.arrayContaining(['אר', 'סו', 'פא', 'כר', 'ha']));
    expect([...shards.values()].some((s) => s.r.some((r) => r[0] === 'c1'))).toBe(false);
  });

  it('finds every branch of a chain, the nearest first, with its town', () => {
    const res = searchPlacesShard(shards.get('אר')!, 'ארומ', here);
    expect(res.map((r) => r.id)).toEqual(['ovt:a1', 'ovt:a2', 'ovt:a3']);
    expect(res[0]).toMatchObject({ name: 'ארומה', brand: 'ארומה', address: 'דיזנגוף 100, תל אביב-יפו', category: { key: 'overture', value: 'coffee_shop' } });
  });

  it('finds a name typed with or without the space, by a middle word, and in English', () => {
    expect(searchPlacesShard(shards.get('סו')!, 'סופרפארם', here)[0]?.id).toBe('ovt:s1');
    expect(searchPlacesShard(shards.get('פא')!, 'פארם', here)[0]?.id).toBe('ovt:s1');
    expect(searchPlacesShard(shards.get('כר')!, 'כרמל', here)[0]?.id).toBe('ovt:x1');
    expect(searchPlacesShard(shards.get('ha')!, 'hacarmel', here)[0]?.name).toBe('מסעדת הכרמל');
  });

  it('splits a crowded shard by one more letter and reads the right one', () => {
    const many = Array.from({ length: 12 }, (_, i) => p(`b${i}`, i % 2 ? `ביסטרו ${i}` : `בית קפה ${i}`, 32.08, 34.78));
    const split = buildPlacesIndex(many, 7);
    expect(split.has('ביס') && split.has('בית')).toBe(true);
    const keys = new Set(split.keys());
    expect(placesQueryShard('ביסטרו', keys)).toBe('ביס');
    expect(placesQueryShard('בית קפה', keys)).toBe('בית');
    expect(searchPlacesShard(split.get('ביס')!, 'ביסט', here)).toHaveLength(6);
  });

  it('names shard files safely', () => {
    expect(placesShardFile('אר')).toBe('5d0-5e8.json');
  });
});
