import type { PlaceRef, Seg, StayEdit, TrackPoint } from './types.ts';

/**
 * The timeline lives only on this device, in IndexedDB (it can grow to years of points):
 *  points  recorded / imported fixes, keyed by time
 *  segs    imported stays and moves (Google), keyed by id, indexed by start
 *  edits   "this was…" corrections, keyed by stay id
 *  places  looked-up names, keyed by rounded position (a cache)
 */
const NAME = 'nm-timeline';
type StoreName = 'points' | 'segs' | 'edits' | 'places';

export interface CachedPlace {
  key: string;
  place: PlaceRef | null;
  at: number;
}

let dbp: Promise<IDBDatabase> | null = null;

export const hasDb = () => typeof indexedDB !== 'undefined';

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('points', { keyPath: 't' });
        db.createObjectStore('segs', { keyPath: 'id' }).createIndex('start', 'start');
        db.createObjectStore('edits', { keyPath: 'id' });
        db.createObjectStore('places', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbp = null;
        reject(req.error);
      };
    });
  }
  return dbp;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function putAll(store: StoreName, items: unknown[]): Promise<void> {
  if (!items.length) return;
  const db = await open();
  // Big imports go in chunks so one transaction never holds hundreds of MB.
  for (let i = 0; i < items.length; i += 5000) {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const it of items.slice(i, i + 5000)) os.put(it);
    await done(tx);
  }
}

export const putPoints = (pts: TrackPoint[]) => putAll('points', pts);
export const putSegs = (segs: Seg[]) => putAll('segs', segs);
export const putEdits = (edits: StayEdit[]) => putAll('edits', edits);

export async function pointsBetween(from: number, to: number): Promise<TrackPoint[]> {
  const db = await open();
  return result(db.transaction('points').objectStore('points').getAll(IDBKeyRange.bound(from, to, false, true)) as IDBRequest<TrackPoint[]>);
}

/** Imported segments touching [from, to). Visits rarely last more than a few days. */
export async function segsBetween(from: number, to: number): Promise<Seg[]> {
  const db = await open();
  const all = await result(db.transaction('segs').objectStore('segs').index('start').getAll(IDBKeyRange.bound(from - 7 * 86400_000, to, false, true)) as IDBRequest<Seg[]>);
  return all.filter((s) => s.end > from);
}

export async function lastPoint(): Promise<TrackPoint | undefined> {
  const db = await open();
  const cur = await result(db.transaction('points').objectStore('points').openCursor(null, 'prev'));
  return (cur?.value as TrackPoint | undefined) ?? undefined;
}

/** Time of the newest point or segment, to jump there after an import. */
export async function newestTime(): Promise<number | undefined> {
  const db = await open();
  const p = await lastPoint();
  const cur = await result(db.transaction('segs').objectStore('segs').index('start').openCursor(null, 'prev'));
  const s = cur?.value as Seg | undefined;
  const ts = [p?.t, s?.start].filter((x): x is number => typeof x === 'number');
  return ts.length ? Math.max(...ts) : undefined;
}

/** Delete everything recorded or imported in [from, to). */
export async function deleteBetween(from: number, to: number): Promise<void> {
  const db = await open();
  const tx = db.transaction(['points', 'segs', 'edits'], 'readwrite');
  tx.objectStore('points').delete(IDBKeyRange.bound(from, to, false, true));
  // Stay ids end with their start time ("s:<t>", "g:s:<t>").
  const er = tx.objectStore('edits').openCursor();
  er.onsuccess = () => {
    const cur = er.result;
    if (!cur) return;
    const t = Number(/(\d+)$/.exec(String(cur.key))?.[1]);
    if (t >= from && t < to) cur.delete();
    cur.continue();
  };
  const idx = tx.objectStore('segs').index('start');
  const req = idx.openCursor(IDBKeyRange.bound(from - 7 * 86400_000, to, false, true));
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return;
    const s = cur.value as Seg;
    if (s.end > from) cur.delete();
    cur.continue();
  };
  await done(tx);
}

export async function deleteSeg(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['segs', 'edits'], 'readwrite');
  tx.objectStore('segs').delete(id);
  tx.objectStore('edits').delete(id);
  await done(tx);
}

export async function getEdit(id: string): Promise<StayEdit | undefined> {
  const db = await open();
  return result(db.transaction('edits').objectStore('edits').get(id) as IDBRequest<StayEdit | undefined>);
}

export async function getCachedPlace(key: string): Promise<CachedPlace | undefined> {
  const db = await open();
  return result(db.transaction('places').objectStore('places').get(key) as IDBRequest<CachedPlace | undefined>);
}

export const putCachedPlace = (c: CachedPlace) => putAll('places', [c]);

export async function exportAll(): Promise<{ points: TrackPoint[]; segs: Seg[]; edits: StayEdit[] }> {
  const db = await open();
  const tx = db.transaction(['points', 'segs', 'edits']);
  const [points, segs, edits] = await Promise.all([
    result(tx.objectStore('points').getAll() as IDBRequest<TrackPoint[]>),
    result(tx.objectStore('segs').getAll() as IDBRequest<Seg[]>),
    result(tx.objectStore('edits').getAll() as IDBRequest<StayEdit[]>),
  ]);
  return { points, segs, edits };
}

export async function counts(): Promise<{ points: number; segs: number }> {
  const db = await open();
  const tx = db.transaction(['points', 'segs']);
  const [points, segs] = await Promise.all([result(tx.objectStore('points').count()), result(tx.objectStore('segs').count())]);
  return { points, segs };
}

export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction(['points', 'segs', 'edits', 'places'], 'readwrite');
  for (const s of ['points', 'segs', 'edits', 'places'] as const) tx.objectStore(s).clear();
  await done(tx);
}
