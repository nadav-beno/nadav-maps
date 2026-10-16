// Prints a quality summary of built geodata: counts, sizes and how a few real queries resolve.
//   node --experimental-strip-types scripts/geodata/probe.ts <out dir>/<region> [query...]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { indexTokens, keyTokens, rankRecords, queryInfo, searchKey, shardFile, shardPrefix } from '../../packages/core/src/geoindex.ts';
import type { GeoManifest, NameEntry, SearchRecord } from '../../packages/core/src/geoindex.ts';

const [dir, ...rest] = process.argv.slice(2);
if (!dir) throw new Error('usage: probe.ts <region dir> [query...]');
const queries = rest.length ? rest : ['דיזנגוף', 'עזריאלי', 'הכותל המערבי', 'רוטשילד 22 תל אביב', 'באר שבע', 'קניון רמת אביב', 'Haifa'];

const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as GeoManifest;
console.log('source', m.source, 'built', m.built);
console.log('counts', JSON.stringify(m.counts));
for (const sub of ['s', 'a', 'd', 'r']) {
  const files = readdirSync(join(dir, sub));
  const sizes = files.map((f) => statSync(join(dir, sub, f)).size);
  console.log(`${sub}/: ${files.length} files, ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB, largest ${(Math.max(...sizes) / 1e3).toFixed(0)} KB`);
}
const names = JSON.parse(readFileSync(join(dir, 'names.json'), 'utf8')) as NameEntry[];
console.log(`names.json: ${names.length} names, ${(statSync(join(dir, 'names.json')).size / 1e6).toFixed(1)} MB; top: ${names.slice(0, 15).map((x) => x.n).join(', ')}`);

const split = new Set(m.split);
for (const q of queries) {
  const info = queryInfo(q);
  const tokens = keyTokens(searchKey(q)).filter((t) => t.length >= 2 && !/^\d/.test(t));
  const recs = new Map<string, SearchRecord>();
  for (const t of tokens) {
    const p = shardPrefix(t, split);
    if (!m.shards.includes(p)) continue;
    const shard = JSON.parse(readFileSync(join(dir, shardFile(p)), 'utf8')) as Record<string, SearchRecord[]> | SearchRecord[];
    const list = Array.isArray(shard) ? shard : Object.values(shard).flat();
    for (const r of list) if (indexTokens([r.n, r.he, r.en, r.ar]).some((x) => x.startsWith(t))) recs.set(`${r.i ?? r.n}|${r.c}`, r);
  }
  const ranked = rankRecords([...recs.values()], info, {}).slice(0, 3);
  console.log(`"${q}" -> ${ranked.map((s) => `${s.rec.n} (${s.rec.k}${s.rec.c ? ', ' + s.rec.c : ''})`).join(' | ') || 'nothing'}`);
}
