import { effect } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { buildUrl, type UrlState } from '@nm/core';
import { currentView, viewStack } from '@nm/core/app';

/**
 * Keeps the address bar in sync with the app, and the browser back button with the panel:
 * - map moves update the #zoom/lat/lng hash (replaceState, no history spam);
 * - opening a screen pushes a history entry, so Back (or the Android back gesture) closes it;
 * - the current screen's `props.url` becomes the query string, so every screen is linkable.
 */
export function startUrlSync(map: MapLibreMap): void {
  let depth = (history.state as { depth?: number } | null)?.depth ?? 0;
  let internal = false;

  const currentUrl = (): string => {
    const c = map.getCenter();
    const params = (currentView.value.props?.url ?? {}) as Partial<UrlState>;
    return buildUrl(location.href, {
      ...params,
      view: { zoom: map.getZoom(), center: [c.lng, c.lat], bearing: map.getBearing(), pitch: map.getPitch() },
    });
  };

  // Start at depth 0 for this page load.
  history.replaceState({ depth: 0 }, '', currentUrl());
  depth = 0;

  effect(() => {
    const len = viewStack.value.length;
    void currentView.value;
    if (internal) {
      internal = false;
      history.replaceState({ depth }, '', currentUrl());
      return;
    }
    if (len > depth) {
      history.pushState({ depth: len }, '', currentUrl());
      depth = len;
    } else if (len === depth) {
      history.replaceState({ depth }, '', currentUrl());
    } else {
      // Closed from the UI: rewind browser history to match.
      const steps = len - depth;
      depth = len;
      internal = true;
      history.go(steps);
    }
  });

  window.addEventListener('popstate', (e) => {
    const d = (e.state as { depth?: number } | null)?.depth ?? 0;
    if (internal) {
      internal = false;
      history.replaceState({ depth: d }, '', currentUrl());
      return;
    }
    depth = d;
    if (d < viewStack.value.length) {
      internal = true;
      viewStack.value = viewStack.value.slice(0, d);
    }
  });

  let t: ReturnType<typeof setTimeout> | undefined;
  map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(() => history.replaceState(history.state, '', currentUrl()), 250);
  });
}
