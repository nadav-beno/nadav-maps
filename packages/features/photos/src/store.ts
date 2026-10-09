import { signal } from '@preact/signals';
import { createStore, del, entries, set, clear } from 'idb-keyval';

/**
 * Your photos map lives only on this device (IndexedDB). We keep a small thumbnail,
 * the time and the GPS point of each photo, never the original file, and nothing is uploaded.
 */
export interface PhotoRec {
  id: string;
  name: string;
  takenAt: number | null;
  lng: number | null;
  lat: number | null;
  thumb: Blob | null;
  addedAt: number;
}

const store = typeof indexedDB !== 'undefined' ? createStore('nm-photos', 'photos') : undefined;
export const photos = signal<PhotoRec[]>([]);
export const loaded = signal(false);

export async function loadAll(): Promise<void> {
  if (!store) return;
  try {
    const all = (await entries<string, PhotoRec>(store)).map(([, v]) => v);
    all.sort((a, b) => (a.takenAt ?? a.addedAt) - (b.takenAt ?? b.addedAt));
    photos.value = all;
  } finally {
    loaded.value = true;
  }
}

export async function put(recs: PhotoRec[]): Promise<void> {
  if (store) for (const r of recs) await set(r.id, r, store);
  const byId = new Map(photos.value.map((p) => [p.id, p]));
  for (const r of recs) byId.set(r.id, r);
  photos.value = [...byId.values()].sort((a, b) => (a.takenAt ?? a.addedAt) - (b.takenAt ?? b.addedAt));
}

export async function remove(id: string): Promise<void> {
  if (store) await del(id, store);
  photos.value = photos.value.filter((p) => p.id !== id);
}

export async function removeAll(): Promise<void> {
  if (store) await clear(store);
  photos.value = [];
}

/** Same file imported twice should not appear twice. */
export function fileId(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}
