import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { zxyToTileId } from 'pmtiles';

/**
 * A tiny Overture places archive (PMTiles v3, uncompressed) for central Tel Aviv, so tests
 * exercise the real pmtiles:// path: release lookup, range requests, the map layer, taps.
 */
const json = (v: unknown) => JSON.stringify(v);
const place = (id: string, lng: number, lat: number, name: string, cat: string, conf: number, extra: Record<string, unknown> = {}) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [lng, lat] },
  properties: {
    id,
    '@name': name,
    names: json({ primary: name }),
    basic_category: cat,
    confidence: conf,
    taxonomy: json({ primary: cat, hierarchy: [cat] }),
    ...extra,
  },
});

export const OVERTURE_FIXTURE = [
  place('aaaaaaaa-0000-4000-8000-000000000001', 34.7792, 32.0801, 'ביסטרו הכרמל', 'restaurant', 0.95, {
    phones: json(['+97235236058']),
    websites: json(['https://bistro.example']),
    addresses: json([{ freeform: 'בן יהודה 28', locality: 'תל אביב - יפו', country: 'IL' }]),
    socials: json(['https://www.facebook.com/123']),
    emails: json(['hello@bistro.example']),
  }),
  place('aaaaaaaa-0000-4000-8000-000000000002', 34.7812, 32.0786, 'קפה רוטשילד', 'coffee_shop', 0.9),
  place('aaaaaaaa-0000-4000-8000-000000000003', 34.7768, 32.0779, 'בוטיק נוגה', 'fashion_and_apparel_store', 0.85),
  place('aaaaaaaa-0000-4000-8000-000000000004', 34.7842, 32.0812, 'מלון הבימה', 'hotel', 0.92),
  place('aaaaaaaa-0000-4000-8000-000000000005', 34.7735, 32.0832, 'פארם השכונה', 'pharmacy_and_drug_store', 0.8),
  place('aaaaaaaa-0000-4000-8000-000000000006', 34.7858, 32.0771, 'גלריה לאמנות', 'art_gallery', 0.7),
  place('aaaaaaaa-0000-4000-8000-000000000007', 34.7802, 32.0822, 'מספרת יוסי', 'personal_or_beauty_service', 0.75),
  place('aaaaaaaa-0000-4000-8000-000000000008', 34.7825, 32.0757, 'סגור לצמיתות', 'restaurant', 0.9, { operating_status: 'permanently_closed' }),
];

function varint(out: number[], n: number) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function build(): Buffer {
  const index = new geojsonvt({ type: 'FeatureCollection', features: OVERTURE_FIXTURE } as never, { maxZoom: 14, indexMaxZoom: 14, extent: 4096, buffer: 64 });
  const Z = 14;
  const n = 2 ** Z;
  const tx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const coords = new Set(OVERTURE_FIXTURE.map((f) => `${tx(f.geometry.coordinates[0])}/${ty(f.geometry.coordinates[1])}`));
  const tiles = [...coords]
    .map((c) => {
      const [x, y] = c.split('/').map(Number);
      const t = index.getTile(Z, x, y);
      return { id: zxyToTileId(Z, x, y), data: Buffer.from(vtpbf.fromGeojsonVt({ place: t } as never, { version: 2 })) };
    })
    .sort((a, b) => a.id - b.id);
  // Root directory: count, tile id deltas, run lengths, lengths, offsets (+1, or 0 = contiguous).
  const dir: number[] = [];
  varint(dir, tiles.length);
  let last = 0;
  for (const t of tiles) {
    varint(dir, t.id - last);
    last = t.id;
  }
  for (const _ of tiles) varint(dir, 1);
  for (const t of tiles) varint(dir, t.data.length);
  tiles.forEach((_t, i) => varint(dir, i === 0 ? 1 : 0));
  const dirBuf = Buffer.from(dir);
  const meta = Buffer.from(json({ vector_layers: [{ id: 'place', fields: {} }] }));
  const data = Buffer.concat(tiles.map((t) => t.data));
  const h = Buffer.alloc(127);
  h.write('PMTiles', 0, 'ascii');
  h.writeUInt8(3, 7);
  const u64 = (off: number, v: number) => h.writeBigUInt64LE(BigInt(v), off);
  u64(8, 127);
  u64(16, dirBuf.length);
  u64(24, 127 + dirBuf.length);
  u64(32, meta.length);
  u64(40, 0);
  u64(48, 0);
  u64(56, 127 + dirBuf.length + meta.length);
  u64(64, data.length);
  u64(72, tiles.length);
  u64(80, tiles.length);
  u64(88, tiles.length);
  h.writeUInt8(1, 96); // clustered
  h.writeUInt8(1, 97); // internal compression: none
  h.writeUInt8(1, 98); // tile compression: none
  h.writeUInt8(1, 99); // MVT
  h.writeUInt8(0, 100);
  h.writeUInt8(14, 101);
  h.writeInt32LE(Math.round(34.7 * 1e7), 102);
  h.writeInt32LE(Math.round(32.0 * 1e7), 106);
  h.writeInt32LE(Math.round(34.9 * 1e7), 110);
  h.writeInt32LE(Math.round(32.2 * 1e7), 114);
  h.writeUInt8(14, 118);
  h.writeInt32LE(Math.round(34.78 * 1e7), 119);
  h.writeInt32LE(Math.round(32.08 * 1e7), 123);
  return Buffer.concat([h, dirBuf, meta, data]);
}

export const PLACES_PMTILES = build();
export const PLACES_RELEASE = '2026-09-23.1';
export const PLACES_LISTING = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><CommonPrefixes><Prefix>tiles/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-08-19.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/${PLACES_RELEASE}/</Prefix></CommonPrefixes></ListBucketResult>`;
