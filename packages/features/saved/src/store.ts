import { computed, signal } from '@preact/signals';
import type { Place } from '@nm/core';
import { load, save } from '@nm/core/app';

/**
 * Saved places, lists, home/work and history. Stored on the device for now; the
 * shape is what the account sync (phase 4 server) will store, so moving it is a copy.
 */
export interface SavedPlace extends Place {
  savedAt: number;
  note?: string;
}

export interface SavedList {
  id: string;
  name: string;
  icon: string;
  places: SavedPlace[];
  createdAt: number;
  /** Built-in lists can't be deleted. */
  builtIn?: boolean;
}

export interface SavedData {
  version: 1;
  lists: SavedList[];
  home?: Place;
  work?: Place;
  history: (Place & { at: number })[];
}

const KEY = 'saved:v1';

function initial(): SavedData {
  const now = Date.now();
  return {
    version: 1,
    lists: [
      { id: 'favorites', name: 'מועדפים', icon: '⭐', places: [], createdAt: now, builtIn: true },
      { id: 'want', name: 'רוצה ללכת', icon: '🚩', places: [], createdAt: now, builtIn: true },
    ],
    history: [],
  };
}

export const data = signal<SavedData>(migrate(load<unknown>(KEY, null)));
data.subscribe((d) => {
  if (!save(KEY, d)) console.warn('saving places failed (storage full or blocked)');
});

function migrate(raw: unknown): SavedData {
  if (!raw || typeof raw !== 'object' || (raw as SavedData).version !== 1) return initial();
  const d = raw as SavedData;
  return { ...initial(), ...d, lists: Array.isArray(d.lists) && d.lists.length ? d.lists : initial().lists, history: d.history ?? [] };
}

export const savedIds = computed(() => {
  const ids = new Set<string>();
  for (const l of data.value.lists) for (const p of l.places) ids.add(p.id);
  return ids;
});

const strip = (p: Place): Place => ({
  id: p.id,
  name: p.name,
  lng: p.lng,
  lat: p.lat,
  address: p.address,
  category: p.category,
  osm: p.osm,
  countryCode: p.countryCode,
});

export function listsContaining(id: string): string[] {
  return data.value.lists.filter((l) => l.places.some((p) => p.id === id)).map((l) => l.id);
}

export function toggleInList(listId: string, place: Place): boolean {
  let added = false;
  data.value = {
    ...data.value,
    lists: data.value.lists.map((l) => {
      if (l.id !== listId) return l;
      const has = l.places.some((p) => p.id === place.id);
      added = !has;
      return { ...l, places: has ? l.places.filter((p) => p.id !== place.id) : [{ ...strip(place), savedAt: Date.now() }, ...l.places] };
    }),
  };
  return added;
}

export function createList(name: string, icon = '📍', places: SavedPlace[] = []): SavedList {
  const list: SavedList = { id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || 'רשימה חדשה', icon, places, createdAt: Date.now() };
  data.value = { ...data.value, lists: [...data.value.lists, list] };
  return list;
}

export function renameList(id: string, name: string): void {
  data.value = { ...data.value, lists: data.value.lists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) };
}

export function deleteList(id: string): SavedList | undefined {
  const list = data.value.lists.find((l) => l.id === id);
  if (!list || list.builtIn) return undefined;
  data.value = { ...data.value, lists: data.value.lists.filter((l) => l.id !== id) };
  return list;
}

export function restoreList(list: SavedList): void {
  data.value = { ...data.value, lists: [...data.value.lists, list] };
}

export function setHomeWork(which: 'home' | 'work', place: Place | undefined): void {
  data.value = { ...data.value, [which]: place ? strip(place) : undefined };
}

export function addHistory(place: Place): void {
  const h = data.value.history.filter((p) => p.id !== place.id);
  data.value = { ...data.value, history: [{ ...strip(place), at: Date.now() }, ...h].slice(0, 50) };
}

export function clearHistory(): void {
  data.value = { ...data.value, history: [] };
}

// --- sharing & files ---

type FC = { type: 'FeatureCollection'; name?: string; features: { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Point'; coordinates: [number, number] } }[] };

export function toGeoJSON(list: SavedList): FC {
  return {
    type: 'FeatureCollection',
    name: list.name,
    features: list.places.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, name: p.name, address: p.address ?? null, note: p.note ?? null },
      geometry: { type: 'Point', coordinates: [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))] },
    })),
  };
}

export function fromGeoJSON(fc: unknown): { name: string; places: SavedPlace[] } {
  const f = fc as FC;
  if (!f || f.type !== 'FeatureCollection' || !Array.isArray(f.features)) throw new Error('הקובץ אינו GeoJSON תקין');
  const places: SavedPlace[] = [];
  for (const feat of f.features) {
    if (feat?.geometry?.type !== 'Point') continue;
    const [lng, lat] = feat.geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const pr = feat.properties ?? {};
    const name = String(pr.name ?? pr.title ?? pr.Name ?? 'מקום');
    const id = typeof pr.id === 'string' && /^(osm:[nwr]\d+|pt:)/.test(pr.id) ? pr.id : `pt:${lng.toFixed(5)},${lat.toFixed(5)}`;
    places.push({ id, name, lng, lat, address: pr.address ? String(pr.address) : undefined, note: pr.note ? String(pr.note) : undefined, savedAt: Date.now() });
  }
  return { name: f.name ?? 'רשימה מיובאת', places };
}

/** Compact, URL-safe encoding of a list for "share by link, no account needed". */
export function encodeList(list: SavedList): string {
  const compact = { n: list.name, p: list.places.slice(0, 200).map((p) => [p.name, Number(p.lng.toFixed(5)), Number(p.lat.toFixed(5)), p.id.startsWith('osm:') ? p.id.slice(4) : ''] as const) };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeList(s: string): { name: string; places: SavedPlace[] } {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const c = JSON.parse(new TextDecoder().decode(bytes)) as { n: string; p: [string, number, number, string][] };
  return {
    name: String(c.n),
    places: c.p
      .filter(([, x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([name, lng, lat, osm]) => ({ id: osm ? `osm:${osm}` : `pt:${lng.toFixed(5)},${lat.toFixed(5)}`, name: String(name), lng, lat, savedAt: Date.now() })),
  };
}
