import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addrShardOf,
  cellOf,
  detailShardOf,
  queryInfo,
  rankRecords,
  reverseLookup,
  revTileFile,
  shardFile,
  shardPrefix,
  type AddressShard,
  type DetailShard,
  type GeoManifest,
  type NameEntry,
  type PlaceRecord,
  type ReverseTile,
  type SearchRecord,
} from '../../packages/core/src/geoindex.ts';
import { buildGeodata, parseLine, regionById, representativePoint } from './build.ts';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'tel-aviv.geojsonseq');
const lines = () => readFileSync(FIXTURE, 'utf8').split('\n');

async function build(extra: { searchShardBytes?: number } = {}) {
  const out = join(mkdtempSync(join(tmpdir(), 'geodata-')), 'il');
  const report = await buildGeodata(lines(), { region: regionById('il'), out, built: '2026-01-01T00:00:00.000Z', source: 'scripts/geodata/fixtures/tel-aviv.geojsonseq', ...extra });
  const read = <T>(rel: string): T => JSON.parse(readFileSync(join(out, rel), 'utf8')) as T;
  return { out, report, read, m: read<GeoManifest>('manifest.json') };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}

describe('parseLine', () => {
  it('reads osmium attributes, record separators and unique ids, and skips junk', () => {
    expect(parseLine('\x1e{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"@type":"node","@id":5,"name":"x"}}')).toEqual({
      sid: 'n5',
      tags: { name: 'x' },
      geometry: { type: 'Point', coordinates: [1, 2] },
    });
    // --add-unique-id=type_id: areas are "a" + 2*way id (or 2*relation id + 1).
    const area = (id: string) => parseLine(`{"type":"Feature","id":"${id}","geometry":{"type":"Point","coordinates":[1,2]},"properties":{}}`)?.sid;
    expect([area('a20'), area('a21'), area('w7')]).toEqual(['w10', 'r10', 'w7']);
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('')).toBeNull();
  });

  it('puts a point inside a concave polygon', () => {
    // A "U": the centroid falls in the gap.
    const u = { type: 'Polygon' as const, coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]] as [number, number][]] };
    const p = representativePoint(u);
    expect(p[1]).toBeGreaterThan(0);
    expect(p[0] < 1 || p[0] > 2 || p[1] < 1).toBe(true);
  });
});

