import { distance } from '@nm/core';
import type { PhotoRec } from './store.ts';

export interface Trip {
  id: string;
  start: number;
  end: number;
  photos: PhotoRec[];
  bbox: [number, number, number, number];
}

/**
 * Group geotagged photos into trips: a new trip starts after a gap of more than
 * `gapHours` without photos, or a jump of more than `jumpKm` between consecutive photos
 * taken more than 12 hours apart.
 */
export function groupTrips(all: PhotoRec[], gapHours = 36, jumpKm = 150): Trip[] {
  const geo = all.filter((p) => p.lng !== null && p.lat !== null && p.takenAt !== null).sort((a, b) => a.takenAt! - b.takenAt!);
  const trips: Trip[] = [];
  let cur: PhotoRec[] = [];
  const flush = () => {
    if (cur.length >= 3) {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const p of cur) {
        w = Math.min(w, p.lng!); e = Math.max(e, p.lng!); s = Math.min(s, p.lat!); n = Math.max(n, p.lat!);
      }
      trips.push({ id: cur[0].id, start: cur[0].takenAt!, end: cur[cur.length - 1].takenAt!, photos: cur, bbox: [w, s, e, n] });
    }
    cur = [];
  };
  for (const p of geo) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = (p.takenAt! - prev.takenAt!) / 3600000;
      const jump = distance([prev.lng!, prev.lat!], [p.lng!, p.lat!]) / 1000;
      if (gap > gapHours || (gap > 12 && jump > jumpKm)) flush();
    }
    cur.push(p);
  }
  flush();
  return trips.reverse();
}
