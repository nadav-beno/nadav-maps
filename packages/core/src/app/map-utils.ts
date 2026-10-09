import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

type GeoJSON = Parameters<GeoJSONSource['setData']>[0];
export const EMPTY: GeoJSON = { type: 'FeatureCollection', features: [] };

/** Add a GeoJSON source if missing, or update its data. Safe to call repeatedly. */
export function setGeoJSON(map: MapLibreMap, id: string, data: GeoJSON, options: Record<string, unknown> = {}): void {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: 'geojson', data, ...options });
}

/** Add a layer if missing. `before` defaults to the first symbol layer so labels stay on top. */
export function ensureLayer(map: MapLibreMap, layer: Parameters<MapLibreMap['addLayer']>[0], before?: string | null): void {
  if (map.getLayer(layer.id)) return;
  const beforeId = before === null ? undefined : (before ?? firstSymbolLayer(map));
  map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
}

export function firstSymbolLayer(map: MapLibreMap): string | undefined {
  return map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
}

/** CSS custom property value, so map layers follow the app theme. */
export function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
