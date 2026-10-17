import { computed, signal } from '@preact/signals';
import type { Place } from '@nm/core';
import { incognito, load, save } from '@nm/core/app';

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
  /** Badge colour for the list icon (Google gives each system list its own). */
  color?: string;
}

/** A private name for a place ("אמא", "החדר כושר"), shown on the map and searchable. */
export interface Label {
  label: string;
  place: Place;
}

export interface SavedData {
  version: 1;
  lists: SavedList[];
  home?: Place;
  work?: Place;
  history: (Place & { at: number })[];
  /** Private labels by place id. */
  labels?: Record<string, Label>;
}

const KEY = 'saved:v1';

/** Google's system lists, in its order. */
export const BUILT_IN: Omit<SavedList, 'places' | 'createdAt'>[] = [
  { id: 'favorites', name: 'מועדפים', icon: '❤️', color: '#d93025', builtIn: true },
  { id: 'want', name: 'רוצה ללכת', icon: '🚩', color: '#188038', builtIn: true },
  { id: 'travel', name: 'תוכניות נסיעה', icon: '🧳', color: '#1a73e8', builtIn: true },
  { id: 'starred', name: 'מסומנים בכוכב', icon: '⭐', color: '#f9ab00', builtIn: true },
];

/** Icons offered for a list (any emoji works; these are the quick picks). */
export const LIST_ICONS = ['📍', '❤️', '⭐', '🚩', '🧳', '🍽️', '☕', '🍺', '🏖️', '🏞️', '🛍️', '🏛️', '🎉', '👶', '🐶', '🏋️', '🚲', '🏠'];

function initial(): SavedData {
  const now = Date.now();
  return { version: 1, lists: BUILT_IN.map((b) => ({ ...b, places: [], createdAt: now })), history: [], labels: {} };
}

export const data = signal<SavedData>(migrate(load<unknown>(KEY, null)));
data.subscribe((d) => {
  if (!save(KEY, d)) console.warn('saving places failed (storage full or blocked)');
});

export function migrate(raw: unknown): SavedData {
  if (!raw || typeof raw !== 'object' || (raw as SavedData).version !== 1) return initial();
  const d = raw as SavedData;
  const lists = Array.isArray(d.lists) && d.lists.length ? d.lists : initial().lists;
  // Bring older data up to date: favorites became a heart, and the newer system lists are added.
  const now = Date.now();
  const fixed = lists.map((l) => {
    const b = BUILT_IN.find((x) => x.id === l.id && l.builtIn);
    if (!b) return l;
    return { ...l, color: l.color ?? b.color, icon: l.id === 'favorites' && l.icon === '⭐' ? b.icon : l.icon };
  });
  for (const b of BUILT_IN) if (!fixed.some((l) => l.id === b.id)) fixed.push({ ...b, places: [], createdAt: now });
  return { ...initial(), ...d, lists: fixed, history: d.history ?? [], labels: d.labels ?? {} };
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

/** The list the one-tap "Save" button uses: the last one picked, favorites at first. */
export const lastListId = signal<string>(load('saved:lastList', 'favorites'));
lastListId.subscribe((v) => save('saved:lastList', v));

/** Save to the last-used list (if not there already). Returns that list. */
export function quickSave(place: Place): SavedList {
  const d = data.value;
  const list = d.lists.find((l) => l.id === lastListId.peek()) ?? d.lists[0];
  if (!list.places.some((p) => p.id === place.id)) toggleInList(list.id, place);
  return list;
}

export function setNote(placeId: string, note: string): void {
  const n = note.trim().slice(0, 500) || undefined;
  data.value = { ...data.value, lists: data.value.lists.map((l) => ({ ...l, places: l.places.map((p) => (p.id === placeId ? { ...p, note: n } : p)) })) };
}

/** The note on a saved place (the same in every list it is in). */
export function noteOf(placeId: string): string | undefined {
  for (const l of data.value.lists) for (const p of l.places) if (p.id === placeId && p.note) return p.note;
  return undefined;
}

export function setListIcon(id: string, icon: string): void {
  data.value = { ...data.value, lists: data.value.lists.map((l) => (l.id === id ? { ...l, icon } : l)) };
}

export function setLabel(place: Place, label: string | undefined): void {
  const labels = { ...(data.value.labels ?? {}) };
  const t = label?.trim().slice(0, 40);
  if (t) labels[place.id] = { label: t, place: strip(place) };
  else delete labels[place.id];
  data.value = { ...data.value, labels };
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
  if (incognito.peek()) return;
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
