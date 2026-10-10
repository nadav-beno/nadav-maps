import type { Page, Route } from '@playwright/test';
import { encodePolyline } from '../packages/core/src/polyline.ts';
import { sceneTile, TILEJSON } from './basemap-scene.ts';
import { PLACES_LISTING, PLACES_PMTILES, PLACES_RELEASE } from './places-scene.ts';

/**
 * Tests never hit the real map servers: tiles, search, routing and place details
 * are answered from these fixtures, so results are deterministic and offline.
 */
export const PLACES = {
  dizengoff: {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [34.7741, 32.0787] },
    properties: { osm_type: 'W', osm_id: 1001, osm_key: 'highway', osm_value: 'primary', name: 'דיזנגוף', city: 'תל אביב-יפו', country: 'ישראל', countrycode: 'IL' },
  },
  azrieli: {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [34.7918, 32.0745] },
    properties: { osm_type: 'N', osm_id: 2002, osm_key: 'shop', osm_value: 'mall', name: 'קניון עזריאלי', street: 'דרך מנחם בגין', housenumber: '132', city: 'תל אביב-יפו', country: 'ישראל', countrycode: 'IL' },
  },
  jerusalem: {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [35.2137, 31.7683] },
    properties: { osm_type: 'R', osm_id: 3003, osm_key: 'place', osm_value: 'city', name: 'ירושלים', country: 'ישראל', countrycode: 'IL', extent: [35.1, 31.88, 35.3, 31.7] },
  },
};

export const ROUTE_LINE: [number, number][] = [
  [34.7741, 32.0787],
  [34.7790, 32.0780],
  [34.7850, 32.0765],
  [34.7918, 32.0745],
];

function valhallaTrip(line: [number, number][], seconds: number) {
  return {
    legs: [
      {
        shape: encodePolyline(line, 6),
        maneuvers: [
          { type: 1, street_names: ['דיזנגוף'], length: 0.45, time: 60, begin_shape_index: 0 },
          { type: 10, street_names: ['דרך מנחם בגין'], length: 1.1, time: 180, begin_shape_index: 2 },
          { type: 4, length: 0, time: 0, begin_shape_index: line.length - 1 },
        ],
      },
    ],
    summary: { length: 1.55, time: seconds },
  };
}

export async function stubNetwork(page: Page): Promise<void> {
  // Anything else external fails fast. (Registered first: later routes take priority.)
  await page.route(/^https:\/\/(?!localhost)/, (r) => r.abort());
  await page.route('https://tiles.openfreemap.org/**', (r: Route) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/planet') return r.fulfill({ json: TILEJSON });
    const m = /^\/planet\/test\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
    if (m) return r.fulfill({ body: sceneTile(+m[1], +m[2], +m[3]), contentType: 'application/x-protobuf' });
    return r.fulfill({ status: 404, body: '' });
  });
  // Overture places: the bucket listing, then HTTP range reads of the newest release's archive.
  await page.route('https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/**', (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.get('list-type') === '2') return r.fulfill({ body: PLACES_LISTING, contentType: 'application/xml' });
    if (url.pathname !== `/tiles/${PLACES_RELEASE}/places.pmtiles`) return r.fulfill({ status: 404, body: '' });
    const m = /bytes=(\d+)-(\d+)/.exec(r.request().headers()['range'] ?? '');
    const start = m ? +m[1] : 0;
    const end = Math.min(m ? +m[2] : PLACES_PMTILES.length - 1, PLACES_PMTILES.length - 1);
    return r.fulfill({
      status: 206,
      body: PLACES_PMTILES.subarray(start, end + 1),
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${start}-${end}/${PLACES_PMTILES.length}`,
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'ETag, Content-Length, Content-Range',
        etag: '"fixture"',
      },
    });
  });
  await page.route('https://photon.komoot.io/api**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('q') ?? '';
    const features = q.includes('עזריאלי')
      ? [PLACES.azrieli]
      : q.includes('ירושלים')
        ? [PLACES.jerusalem]
        : q.includes('דיזנגוף')
          ? [PLACES.dizengoff]
          : q.includes('קפה')
            ? [PLACES.azrieli, PLACES.dizengoff]
            : [];
    return r.fulfill({ json: { type: 'FeatureCollection', features } });
  });
  await page.route('https://photon.komoot.io/reverse**', (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [PLACES.dizengoff] } }));
  await page.route('https://valhalla1.openstreetmap.de/route', (r) =>
    r.fulfill({ json: { trip: valhallaTrip(ROUTE_LINE, 240), alternates: [{ trip: valhallaTrip([ROUTE_LINE[0], [34.78, 32.083], ROUTE_LINE[3]], 330) }] } }),
  );
  await page.route('https://overpass-api.de/api/interpreter', (r) => {
    const body = decodeURIComponent(r.request().postData() ?? '');
    if (body.includes('2002')) {
      return r.fulfill({
        json: {
          elements: [
            {
              type: 'node',
              id: 2002,
              lat: 32.0745,
              lon: 34.7918,
              tags: { name: 'קניון עזריאלי', shop: 'mall', opening_hours: 'Su-Th 09:30-22:00; Fr 09:00-15:00; Sa 20:00-23:00', phone: '+972 3 608 1179', website: 'https://www.azrieli.com', wheelchair: 'yes' },
            },
          ],
        },
      });
    }
    if (body.includes('"amenity"="cafe"')) {
      return r.fulfill({
        json: {
          elements: [
            { type: 'node', id: 4004, lat: 32.0805, lon: 34.7745, tags: { name: 'קפה לנדוור', amenity: 'cafe' } },
            { type: 'node', id: 4005, lat: 32.0812, lon: 34.7802, tags: { name: 'קפה תמיד', amenity: 'cafe', opening_hours: '24/7' } },
            { type: 'node', id: 4006, lat: 32.0791, lon: 34.7768, tags: { name: 'קפה אף פעם', amenity: 'cafe', opening_hours: 'off' } },
          ],
        },
      });
    }
    return r.fulfill({ json: { elements: [] } });
  });
}
