import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { effect } from '@preact/signals';
import { regionAt, type ProviderConfig, type UrlState } from '@nm/core';
import mlcontour from 'maplibre-contour';
import { isDark, mapLayers, mapType, region, toast } from '@nm/core/app';
import { dispatchClick, dispatchLongPress, runStyleHooks } from './registry.ts';
import { addBasemapImages, addMissingImage } from './basemap/images.ts';
import { buildStyle } from './basemap/style.ts';
import { placesSourceUrl } from './basemap/places-source.ts';

// MapLibre 6 ships its web worker as a separate file; let Vite serve it.
maplibregl.setWorkerUrl(workerUrl);

/** Contour lines for the terrain map type, computed in the browser from the elevation tiles. */
function contourTiles(terrain: string): string {
  if (!terrain) return '';
  const dem = new mlcontour.DemSource({ url: terrain, encoding: 'terrarium', maxzoom: 13, worker: true });
  dem.setupMaplibre(maplibregl as never);
  return dem.contourProtocolUrl({
    thresholds: { 10: [100, 500], 12: [50, 250], 13: [20, 100], 15: [10, 50] },
    contourLayer: 'contours',
    elevationKey: 'ele',
    levelKey: 'level',
  });
}

export function createMap(container: HTMLElement, cfg: ProviderConfig, initial: UrlState): maplibregl.Map {
  const r = initial.view ? regionAt(initial.view.center) : region.value;
  const theme = () => (isDark.value ? 'dark' : 'light');
  const contours = contourTiles(cfg.terrain);
  const sources = { ...cfg, places: placesSourceUrl(cfg.places), contours };
  const style = () => {
    const l = mapLayers.value;
    return buildStyle(theme(), sources, 'he', { mapType: mapType.value, buildings3d: l.buildings3d, transit: l.transit, bike: l.bike });
  };
  const map = new maplibregl.Map({
    container,
    style: style(),
    center: initial.view?.center ?? r.center,
    zoom: initial.view?.zoom ?? r.zoom,
    bearing: initial.view?.bearing ?? 0,
    pitch: initial.view?.pitch ?? 0,
    attributionControl: { compact: true },
    maxPitch: 70,
    // We draw our own controls; MapLibre's keyboard handler stays on for + and - keys.
    cooperativeGestures: false,
    fadeDuration: 150,
    locale: {
      'NavigationControl.ZoomIn': 'התקרבות',
      'NavigationControl.ZoomOut': 'התרחקות',
      'NavigationControl.ResetBearing': 'צפון למעלה',
      'GeolocateControl.FindMyLocation': 'המיקום שלי',
      'AttributionControl.ToggleAttribution': 'קרדיטים',
    },
  });
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  // Credits start folded behind the (i) button so they don't cover the map on phones.
  const fold = () => container.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
  map.once('load', fold);
  map.once('idle', fold);
  // MapLibre re-opens them when a new source brings new credits (e.g. switching map type).
  map.on('styledata', () => setTimeout(fold, 0));
  // If the base map can't load (offline, server down), say so and offer a retry.
  // Only the tile index (TileJSON) failing means no map at all; single tiles failing is routine.
  const tileIndex = new RegExp(`${cfg.vectorTiles.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![/\\w])`);
  let shownOffline = false;
  map.on('error', (e) => {
    const msg = String((e.error as Error | undefined)?.message ?? '');
    if (tileIndex.test(msg) && !shownOffline) {
      shownOffline = true;
      toast('המפה לא נטענה. בדקו את החיבור לאינטרנט.', { label: 'ניסיון חוזר', run: () => { shownOffline = false; map.setStyle(style(), { diff: false }); } }, 15000);
    }
  });
  map.on('style.load', () => {
    addBasemapImages(map, imageTheme());
    runStyleHooks(map);
  });
  // Satellite always uses the dark-palette images (light labels over the photo).
  const imageTheme = () => (mapType.value === 'satellite' ? 'dark' : theme());
  map.on('styleimagemissing', (e) => addMissingImage(map, imageTheme(), e.id));

  // Theme switch = new base style; features re-add their layers in their style hooks.
  let first = true;
  effect(() => {
    const next = style();
    if (first) {
      first = false;
      return;
    }
    // A full reload (no diff) so 'style.load' fires and features re-add their layers.
    map.setStyle(next, { diff: false });
  });

  map.on('moveend', () => {
    const c = map.getCenter();
    const r2 = regionAt([c.lng, c.lat]);
    if (r2.id !== region.value.id) region.value = r2;
  });

  // Click: pass rendered features under the pointer to features, highest priority first.
  map.on('click', (e) => {
    const pad = 6;
    const features = map.queryRenderedFeatures([
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad],
    ]);
    dispatchClick(e, features);
  });

  // Long press (touch) / right click (mouse) drops a pin.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  map.on('touchstart', (e) => {
    if (e.originalEvent.touches.length !== 1) return cancel();
    start = { x: e.point.x, y: e.point.y };
    const ll = e.lngLat;
    timer = setTimeout(() => dispatchLongPress({ lng: ll.lng, lat: ll.lat }), 550);
  });
  map.on('touchmove', (e) => {
    if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel();
  });
  map.on('touchend', cancel);
  map.on('touchcancel', cancel);
  map.on('movestart', cancel);
  map.on('contextmenu', (e) => dispatchLongPress({ lng: e.lngLat.lng, lat: e.lngLat.lat }));

  return map;
}
