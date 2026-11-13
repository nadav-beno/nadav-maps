import { describe, expect, it } from 'vitest';
import { alongLine, israelHeadsign, vehicleEndsAt, vehiclePositionAt } from './vehicles.ts';

describe('live vehicles', () => {
  it('finds a point part way along a line, with its heading', () => {
    const p = alongLine([[0, 0], [0, 1], [1, 1]], 0.25);
    expect(p.at[0]).toBeCloseTo(0, 5);
    expect(p.at[1]).toBeCloseTo(0.5, 2);
    expect(p.bearing).toBeCloseTo(0, 0);
    expect(alongLine([[0, 0], [0, 1]], 2).at).toEqual([0, 1]);
  });

  it('moves along legs, waits at stops between them, stays at the ends', () => {
    const t0 = Date.parse('2026-11-11T10:00:00Z');
    const v = {
      legs: [
        { geometry: [[0, 0], [0, 1]] as [number, number][], start: '2026-11-11T10:00:00Z', end: '2026-11-11T10:01:00Z', from: 'A', to: 'B' },
        { geometry: [[0, 1], [0, 2]] as [number, number][], start: '2026-11-11T10:02:00Z', end: '2026-11-11T10:03:00Z', from: 'B', to: 'C' },
      ],
    };
    expect(vehiclePositionAt(v, t0 + 30_000)?.at[1]).toBeCloseTo(0.5, 2);
    expect(vehiclePositionAt(v, t0 + 30_000)?.nextStop).toBe('B');
    expect(vehiclePositionAt(v, t0 + 90_000)).toMatchObject({ at: [0, 1], nextStop: 'B' });
    expect(vehiclePositionAt(v, t0 + 150_000)?.nextStop).toBe('C');
    expect(vehiclePositionAt(v, t0 + 600_000)?.at).toEqual([0, 2]);
    expect(vehiclePositionAt({}, t0)).toBeNull();
    expect(vehicleEndsAt(v)).toBe(t0 + 180_000);
    expect(vehicleEndsAt({})).toBe(Infinity);
  });

  it('reads a headsign from an Israeli GTFS long name', () => {
    // Real names from the Ministry's GTFS (Open Bus, 2026-11-13).
    expect(israelHeadsign('מסוף בית העלמין/איסוף-בת ים<->ת. רכבת תל אביב - סבידור/הורדה-תל אביב יפו-20')).toBe('ת. רכבת תל אביב - סבידור, תל אביב יפו');
    expect(israelHeadsign('מסוף אור יהודה-אור יהודה<->קניון איילון-רמת גן-20')).toBe('קניון איילון, רמת גן');
    expect(israelHeadsign('תחנה תפעולית/ביטוח לאומי-ירושלים<->חניון רכבת מלחה/הורדה-ירושלים-1#')).toBe('חניון רכבת מלחה, ירושלים');
    expect(israelHeadsign('חניון רכבת מלחה/דרך יצחק מודעי-ירושלים<->בנייני האומה/הנשיא השישי-ירושלים-2א')).toBe('בנייני האומה, ירושלים');
    expect(israelHeadsign('ת. מרכזית רמלה-רמלה<->שדרות החשמונאים/לב העיר-מודיעין מכבים רעות-10')).toBe('שדרות החשמונאים, מודיעין מכבים רעות');
    expect(israelHeadsign(undefined)).toBeUndefined();
  });
});
