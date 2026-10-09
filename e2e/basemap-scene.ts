import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

/**
 * A small synthetic central Tel Aviv in the OpenMapTiles schema, cut into real vector
 * tiles on request. Lets tests and screenshots exercise our base map style offline.
 */
type Props = Record<string, string | number | boolean>;
type Geom = { type: 'Point'; coordinates: number[] } | { type: 'LineString'; coordinates: number[][] } | { type: 'Polygon'; coordinates: number[][][] };
const f = (geometry: Geom, properties: Props) => ({ type: 'Feature' as const, geometry, properties });
const pt = (lng: number, lat: number, p: Props) => f({ type: 'Point', coordinates: [lng, lat] }, p);
const line = (coords: number[][], p: Props) => f({ type: 'LineString', coordinates: coords }, p);
const box = (w: number, s: number, e: number, n: number, p: Props) =>
  f({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, p);

const W = 34.755, E = 34.81, S = 32.065, N = 32.1;
const COAST = 34.7685;

function buildings() {
  const out = [];
  let i = 0;
  for (let x = COAST + 0.002; x < E - 0.002; x += 0.0016) {
    for (let y = S + 0.001; y < N - 0.001; y += 0.0011) {
      i++;
      if (Math.abs(x - 34.7815) < 0.0008 || Math.abs(x - 34.792) < 0.0016) continue; // streets / highway
      if (x > 34.783 && x < 34.79 && y > 32.088 && y < 32.095) continue; // park
      const h = i % 9 === 0 ? 80 : 8 + (i % 5) * 6;
      out.push(box(x, y, x + 0.0011, y + 0.0007, { render_height: h, render_min_height: 0 }));
    }
  }
  return out;
}

const LAYERS: Record<string, ReturnType<typeof f>[]> = {
  water: [box(W - 0.05, S - 0.05, COAST, N + 0.05, { class: 'ocean' }), box(34.7845, 32.0965, 34.8, 32.0985, { class: 'river' })],
  landuse: [
    box(COAST, S, E, N, { class: 'residential' }),
    box(34.7935, 32.067, 34.805, 32.078, { class: 'commercial' }),
    box(34.7955, 32.0805, 34.8005, 32.0845, { class: 'hospital' }),
    box(34.775, 32.069, 34.779, 32.072, { class: 'school' }),
  ],
  landcover: [box(34.783, 32.088, 34.79, 32.095, { class: 'grass', subclass: 'park' }), box(COAST, 32.074, COAST + 0.0015, 32.09, { class: 'sand' })],
  building: buildings(),
  transportation: [
    line([[34.792, S - 0.01], [34.792, N + 0.01]], { class: 'motorway', oneway: 1 }),
    line([[34.7905, S - 0.01], [34.7905, N + 0.01]], { class: 'rail' }),
    line([[34.7815, S - 0.01], [34.7815, N + 0.01]], { class: 'primary' }),
    line([[34.772, S], [34.776, 32.083], [34.7765, N]], { class: 'secondary' }),
    line([[COAST + 0.0005, S], [COAST + 0.0005, N]], { class: 'tertiary' }),
    line([[W, 32.0745], [E + 0.01, 32.0745]], { class: 'secondary' }),
    line([[34.7905, 32.0745], [34.7935, 32.0745]], { class: 'secondary', brunnel: 'bridge' }),
    ...[32.07, 32.078, 32.082, 32.086, 32.09, 32.096].map((y) => line([[COAST, y], [E, y]], { class: 'minor', oneway: y === 32.082 ? 1 : 0 })),
    ...[34.775, 34.786, 34.799, 34.804].map((x) => line([[x, S], [x, N]], { class: 'minor' })),
    line([[34.7835, 32.0885], [34.7895, 32.0945]], { class: 'path' }),
  ],
  transportation_name: [
    line([[34.792, S], [34.792, N]], { class: 'motorway', name: 'נתיבי איילון', 'name:he': 'נתיבי איילון', ref: '20', ref_length: 2 }),
    line([[34.7815, S], [34.7815, N]], { class: 'primary', name: 'אבן גבירול', 'name:he': 'אבן גבירול' }),
    line([[W, 32.0745], [E, 32.0745]], { class: 'secondary', name: 'קפלן', 'name:he': 'קפלן' }),
    line([[COAST, 32.082], [E, 32.082]], { class: 'minor', name: 'פרישמן', 'name:he': 'פרישמן' }),
  ],
  poi: [
    pt(34.7745, 32.0805, { class: 'cafe', subclass: 'cafe', name: 'קפה לנדוור', 'name:he': 'קפה לנדוור', rank: 1 }),
    pt(34.7785, 32.0765, { class: 'restaurant', subclass: 'restaurant', name: 'מסעדת הים', rank: 2 }),
    pt(34.7865, 32.0805, { class: 'shop', subclass: 'supermarket', name: 'שופרסל', rank: 3 }),
    pt(34.7985, 32.0825, { class: 'hospital', subclass: 'hospital', name: 'איכילוב', rank: 1 }),
    pt(34.7835, 32.0775, { class: 'pharmacy', subclass: 'pharmacy', name: 'סופר-פארם', rank: 4 }),
    pt(34.7705, 32.0785, { class: 'lodging', subclass: 'hotel', name: 'מלון חוף', rank: 3 }),
    pt(34.7865, 32.0915, { class: 'park', subclass: 'park', name: 'גן העיר', rank: 2 }),
    pt(34.7775, 32.0705, { class: 'school', subclass: 'school', name: 'תיכון עירוני', rank: 5 }),
    pt(34.7995, 32.0725, { class: 'museum', subclass: 'museum', name: 'מוזיאון תל אביב', rank: 1 }),
    pt(34.7905, 32.0835, { class: 'railway', subclass: 'station', name: 'תחנת השלום', rank: 1 }),
    pt(34.7755, 32.0865, { class: 'place_of_worship', subclass: 'jewish', name: 'בית כנסת', rank: 6 }),
    pt(34.8025, 32.0775, { class: 'bank', subclass: 'bank', name: 'בנק', rank: 6 }),
    pt(34.7735, 32.0745, { class: 'fuel', subclass: 'fuel', name: 'דלק', rank: 6 }),
    pt(34.7945, 32.0895, { class: 'clothing_store', subclass: 'clothes', name: 'אופנה', rank: 7 }),
    pt(34.8035, 32.0935, { class: 'bar', subclass: 'pub', name: 'פאב', rank: 7 }),
  ],
  place: [
    pt(34.7818, 32.0853, { class: 'city', name: 'תל אביב-יפו', 'name:he': 'תל אביב-יפו', rank: 1 }),
    pt(34.777, 32.072, { class: 'suburb', name: 'לב העיר', rank: 10 }),
    pt(34.798, 32.093, { class: 'neighbourhood', name: 'בבלי', rank: 12 }),
  ],
  water_name: [pt(34.758, 32.082, { class: 'sea', name: 'הים התיכון', 'name:he': 'הים התיכון' })],
};

const indexes = Object.fromEntries(
  Object.entries(LAYERS).map(([layer, features]) => [
    layer,
    new geojsonvt({ type: 'FeatureCollection', features } as never, { maxZoom: 14, indexMaxZoom: 5, extent: 4096, buffer: 64 }),
  ]),
);

export function sceneTile(z: number, x: number, y: number): Buffer {
  const layers: Record<string, unknown> = {};
  for (const [name, index] of Object.entries(indexes)) {
    const tile = index.getTile(z, x, y);
    if (tile) layers[name] = tile;
  }
  return Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2 }));
}

export const TILEJSON = {
  tilejson: '3.0.0',
  tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 14,
  vector_layers: Object.keys(LAYERS).map((id) => ({ id, fields: {} })),
};
