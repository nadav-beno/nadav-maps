#!/usr/bin/env node
// Builds the offline world map that ships with the app (apps/web/public/offline/world-1.json):
// country shapes and borders (Natural Earth 1:50m via world-atlas), big cities (GeoNames via
// all-the-cities), major airports (OurAirports via airports-json), Hebrew names
// (i18n-iso-countries for countries, ./he-cities.mjs for cities).
//
//   pnpm --filter @nm/feature-flight gen-world
//
// Format (decoded by packages/core/src/world.ts): coordinates are integers on a 1/100 degree
// grid; each arc is delta encoded [x0, y0, dx1, dy1, ...]. A ring is a list of arc indices,
// ~i meaning arc i reversed (TopoJSON's convention). Bump the file name when the format changes.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HE_CITIES } from './he-cities.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../../../../apps/web/public/offline/world-1.json');

const topo = require('world-atlas/countries-50m.json');
const cities = require('all-the-cities');
const airports = require('airports-json/data/airports.json');
const codes = require('i18n-iso-countries/codes.json');
const he = require('i18n-iso-countries/langs/he.json').countries;
/** Natural Earth units with no ISO code. */
const HE_EXTRA = { Somaliland: 'סומלילנד', Kosovo: 'קוסובו', 'N. Cyprus': 'צפון קפריסין', 'Siachen Glacier': 'קרחון סיאצ׳ן' };

const Q = 100; // grid cells per degree
const TOL = 0.006; // simplification tolerance, degrees (about half a pixel at zoom 6)

// --- decode the TopoJSON arcs to degrees ---
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;
const rawArcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty];
  });
});

// --- Douglas-Peucker per arc: shared arcs stay shared, so borders still meet ---
function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bestD = 0;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > tol) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const arcs = rawArcs.map((arc) => {
  const q = dp(arc, TOL).map(([x, y]) => [Math.round(x * Q), Math.round(y * Q)]);
  const out = [q[0]];
  for (const p of q.slice(1)) if (p[0] !== out[out.length - 1][0] || p[1] !== out[out.length - 1][1]) out.push(p);
  if (out.length === 1) out.push(out[0]);
  return out;
});

// How many countries use each arc: 2 = a land border, 1 = coast.
const uses = new Array(arcs.length).fill(0);
const arcIndex = (i) => (i < 0 ? ~i : i);

const numericToAlpha2 = new Map(codes.map(([a2, , num]) => [num, a2]));
const ringCoords = (ring) => {
  const out = [];
  for (const i of ring) {
    const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
    out.push(...(out.length ? a.slice(1) : a));
  }
  return out;
};
const ringArea = (r) => {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return s / 2;
};
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function edgeDist([x, y], ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
/** A label point well inside the ring: coarse grid search, then a finer one around the best cell. */
function labelPoint(ring) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) [w, s, e, n] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)];
  let best = [(w + e) / 2, (s + n) / 2], bestD = -1;
  for (let pass = 0; pass < 3; pass++) {
    const N = 24;
    const [cw, cs, ce, cn] = pass === 0 ? [w, s, e, n] : [best[0] - (e - w) / 2 ** (pass + 2), best[1] - (n - s) / 2 ** (pass + 2), best[0] + (e - w) / 2 ** (pass + 2), best[1] + (n - s) / 2 ** (pass + 2)];
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const p = [cw + ((ce - cw) * i) / N, cs + ((cn - cs) * j) / N];
        if (!inside(p, ring)) continue;
        const d = edgeDist(p, ring);
        if (d > bestD) [best, bestD] = [p, d];
      }
  }
  return best;
}

