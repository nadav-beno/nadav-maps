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
    expect(israelHeadsign('ת. רכבת אוניברסיטה/תל אביב יפו<->ת. מרכזית בת ים/בת ים-1#')).toBe('ת. מרכזית בת ים, בת ים');
    expect(israelHeadsign('מסוף רידינג/תל אביב יפו<->ירושלים-3ב#')).toBe('ירושלים');
    expect(israelHeadsign(undefined)).toBeUndefined();
  });
});
