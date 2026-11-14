#!/usr/bin/env node
// Writes the places search index (packages/core/src/places-index.ts) from build.py's GeoJSON lines:
//
//   node --experimental-strip-types scripts/places/search-index.ts <places.geojsonseq> <out dir>
//
// <out dir>/places-search/<shard>.json, one file per first-two-letters of a name word, plus
// index.json listing the shards (so the app asks only for files that exist).
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { buildPlacesIndex, PLACES_INDEX_DIR, PLACES_INDEX_VERSION, placesShardFile, type PlaceInput } from '../../packages/core/src/places-index.ts';

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error('usage: search-index.ts <places.geojsonseq> <out dir>');
  process.exit(2);
}

function json<T>(v: unknown): T | undefined {
  if (typeof v !== 'string') return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

async function* places(): AsyncGenerator<PlaceInput> {
  const lines = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const f = JSON.parse(line.replace(/^\x1e/, ''));
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const addr = json<{ freeform?: string; locality?: string }[]>(p.addresses)?.[0];
    yield {
      id: String(p.id),
      name: String(p['@name'] ?? ''),
      altName: typeof p.name === 'string' ? p.name : undefined,
      lng,
      lat,
      category: p.basic_category,
      brand: json<{ names?: { primary?: string } }>(p.brand)?.names?.primary,
      mz: typeof p.mz === 'number' ? p.mz : undefined,
      closed: p.operating_status === 'permanently_closed',
      street: addr?.freeform,
      town: addr?.locality,
    };
  }
}

const all: PlaceInput[] = [];
for await (const p of places()) all.push(p);
const shards = buildPlacesIndex(all);
const dir = join(outDir, PLACES_INDEX_DIR);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
let bytes = 0;
let biggest = 0;
for (const [key, shard] of shards) {
  const body = JSON.stringify(shard);
  bytes += body.length;
  biggest = Math.max(biggest, body.length);
  writeFileSync(join(dir, placesShardFile(key)), body);
}
writeFileSync(join(dir, 'index.json'), JSON.stringify({ v: PLACES_INDEX_VERSION, built: new Date().toISOString(), shards: [...shards.keys()].sort() }));
console.log(`places search index: ${all.length} places, ${shards.size} shards, ${(bytes / 1e6).toFixed(1)} MB, biggest ${(biggest / 1e6).toFixed(2)} MB`);
