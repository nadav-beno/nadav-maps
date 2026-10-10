import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { effect } from '@preact/signals';
import { worldGeoJSON } from '@nm/core';
import { basemapOffline, loadWorld, offlineMapOnly } from '@nm/core/app';
import { DARK, FONT, LIGHT } from './style.ts';

/**
 * The bundled world map (countries, borders, big cities) drawn from apps/web/public/offline/,
 * which the service worker keeps. It sits right above the background, so when the vector
 * tiles can't load (on a plane, no network) the map still shows where you are. Flight mode can
 * show it instead of the normal map (`offlineMapOnly`).
 */
export const WORLD_SOURCE = 'world';
const kind = (k: string): ExpressionSpecification => ['==', ['get', 'kind'], k];
const lin = (...stops: number[]) => ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as ExpressionSpecification;

/** Ground layers (under the vector map) and label layers (on top). */
export function offlineLayers(theme: 'light' | 'dark', visible: boolean): { ground: LayerSpecification[]; labels: LayerSpecification[] } {
  const c = theme === 'dark' ? DARK : LIGHT;
  const layout = { visibility: visible ? ('visible' as const) : ('none' as const) };
  const halo = { 'text-halo-color': c.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.3 };
  return {
    ground: [
      { id: 'world-ocean', type: 'background', layout, paint: { 'background-color': c.water } },
      { id: 'world-land', type: 'fill', source: WORLD_SOURCE, filter: kind('land'), layout, paint: { 'fill-color': c.land } },
      {
        id: 'world-coast',
        type: 'line',
        source: WORLD_SOURCE,
        filter: kind('land'),
        layout: { ...layout, 'line-join': 'round' },
        paint: { 'line-color': c.waterLabel, 'line-opacity': 0.3, 'line-width': lin(1, 0.4, 7, 1) },
      },
      {
        id: 'world-border',
        type: 'line',
        source: WORLD_SOURCE,
        filter: kind('border'),
        layout: { ...layout, 'line-join': 'round' },
        paint: { 'line-color': c.boundary, 'line-width': lin(1, 0.6, 6, 1.3, 10, 2) },
      },
    ],
    labels: [
      {
        id: 'world-city-dot',
        type: 'circle',
        source: WORLD_SOURCE,
        minzoom: 3,
        filter: kind('city'),
        layout: { ...layout, 'circle-sort-key': ['get', 'rank'] },
        paint: {
          'circle-radius': ['case', ['get', 'capital'], 3.2, 2.4],
          'circle-color': c.labelMuted,
          'circle-stroke-color': c.halo,
          'circle-stroke-width': 1,
        },
      },
      {
        id: 'world-city-label',
        type: 'symbol',
        source: WORLD_SOURCE,
        minzoom: 3,
        filter: kind('city'),
        layout: {
          ...layout,
          'text-field': ['get', 'name'],
          'text-font': FONT.regular,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['case', ['get', 'capital'], 11, 10], 8, ['case', ['get', 'capital'], 15, 13]],
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.5,
          'text-max-width': 8,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': c.label, ...halo },
      },
      {
        id: 'world-country-label',
        type: 'symbol',
        source: WORLD_SOURCE,
        maxzoom: 8,
        filter: kind('country'),
        layout: {
          ...layout,
          'text-field': ['get', 'name'],
          'text-font': FONT.bold,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['step', ['get', 'area'], 9, 30, 10, 300, 12], 6, ['step', ['get', 'area'], 12, 30, 14, 300, 17]],
          'text-max-width': 7,
          'text-letter-spacing': 0.04,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': c.labelMuted, ...halo, 'text-halo-width': 2 },
      },
    ],
  };
}

const ALL_IDS = offlineLayers('light', false);
const GROUND_IDS = ALL_IDS.ground.map((l) => l.id);
const LABEL_IDS = ALL_IDS.labels.map((l) => l.id);

/**
 * Adds the world layers on every style load and keeps their visibility in step with
 * `basemapOffline` / `offlineMapOnly`. Returns the hook to run on 'style.load'.
 */
export function setupOfflineWorld(map: MapLibreMap, theme: () => 'light' | 'dark'): (m: MapLibreMap) => void {
  let data: ReturnType<typeof worldGeoJSON> | null = null;
  let loading = false;
  /** The base style's own layers (vector map, relief, satellite), hidden in "world only" mode. */
  let baseIds: string[] = [];

  const active = () => basemapOffline.value || offlineMapOnly.value;

  const fill = () => {
    const src = map.getSource(WORLD_SOURCE) as GeoJSONSource | undefined;
    if (src && data) src.setData(data as never);
  };

  const apply = () => {
    if (!map.getLayer('world-ocean')) return;
    const on = active();
    for (const id of [...GROUND_IDS, ...LABEL_IDS]) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    const only = offlineMapOnly.value;
    for (const id of baseIds) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', only ? 'none' : 'visible');
    if (on && !data && !loading) {
      loading = true;
      loadWorld()
        .then((w) => {
          data = worldGeoJSON(w, 'he');
          fill();
        })
        .catch(() => {})
        .finally(() => (loading = false));
    }
  };

  effect(() => {
    void basemapOffline.value;
    void offlineMapOnly.value;
    apply();
  });

  return (m) => {
    const style = m.getStyle();
    baseIds = (style?.layers ?? []).map((l) => l.id).filter((id) => id !== 'background' && !id.startsWith('world-'));
    const { ground, labels } = offlineLayers(theme(), active());
    if (!m.getSource(WORLD_SOURCE)) m.addSource(WORLD_SOURCE, { type: 'geojson', data: (data ?? { type: 'FeatureCollection', features: [] }) as never, attribution: 'Natural Earth, GeoNames' });
    // Right above the background, under everything the vector tiles draw.
    const second = style?.layers?.[1]?.id;
    for (const l of ground) if (!m.getLayer(l.id)) m.addLayer(l, second);
    for (const l of labels) if (!m.getLayer(l.id)) m.addLayer(l);
    apply();
  };
}
