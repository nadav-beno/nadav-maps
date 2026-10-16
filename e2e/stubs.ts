import type { Page, Route } from '@playwright/test';
import { encodePolyline } from '../packages/core/src/polyline.ts';
import { sceneTile, TILEJSON } from './basemap-scene.ts';
import { PLACES_LISTING, PLACES_PMTILES, PLACES_RELEASE } from './places-scene.ts';
import { motisPlan, motisStoptimes } from './transit-fixture.ts';
import { flowTile, HERE_INCIDENTS, HERE_ROUTE, hereTrafficTile, incidentTile, INCIDENT_DETAILS, TRAFFIC_ROUTE } from './traffic-scene.ts';

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

export const BISTRO_TAGS = {
  name: 'ביסטרו הכרמל',
  'name:en': 'Bistro HaCarmel',
  amenity: 'restaurant',
  cuisine: 'mediterranean',
  description: 'ביסטרו ים-תיכוני קטן ליד שוק הכרמל',
  opening_hours: 'Mo-Su 12:00-23:30',
  takeaway: 'yes',
  delivery: 'no',
  outdoor_seating: 'yes',
  reservation: 'recommended',
  'reservation:website': 'https://bistro.example/book',
  'website:menu': 'https://bistro.example/menu',
  'diet:kosher': 'yes',
  'diet:vegetarian': 'yes',
  wheelchair: 'yes',
  'toilets:wheelchair': 'yes',
  internet_access: 'wlan',
  'internet_access:fee': 'no',
  smoking: 'no',
  dog: 'yes',
  'payment:cash': 'yes',
  'payment:credit_cards': 'yes',
  'payment:apple_pay': 'yes',
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
  await page.route('https://api.transitous.org/api/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/plan')) return r.fulfill({ json: motisPlan(), headers: { 'access-control-allow-origin': '*' } });
    if (path.endsWith('/stoptimes')) return r.fulfill({ json: motisStoptimes(), headers: { 'access-control-allow-origin': '*' } });
    return r.fulfill({ status: 404, body: '' });
  });
  // TomTom (only used when a test opens the app with ?tomtom=test). Requests without that key fail.
  await page.route('https://api.tomtom.com/**', (r) => {
    const url = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': '*' };
    if (url.searchParams.get('key') !== 'test') return r.fulfill({ status: 403, body: '', headers: cors });
    const tile = /^\/traffic\/map\/4\/tile\/(flow\/relative|incidents)\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
    if (tile) {
      const [z, x, y] = [+tile[2], +tile[3], +tile[4]];
      return r.fulfill({ body: tile[1] === 'incidents' ? incidentTile(z, x, y) : flowTile(z, x, y), contentType: 'application/x-protobuf', headers: cors });
    }
    if (url.pathname === '/traffic/services/5/incidentDetails') return r.fulfill({ json: INCIDENT_DETAILS, headers: cors });
    if (url.pathname.startsWith('/routing/1/calculateRoute/')) return r.fulfill({ json: TRAFFIC_ROUTE, headers: cors });
    return r.fulfill({ status: 404, body: '', headers: cors });
  });
  // HERE (only with ?here=test): traffic vector tiles, raster tiles (not used, answered empty),
  // Traffic API v7 incidents and Routing v8. Other keys fail like HERE does (401).
  await page.route(/^https:\/\/[a-z.]*hereapi\.com\//, (r) => {
    const url = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': '*' };
    if ((url.searchParams.get('apiKey') ?? url.searchParams.get('apikey')) !== 'test') return r.fulfill({ status: 401, body: '', headers: cors });
    const tile = /^\/v2\/traffictiles\/traffic\/mc\/(\d+)\/(\d+)\/(\d+)\/omv$/.exec(url.pathname);
    if (url.host === 'traffic.vector.hereapi.com' && tile) {
      return r.fulfill({ body: hereTrafficTile(+tile[1], +tile[2], +tile[3]), contentType: 'application/x-protobuf', headers: cors });
    }
    if (url.host === 'data.traffic.hereapi.com' && url.pathname === '/v7/incidents') return r.fulfill({ json: HERE_INCIDENTS, headers: cors });
    if (url.host === 'router.hereapi.com' && url.pathname === '/v8/routes') return r.fulfill({ json: HERE_ROUTE, headers: cors });
    if (url.host.endsWith('maps.hereapi.com')) return r.fulfill({ status: 204, body: '', headers: cors });
    return r.fulfill({ status: 404, body: '', headers: cors });
  });
  // ADS-B flight lookup: nothing in the air unless a test routes its own answer.
  await page.route('https://api.adsb.lol/**', (r) => r.fulfill({ json: { ac: [], total: 0 }, headers: { 'access-control-allow-origin': '*' } }));
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
    // The Overture bistro tapped on the map, matched to its OSM node (service options, attributes).
    if (body.includes('"name"="ביסטרו הכרמל"')) {
      return r.fulfill({ json: { elements: [{ type: 'node', id: 5005, lat: 32.0801, lon: 34.7792, tags: BISTRO_TAGS }] } });
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
