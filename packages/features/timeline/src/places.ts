import { signal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { distance, overturePlace, pointPlaceId, type Place } from '@nm/core';
import { load, queryPlaceFeatures, save } from '@nm/core/app';
import { reverseGeocode, tools } from '@nm/tools';
import { getCachedPlace, getEdit, putCachedPlace } from './db.ts';
import type { PlaceRef, Stay } from './types.ts';

/**
 * What place a stay was. In order: your correction, your saved places (home, work, lists),
 * the name Google's export had, a business loaded on the map, and finally the same
 * address lookup a tap on the map does (only when allowed in the timeline settings).
 */

/** Look up names of stays with the search service. On by default, like tapping the map. */
export const autoIdentify = signal<boolean>(load('timeline:identify', true));
autoIdentify.subscribe((v) => save('timeline:identify', v));

const LOOKUP_RETRY_MS = 7 * 86400_000;

interface SavedShape {
  home?: Place;
  work?: Place;
  lists?: { name: string; places?: Place[] }[];
}

/** Saved places (written by the saved feature under this storage key; read-only here). */
export function savedPlaces(): PlaceRef[] {
  const d = load<SavedShape | null>('saved:v1', null);
  if (!d || typeof d !== 'object') return [];
  const out: PlaceRef[] = [];
  const add = (p: Place | undefined, extra: Partial<PlaceRef> = {}) => {
    if (p && Number.isFinite(p.lng) && Number.isFinite(p.lat)) out.push({ id: p.id, name: p.name, lng: p.lng, lat: p.lat, address: p.address, category: p.category, source: 'saved', ...extra });
  };
  add(d.home, { name: 'בית', semantic: 'home', address: d.home?.name !== 'בית' ? d.home?.address ?? d.home?.name : d.home?.address });
  add(d.work, { name: 'עבודה', semantic: 'work', address: d.work?.name !== 'עבודה' ? d.work?.address ?? d.work?.name : d.work?.address });
  for (const l of Array.isArray(d.lists) ? d.lists : []) for (const p of Array.isArray(l.places) ? l.places : []) add(p);
  return out;
}

function near<T extends { lng: number; lat: number }>(items: T[], lng: number, lat: number, maxM: number): (T & { d: number })[] {
  return items
    .map((x) => ({ ...x, d: distance([lng, lat], [x.lng, x.lat]) }))
    .filter((x) => x.d <= maxM)
    .sort((a, b) => a.d - b.d);
}

/** Businesses from the Overture tiles the map has already loaded (no network). */
export function mapPlacesNear(map: MapLibreMap | undefined, lng: number, lat: number, maxM: number): PlaceRef[] {
  if (!map) return [];
  const seen = new Set<string>();
  const out: PlaceRef[] = [];
  try {
    for (const f of queryPlaceFeatures(map)) {
      if (f.geometry.type !== 'Point' || !f.properties?.id) continue;
      const [x, y] = f.geometry.coordinates as [number, number];
      const p = overturePlace(f.properties, x, y);
      if (!p.name || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, name: p.name, lng: x, lat: y, address: p.address, category: p.category, source: 'map' });
    }
  } catch {
    return [];
  }
  return near(out, lng, lat, maxM).map(({ d: _d, ...p }) => p);
}

