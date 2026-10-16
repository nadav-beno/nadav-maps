import type { Map as MapLibreMap } from 'maplibre-gl';
import { distance } from '../geo.ts';
import type { BBox, LngLat, Place } from '../types.ts';
import { open } from './actions.ts';
import { currentView } from './state.ts';

/** The category chips Google shows for "מה יש באזור…" / "באזור", by our category-search ids. */
export const NEARBY_CHIPS: { id: string; label: string; icon: string }[] = [
  { id: 'restaurant', label: 'מסעדות', icon: 'restaurant' },
  { id: 'hotel', label: 'בתי מלון', icon: 'hotel' },
  { id: 'fuel', label: 'תחנות דלק', icon: 'local_gas_station' },
  { id: 'parking', label: 'מגרשי חניה', icon: 'local_parking' },
  { id: 'cafe', label: 'בתי קפה', icon: 'local_cafe' },
  { id: 'supermarket', label: 'סופרמרקטים', icon: 'grocery' },
  { id: 'attraction', label: 'אטרקציות', icon: 'attractions' },
];

/** A box `radiusM` metres around a point. */
export function boxAround([lng, lat]: LngLat, radiusM: number): BBox {
  const dLat = radiusM / 111_320;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/**
 * Run a category search around a point and show it on the results screen (the search
 * feature's "results" view), the way the category chips do around the map centre.
 * `fetch` is the caller's `searchNearby` call, so this module needs no tools.
 */
export async function openNearbyResults(opts: {
  title: string;
  category: string;
  center: LngLat;
  fetch: (bbox: BBox) => Promise<Place[]>;
  map?: MapLibreMap;
  radiusM?: number;
}): Promise<void> {
  const base = { title: opts.title, category: opts.category, url: { cat: opts.category } };
  open({ kind: 'results', props: { ...base, loading: true } });
  opts.map?.jumpTo({ center: opts.center, zoom: Math.max(15, Math.min(opts.map.getZoom(), 16)) });
  // Only fill in the results screen if it is still the one showing.
  const still = () => {
    const v = currentView.peek();
    return v.kind === 'results' && (v.props as { category?: string } | undefined)?.category === opts.category;
  };
  try {
    const places = (await opts.fetch(boxAround(opts.center, opts.radiusM ?? 1500)))
      .sort((a, b) => distance(opts.center, [a.lng, a.lat]) - distance(opts.center, [b.lng, b.lat]))
      .slice(0, 40);
    if (still()) open({ kind: 'results', props: { ...base, places } }, { replace: true });
  } catch (e) {
    if (still()) open({ kind: 'results', props: { ...base, error: (e as Error).message } }, { replace: true });
  }
}
