import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { effect } from '@preact/signals';
import { regionAt, type ProviderConfig, type UrlState } from '@nm/core';
import { isDark, region, toast } from '@nm/core/app';
import { dispatchClick, dispatchLongPress, runStyleHooks } from './registry.ts';

// MapLibre 6 ships its web worker as a separate file; let Vite serve it.
maplibregl.setWorkerUrl(workerUrl);

/**
 * Show names in the UI language where OSM has them (name:he), otherwise the local name.
 * Applies to every label layer that shows a name; road numbers and house numbers stay as-is.
 */
export function localizeLabels(map: maplibregl.Map, lang: string): void {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    if (layer.type !== 'symbol') continue;
    const field = map.getLayoutProperty(layer.id, 'text-field');
    if (!field) continue;
    const text = JSON.stringify(field);
    if (!/name/.test(text) || /housenumber|"ref"/.test(text)) continue;
    map.setLayoutProperty(layer.id, 'text-field', [
      'coalesce',
      ['get', `name:${lang}`],
      ['get', 'name'],
      ['get', 'name:latin'],
      ['get', 'name_en'],
    ]);
  }
}

export function createMap(container: HTMLElement, cfg: ProviderConfig, initial: UrlState): maplibregl.Map {
  const r = initial.view ? regionAt(initial.view.center) : region.value;
  const map = new maplibregl.Map({
    container,
    style: isDark.value ? cfg.styleDark : cfg.styleLight,
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
  // If the base map can't load (offline, server down), say so and offer a retry.
  map.on('error', (e) => {
    const msg = String((e.error as Error | undefined)?.message ?? '');
    if (!map.isStyleLoaded() && /styles\//.test(msg)) {
      toast('המפה לא נטענה. בדקו את החיבור לאינטרנט.', { label: 'ניסיון חוזר', run: () => map.setStyle(isDark.value ? cfg.styleDark : cfg.styleLight) }, 15000);
    }
  });
  map.on('style.load', () => {
    localizeLabels(map, 'he');
    runStyleHooks(map);
  });

  // Theme switch = new base style; features re-add their layers in their style hooks.
  let first = true;
  effect(() => {
    const url = isDark.value ? cfg.styleDark : cfg.styleLight;
    if (first) {
      first = false;
      return;
    }
    map.setStyle(url);
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