/** Named places of interest the base map draws right now (shops, cafés, ...; no network). */
export function basemapPlacesNear(map: MapLibreMap | undefined, lng: number, lat: number, maxM: number): PlaceRef[] {
  if (!map) return [];
  const out: PlaceRef[] = [];
  const seen = new Set<string>();
  try {
    for (const f of map.queryRenderedFeatures()) {
      if (f.sourceLayer !== 'poi' || f.geometry.type !== 'Point' || !f.properties?.name) continue;
      const [x, y] = f.geometry.coordinates as [number, number];
      const name = String(f.properties['name:he'] ?? f.properties.name);
      const key = `${name}@${x.toFixed(4)},${y.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = f.properties.subclass ?? f.properties.class;
      out.push({ name, lng: x, lat: y, category: sub ? { key: 'amenity', value: String(sub) } : undefined, source: 'map' });
    }
  } catch {
    return [];
  }
  return near(out, lng, lat, maxM).map(({ d: _d, ...p }) => p);
}

const cacheKey = (lng: number, lat: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

async function lookup(lng: number, lat: number): Promise<PlaceRef | null> {
  const r = await tools().call(reverseGeocode, { lng, lat });
  if (!r) return null;
  return { id: r.id, name: r.name, lng: r.lng, lat: r.lat, address: r.address, category: r.category, source: 'lookup' };
}

/**
 * The place of a stay. With `network: false` it answers only from the device (undefined
 * when a lookup would be needed), so a whole day can be named at once before any lookups.
 */
export async function resolveStay(map: MapLibreMap | undefined, stay: Stay, network = true): Promise<PlaceRef | null | undefined> {
  const edit = await getEdit(stay.id).catch(() => undefined);
  if (edit) return { ...edit.place, source: 'edit' };
  const saved = near(savedPlaces(), stay.lng, stay.lat, 120)[0];
  if (saved) return saved;
  if (stay.place?.name) return stay.place;
  if (stay.semantic) return { name: stay.semantic === 'home' ? 'בית' : 'עבודה', lng: stay.lng, lat: stay.lat, semantic: stay.semantic, source: 'google' };
  const key = cacheKey(stay.lng, stay.lat);
  const cached = await getCachedPlace(key).catch(() => undefined);
  // A failed lookup is retried after a week; a found name is kept.
  if (cached && (cached.place || Date.now() - cached.at < LOOKUP_RETRY_MS)) return cached.place;
  const onMap = mapPlacesNear(map, stay.lng, stay.lat, 40)[0];
  if (onMap) {
    void putCachedPlace({ key, place: onMap, at: Date.now() }).catch(() => {});
    return onMap;
  }
  if (!autoIdentify.value) return null;
  if (!network) return undefined;
  try {
    const found = await lookup(stay.lng, stay.lat);
    void putCachedPlace({ key, place: found, at: Date.now() }).catch(() => {});
    return found;
  } catch {
    return null;
  }
}

type Candidate = PlaceRef & { d?: number };

/** The address lookup for "this was…" (network, only when the user opens that screen). */
export async function lookupHere(stay: Stay): Promise<Candidate | null> {
  try {
    const here = await lookup(stay.lng, stay.lat);
    return here ? { ...here, d: distance([stay.lng, stay.lat], [here.lng, here.lat]) } : null;
  } catch {
    return null; // offline: the other choices still work
  }
}

/**
 * Choices for "this was…": saved places, then businesses the map has loaded around the
 * stay (nearest first), then the looked-up address. Cheap, so it can run on every map idle.
 */
export function candidates(map: MapLibreMap | undefined, stay: Stay, here: Candidate | null = null): Candidate[] {
  const out: Candidate[] = [];
  out.push(...near(savedPlaces(), stay.lng, stay.lat, 300).slice(0, 4));
  const onMap = [...mapPlacesNear(map, stay.lng, stay.lat, 200), ...basemapPlacesNear(map, stay.lng, stay.lat, 200)]
    .map((p) => ({ ...p, d: distance([stay.lng, stay.lat], [p.lng, p.lat]) }))
    .sort((a, b) => a.d - b.d);
  out.push(...onMap.slice(0, 12));
  if (here) out.push(here);
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = p.id ?? p.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A stay as a place the place card can open. */
export function toPlace(ref: PlaceRef | null | undefined, stay: Stay): Place {
  const lng = ref?.lng ?? stay.lng;
  const lat = ref?.lat ?? stay.lat;
  const id = ref?.id && /^(osm:|ovt:|pt:)/.test(ref.id) ? ref.id : pointPlaceId(lng, lat);
  return { id, name: ref?.name || 'מקום שביקרת בו', lng, lat, address: ref?.address, category: ref?.category };
}