const countries = [];
for (const g of topo.objects.countries.geometries) {
  if (!g.arcs) continue;
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  const kept = [];
  let biggest = null, biggestArea = 0, total = 0;
  for (const poly of polys) {
    const outer = ringCoords(poly[0]);
    const area = Math.abs(ringArea(outer));
    if (outer.length < 4 || area < 2) continue; // tiny islands vanish at this scale
    kept.push(poly);
    total += area;
    if (area > biggestArea) [biggest, biggestArea] = [outer, area];
  }
  if (!kept.length) continue;
  for (const poly of kept) for (const ring of poly) for (const i of ring) uses[arcIndex(i)]++;
  const a2 = numericToAlpha2.get(g.id) ?? '';
  const name = g.properties?.name ?? '';
  const [lx, ly] = labelPoint(biggest);
  countries.push({
    n: name,
    he: (a2 && (Array.isArray(he[a2]) ? he[a2][0] : he[a2])) || HE_EXTRA[name] || '',
    c: a2,
    l: [Math.round(lx) / Q, Math.round(ly) / Q],
    // Area in square degrees, for label size and priority.
    a: Math.round(total / (Q * Q)),
    p: kept,
  });
}
countries.sort((a, b) => b.a - a.a);

// Keep only arcs some country uses, renumbered.
const used = arcs.map((_, i) => uses[i] > 0);
const remap = new Map();
const outArcs = [];
arcs.forEach((a, i) => {
  if (!used[i]) return;
  remap.set(i, outArcs.length);
  const flat = [a[0][0], a[0][1]];
  for (let k = 1; k < a.length; k++) flat.push(a[k][0] - a[k - 1][0], a[k][1] - a[k - 1][1]);
  outArcs.push(flat);
});
for (const c of countries) c.p = c.p.map((poly) => poly.map((ring) => ring.map((i) => (i < 0 ? ~remap.get(~i) : remap.get(i)))));
const borders = [...remap.entries()].filter(([i]) => uses[i] >= 2).map(([, j]) => j);

// --- cities: capitals, everything over 500k, regional capitals over 150k ---
const R = 6371;
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const picked = cities
  .filter((c) => /^PPL(A\d?|C|G)?$/.test(c.featureCode))
  .filter((c) => c.featureCode === 'PPLC' || c.population >= 500000 || (c.featureCode === 'PPLA' && c.population >= 150000))
  .sort((a, b) => (b.featureCode === 'PPLC') - (a.featureCode === 'PPLC') || b.population - a.population);
const outCities = [];
const unusedHe = new Set(Object.keys(HE_CITIES));
for (const c of picked) {
  const p = c.loc.coordinates;
  // Boroughs and districts of a bigger city (Brooklyn, Queens) are not cities of their own here.
  if (c.featureCode !== 'PPLC' && outCities.some((o) => km([o[2], o[3]], p) < 25)) continue;
  const key = `${c.name}|${c.country}`;
  unusedHe.delete(key);
  outCities.push([c.name, HE_CITIES[key] ?? '', Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round(c.population / 1000), c.featureCode === 'PPLC' ? 1 : 0, c.country]);
}
outCities.sort((a, b) => b[5] - a[5] || b[4] - a[4]);

// --- airports: large ones with scheduled flights ---
const outAirports = airports
  .filter((a) => a.type === 'large_airport' && a.iata_code && a.scheduled_service === 'yes')
  .map((a) => [a.iata_code, a.name, a.municipality, a.iso_country, Math.round(+a.longitude_deg * 1000) / 1000, Math.round(+a.latitude_deg * 1000) / 1000])
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));

const data = {
  v: 1,
  q: Q,
  attribution: 'Natural Earth (public domain) via world-atlas; GeoNames (CC BY 4.0); OurAirports (public domain)',
  arcs: outArcs,
  borders,
  countries,
  cities: outCities,
  airports: outAirports,
};
mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(data);
writeFileSync(OUT, json);
const { gzipSync } = await import('node:zlib');
console.log(
  `${OUT}: ${(json.length / 1024).toFixed(0)} KB, ${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped;`,
  `${countries.length} countries, ${outArcs.length} arcs (${borders.length} borders), ${outCities.length} cities (${outCities.filter((c) => c[1]).length} in Hebrew), ${outAirports.length} airports`,
);
if (process.argv.includes('--list')) for (const c of outCities.slice(0, 400)) if (!c[1]) console.log(`  '${c[0]}|${c[6]}': '',`);
if (unusedHe.size) console.warn('Hebrew names with no matching city:', [...unusedHe].join(', '));
