import { describe, expect, it } from 'vitest';
import { groupTrips } from './trips.ts';
import type { PhotoRec } from './store.ts';

const H = 3600_000;
let n = 0;
const photo = (t: number, lng: number | null, lat: number | null): PhotoRec => ({ id: `p${n++}`, name: 'x.jpg', takenAt: t, lng, lat, thumb: null, addedAt: 0 });

describe('groupTrips', () => {
  it('splits by time gaps and big jumps, newest first, ignores ungeotagged', () => {
    const t0 = Date.UTC(2025, 5, 1);
    const photos = [
      // trip A: Tel Aviv, 3 photos within a day
      photo(t0, 34.78, 32.08), photo(t0 + 2 * H, 34.79, 32.09), photo(t0 + 5 * H, 34.77, 32.07),
      photo(t0 + 6 * H, null, null),
      // trip B: 13h later but 300 km away (Eilat)
      photo(t0 + 19 * H, 34.95, 29.55), photo(t0 + 20 * H, 34.96, 29.56), photo(t0 + 21 * H, 34.94, 29.54),
      // too small: 2 photos a week later
      photo(t0 + 200 * H, 35, 31), photo(t0 + 201 * H, 35, 31),
    ];
    const trips = groupTrips(photos);
    expect(trips).toHaveLength(2);
    expect(trips[0].bbox[1]).toBeCloseTo(29.54);
    expect(trips[1].photos).toHaveLength(3);
    expect(trips[1].start).toBe(t0);
  });
});