describe('buildGeodata on the Tel Aviv fixture', () => {
  it('writes a manifest with what it indexed and skips noise', async () => {
    const { m, report } = await build();
    expect(m).toMatchObject({ v: 1, region: 'il', country: 'il', revCell: 0.02, addrShards: 1, detailShards: 1 });
    expect(m.counts).toMatchObject({ places: 4, streets: 5, pois: 6 });
    // 50, 52, 99, 120 (the bakery), 69, 71, 12, 14 and ז'בוטינסקי 1 twice (address node + the pharmacy)
    expect(m.counts.addresses).toBe(10);
    expect(report.files).toBeGreaterThan(10);
    expect(JSON.stringify(m)).not.toContain('שיכון');
  });

  it('gives streets and POIs their city from municipality boundaries, not regional councils', async () => {
    const { read, m } = await build();
    const recs = (word: string) => read<SearchRecord[]>(shardFile(shardPrefix(queryInfo(word).tokens[0], new Set(m.split))));
    const jabo = recs("ז'בוטינסקי").filter((r) => r.k === 'street');
    expect(jabo.map((r) => r.c).sort()).toEqual(['רמת גן', 'תל אביב-יפו']);
    const rothschild = recs('רוטשילד').find((r) => r.n === 'שדרות רוטשילד')!;
    expect(rothschild).toMatchObject({ i: 'w23315271', k: 'street', c: 'תל אביב-יפו', t: 'highway=secondary', en: 'Rothschild Boulevard' });
    // The Tel Aviv node gets the municipality's extent.
    const ta = recs('תל').find((r) => r.i === 'n29090735')!;
    expect(ta.b).toEqual([34.739, 32.03, 34.84, 32.146]);
    expect(ta.w).toBeGreaterThan(130);
    const places = read<PlaceRecord[]>('places.json');
    expect(places.find((p) => p[2] === 'הצפון הישן')?.[5]).toBe('תל אביב-יפו');
  });

  it('merges the ways of one street and finds it by any word', async () => {
    const { read, m } = await build();
    const split = new Set(m.split);
    const recs = read<SearchRecord[]>(shardFile(shardPrefix('דיזנגוף', split)));
    const diz = recs.filter((r) => r.n === 'דיזנגוף');
    expect(diz).toHaveLength(1);
    expect(diz[0]).toMatchObject({ k: 'street', b: [34.7735, 32.0787, 34.7745, 32.0905], a: 'w4290511' });
    const museum = read<SearchRecord[]>(shardFile(shardPrefix('לאמנות', split))).find((r) => r.i === 'w29014234');
    expect(museum).toMatchObject({ k: 'poi', t: 'tourism=museum', c: 'תל אביב-יפו' });
  });

  it('stores housenumbers per street, deduplicated', async () => {
    const { read, m } = await build();
    const shard = read<AddressShard>(addrShardOf('w5160390', m.addrShards));
    expect(shard.w5160390.map((a) => a[0])).toEqual(['69', '71']);
    expect(read<AddressShard>(addrShardOf('w23315271', m.addrShards)).w23315271.map((a) => a[0])).toEqual(['12', '14']);
    expect(read<AddressShard>(addrShardOf('w26553401', m.addrShards)).w26553401).toHaveLength(1);
  });

  it('keeps details with the tags we show, minus noise', async () => {
    const { read, m } = await build();
    const bakery = read<DetailShard>(detailShardOf('n7000001', m.detailShards)).n7000001;
    expect(bakery.t).toMatchObject({ shop: 'bakery', opening_hours: 'Su-Th 07:00-20:00; Fr 07:00-15:00', phone: '+972 3 555 0101', wheelchair: 'yes' });
    expect(bakery.t.check_date).toBeUndefined();
    expect(bakery.c).toBe('תל אביב-יפו');
    expect(read<DetailShard>(detailShardOf('w23315271', m.detailShards)).w23315271.t.source).toBeUndefined();
  });

  it('answers reverse geocoding from the grid', async () => {
    const { read, m } = await build();
    const at = (lng: number, lat: number) => {
      const tiles = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const [x, y] = cellOf(lng, lat, m.revCell);
          try {
            tiles.push({ x: x + dx, y: y + dy, tile: read<ReverseTile>(revTileFile(x + dx, y + dy)) });
          } catch {
            /* empty cell */
          }
        }
      return reverseLookup([lng, lat], tiles, m.revCell, read<PlaceRecord[]>('places.json'), 'il');
    };
    expect(at(34.78196, 32.08182)?.place).toMatchObject({ name: 'אבן גבירול 71', address: 'תל אביב-יפו', category: { key: 'place', value: 'house' } });
    expect(at(34.7826, 32.0890)?.place).toMatchObject({ name: 'אבן גבירול', category: { key: 'highway', value: 'primary' }, id: 'osm:w5160390' });
    // The second Dizengoff way answers with the street's record id.
    expect(at(34.77355, 32.0890)?.place.id).toBe('osm:w4290511');
    expect(at(34.8243, 32.214)?.place).toMatchObject({ name: 'שפיים', category: { key: 'place', value: 'village' } });
  });

  it('ranks a typed query over the built records', async () => {
    const { read, m } = await build();
    const q = queryInfo('דיזנ');
    const recs = read<SearchRecord[]>(shardFile(shardPrefix(q.tokens[0], new Set(m.split))));
    expect(rankRecords(recs, q, { near: [34.78, 32.08], zoom: 14 })[0].rec.n).toBe('דיזנגוף');
  });

  it('writes a names dictionary for spell correction', async () => {
    const { read } = await build();
    const names = read<NameEntry[]>('names.json');
    expect(names[0]).toMatchObject({ k: 'city', n: 'Tel Aviv-Yafo' });
    expect(names.find((n) => n.n === 'מאפיית אורנה')).toEqual({ n: 'מאפיית אורנה', k: 'poi', w: 15, c: 'תל אביב-יפו' });
    expect(new Set(names.map((n) => n.n)).size).toBe(names.length);
  });

  it('splits big search shards so lookups still find every word', async () => {
    const { read, m } = await build({ searchShardBytes: 300 });
    expect(m.split.length).toBeGreaterThan(0);
    const split = new Set(m.split);
    for (const word of ['דיזנגוף', 'אבן', 'גבירול', 'מוזיאון', 'tel', 'رمت'].slice(0, 5)) {
      const p = shardPrefix(queryInfo(word).tokens[0], split);
      expect(m.shards).toContain(p);
      expect(read<SearchRecord[]>(shardFile(p)).length).toBeGreaterThan(0);
    }
  });

  it('matches the committed e2e dataset (run `pnpm geodata:fixture` after changing the builder)', async () => {
    const { out } = await build();
    const committed = join(import.meta.dirname, '..', '..', 'e2e', 'geodata', 'il');
    const files = (dir: string) => walk(dir).map((f) => relative(dir, f)).sort();
    expect(files(out)).toEqual(files(committed));
    for (const f of files(out)) expect(readFileSync(join(out, f), 'utf8'), f).toBe(readFileSync(join(committed, f), 'utf8'));
  });
});
