import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { effect } from '@preact/signals';
import { regionAt, type ProviderConfig, type UrlState } from '@nm/core';
import { isDark, region, toast } from '@nm/core/app';
import { dispatchClick, dispatchLongPress, runStyleHooks } from './registry.ts';
import { addBasemapImages, addMissingImage } from './basemap/images.ts';
import { buildStyle } from './basemap/style.ts';

// MapLibre 6 ships its web worker as a separate file; let Vite serve it.
maplibregl.setWorkerUrl(workerUrl);

export function createMap(container: HTMLElement, cfg: ProviderConfig, initial: UrlState): maplibregl.Map {
  const r = initial.view ? regionAt(initial.view.center) : region.value;
  const theme = () => (isDark.value ? 'dark' : 'light');
  const style = () => buildStyle(theme(), cfg, 'he');
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
  map.once('idle', () => container.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
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
    addBasemapImages(map, theme());
    runStyleHooks(map);
  });
  map.on('styleimagemissing', (e) => addMissingImage(map, theme(), e.id));

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
