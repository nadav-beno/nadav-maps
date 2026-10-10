import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

/**
 * Fake TomTom traffic for the synthetic Tel Aviv in basemap-scene.ts: a jam on the Ayalon
 * (the motorway at lng 34.792), free flow on Ibn Gabirol, and one accident. Never the real API.
 */
type Props = Record<string, string | number | boolean>;
const line = (coords: number[][], properties: Props) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties });
const point = (lng: number, lat: number, properties: Props) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] }, properties });

export const ACCIDENT_AT: [number, number] = [34.792, 32.08];

const FLOW = [
  line([[34.792, 32.06], [34.792, 32.075]], { road_type: 'Motorway', traffic_level: 0.9, traffic_road_coverage: 'one_side' }),
  line([[34.792, 32.075], [34.792, 32.105]], { road_type: 'Motorway', traffic_level: 0.15, traffic_road_coverage: 'one_side' }),
  line([[34.7815, 32.06], [34.7815, 32.105]], { road_type: 'Major road', traffic_level: 0.6, traffic_road_coverage: 'full' }),
];
const INCIDENT_POI = [point(ACCIDENT_AT[0], ACCIDENT_AT[1], { icon_category: 1, description: 'תאונה בנתיב השמאלי', delay: 420, magnitude: 3, clustered: false })];

const flowIndex = new geojsonvt({ type: 'FeatureCollection', features: FLOW } as never, { maxZoom: 18, indexMaxZoom: 5, extent: 4096, buffer: 64 });
const poiIndex = new geojsonvt({ type: 'FeatureCollection', features: INCIDENT_POI } as never, { maxZoom: 18, indexMaxZoom: 5, extent: 4096, buffer: 64 });

export function flowTile(z: number, x: number, y: number): Buffer {
  const t = flowIndex.getTile(z, x, y);
  return Buffer.from(vtpbf.fromGeojsonVt(t ? { 'Traffic flow': t } : {}, { version: 2 }));
}

export function incidentTile(z: number, x: number, y: number): Buffer {
  const t = poiIndex.getTile(z, x, y);
  return Buffer.from(vtpbf.fromGeojsonVt(t ? { 'Traffic incidents POI': t } : {}, { version: 2 }));
}

/** Incident Details v5, as we request it. */
export const INCIDENT_DETAILS = {
  incidents: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [ACCIDENT_AT, [34.792, 32.083]] },
      properties: {
        id: 'e2e-accident',
        iconCategory: 1,
        magnitudeOfDelay: 3,
        events: [{ description: 'תאונה בנתיב השמאלי', code: 201, iconCategory: 1 }],
        startTime: '2026-10-10T05:10:00Z',
        endTime: '2026-10-10T08:30:00Z',
        from: 'מחלף השלום',
        to: 'מחלף ארלוזורוב',
        length: 820,
        delay: 420,
        roadNumbers: ['20'],
      },
    },
  ],
};

/** Calculate Route summary: Valhalla says 4 minutes, live traffic makes it 7. */
export const TRAFFIC_ROUTE = {
  routes: [{ summary: { lengthInMeters: 1550, travelTimeInSeconds: 420, trafficDelayInSeconds: 180, noTrafficTravelTimeInSeconds: 240 } }],
};

/**
 * Fake HERE traffic for the same scene: one vector tile source with traffic_flow,
 * traffic_incidents and incident_icons (HERE Traffic Vector Tile API v2 layer names and fields).
 */
export const HERE_ACCIDENT_AT: [number, number] = [34.792, 32.088];

const HERE_FLOW = [
  line([[34.792, 32.06], [34.792, 32.08]], { kind: 'free', congestion: 0.05, drives_on_left: false, sort_rank: 2 }),
  line([[34.792, 32.08], [34.792, 32.105]], { kind: 'queuing', congestion: 0.8, drives_on_left: false, sort_rank: 2 }),
  line([[34.7815, 32.06], [34.7815, 32.105]], { kind: 'slow', congestion: 0.5, drives_on_left: false, sort_rank: 1 }),
];
const HERE_INCIDENT_LINES = [line([[34.792, 32.088], [34.792, 32.092]], { kind: 'accident', warning_level: 'critical', road_closed: false, start_time: 1791609000 })];
const HERE_ICONS = [
  point(HERE_ACCIDENT_AT[0], HERE_ACCIDENT_AT[1], { kind: 'accident', warning_level: 'critical', road_closed: false, is_primary: true }),
  // The start of the affected stretch: not drawn (one icon per incident).
  point(34.792, 32.092, { kind: 'accident', warning_level: 'critical', road_closed: false, is_primary: false }),
];

const opts = { maxZoom: 17, indexMaxZoom: 5, extent: 4096, buffer: 64 };
const hereIdx = {
  traffic_flow: new geojsonvt({ type: 'FeatureCollection', features: HERE_FLOW } as never, opts),
  traffic_incidents: new geojsonvt({ type: 'FeatureCollection', features: HERE_INCIDENT_LINES } as never, opts),
  incident_icons: new geojsonvt({ type: 'FeatureCollection', features: HERE_ICONS } as never, opts),
};

export function hereTrafficTile(z: number, x: number, y: number): Buffer {
  const layers: Record<string, unknown> = {};
  for (const [name, idx] of Object.entries(hereIdx)) {
    const t = idx.getTile(z, x, y);
    if (t) layers[name] = t;
  }
  return Buffer.from(vtpbf.fromGeojsonVt(layers as never, { version: 2 }));
}

/** Traffic API v7 /incidents with shapes. */
export const HERE_INCIDENTS = {
  sourceUpdated: '2026-10-10T07:00:00Z',
  results: [
    {
      location: { length: 450, shape: { links: [{ points: [{ lat: 32.088, lng: 34.792 }, { lat: 32.092, lng: 34.792 }], length: 450, functionalClass: 1 }] } },
      incidentDetails: {
        id: 'e2e-here-accident',
        originalId: 'e2e-here-accident',
        type: 'accident',
        criticality: 'critical',
        roadClosed: false,
        startTime: '2026-10-10T05:10:00Z',
        endTime: '2026-10-10T08:30:00Z',
        description: { value: 'תאונה בין מחלף ארלוזורוב למחלף רוקח', language: 'he' },
        descriptionParts: { proximityType: 'between', roadName: '20', intersectingRoadName: 'מחלף ארלוזורוב', endIntersectingRoadName: 'מחלף רוקח' },
      },
    },
  ],
};

/** Routing v8: Valhalla says 4 minutes, live traffic makes it 9. */
export const HERE_ROUTE = {
  routes: [{ id: 'r', sections: [{ id: 's', type: 'vehicle', summary: { duration: 540, length: 1550, baseDuration: 250, typicalDuration: 360 } }] }],
};
