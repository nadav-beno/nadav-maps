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
