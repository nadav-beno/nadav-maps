import { describe, expect, it } from 'vitest';
import { addDays, dayKey, dayRange, tzOffsetMs } from './days.ts';
import { classifyMove, keepPoint, mergeSegments, segment, splitByMode, summarize, thin } from './segment.ts';
import type { Move, Seg, Stay, TrackPoint } from './types.ts';

const T0 = Date.UTC(2026, 9, 10, 5, 0, 0); // 08:00 in Jerusalem
const MIN = 60_000;
// ~1 m in degrees at Tel Aviv's latitude.
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((32.08 * Math.PI) / 180));

/** Fixes every `stepS` seconds, going east at `kmh` from [lng, lat] for `minutes`. */
function track(t0: number, lng: number, lat: number, kmh: number, minutes: number, stepS = 30): TrackPoint[] {
  const out: TrackPoint[] = [];
  const mps = kmh / 3.6;
  for (let s = 0; s <= minutes * 60; s += stepS) out.push({ t: t0 + s * 1000, lng: lng + mps * s * M_LNG, lat, acc: 10 });
  return out;
}
/** Standing still (with a few metres of GPS wobble). */
function still(t0: number, lng: number, lat: number, minutes: number, stepS = 60): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let s = 0, k = 0; s <= minutes * 60; s += stepS, k++) out.push({ t: t0 + s * 1000, lng: lng + ((k % 3) - 1) * 8 * M_LNG, lat: lat + ((k % 2) * 6) * M_LAT, acc: 15 });
  return out;
}

describe('keepPoint / thin', () => {
  const a: TrackPoint = { t: T0, lng: 34.78, lat: 32.08, acc: 10 };
  it('drops inaccurate fixes', () => {
    expect(keepPoint(undefined, { ...a, acc: 150 })).toBe(false);
    expect(keepPoint(undefined, a)).toBe(true);
  });
  it('needs 10 s and 15 m while moving', () => {
    expect(keepPoint(a, { ...a, t: T0 + 5000, lng: a.lng + 50 * M_LNG })).toBe(false);
    expect(keepPoint(a, { ...a, t: T0 + 12000, lng: a.lng + 50 * M_LNG })).toBe(true);
  });
  it('keeps one fix a minute when standing still', () => {
    expect(keepPoint(a, { ...a, t: T0 + 30_000, lng: a.lng + 3 * M_LNG })).toBe(false);
    expect(keepPoint(a, { ...a, t: T0 + 61_000, lng: a.lng + 3 * M_LNG })).toBe(true);
  });
  it('thins a dense track', () => {
    const dense = track(T0, 34.78, 32.08, 5, 10, 1);
    const out = thin(dense);
    expect(out.length).toBeLessThan(dense.length / 8);
    expect(out[0].t).toBe(T0);
  });
});

describe('classifyMove', () => {
  it('tells walk, bike, car, train and flight apart by speed', () => {
    expect(classifyMove(track(T0, 34.78, 32.08, 4.5, 20))).toBe('walk');
    expect(classifyMove(track(T0, 34.78, 32.08, 16, 20))).toBe('bike');
    expect(classifyMove(track(T0, 34.78, 32.08, 60, 20))).toBe('car');
    expect(classifyMove(track(T0, 34.78, 32.08, 160, 20))).toBe('train');
    expect(classifyMove(track(T0, 34.78, 32.08, 800, 30, 60))).toBe('flight');
  });
  it('calls a big climb a flight even at moderate average speed', () => {
    const pts = track(T0, 34.78, 32.08, 150, 20).map((p, i) => ({ ...p, alt: i * 300 }));
    expect(classifyMove(pts)).toBe('flight');
  });
  it('uses the speed the device reports for short steps', () => {
    const pts = track(T0, 34.78, 32.08, 4, 10).map((p) => ({ ...p, speed: 15 }));
    expect(classifyMove(pts)).toBe('car');
  });
});

describe('segment', () => {
  it('finds stay, move, stay with the drive in between', () => {
    const home = still(T0, 34.7818, 32.0853, 30);
    const driveStart = T0 + 31 * MIN;
    const drive = track(driveStart, 34.7818, 32.0853, 40, 15);
    const lastDrive = drive[drive.length - 1];
    const office = still(lastDrive.t + MIN, lastDrive.lng, lastDrive.lat, 60);
    const segs = segment([...home, ...drive, ...office]);
    expect(segs.map((s) => s.kind)).toEqual(['stay', 'move', 'stay']);
    const [s1, m, s2] = segs as [Stay, Move, Stay];
    expect(s1.start).toBe(T0);
    expect(s2.end).toBe(office[office.length - 1].t);
    expect(m.mode).toBe('car');
    expect(m.distanceM).toBeGreaterThan(9000);
    expect(m.distanceM).toBeLessThan(11000);
    expect(m.start).toBe(s1.end);
    expect(m.end).toBe(s2.start);
  });

  it('a short pause is not a stay', () => {
    const walk1 = track(T0, 34.78, 32.08, 5, 10);
    const end1 = walk1[walk1.length - 1];
    // A one-minute stop at a crossing: with the walk in and out it is ~3 min within 100 m.
    const pause = still(end1.t + 30_000, end1.lng, end1.lat, 1, 30);
    const p2 = pause[pause.length - 1];
    const walk2 = track(p2.t + 30_000, p2.lng, p2.lat, 5, 10);
    const segs = segment([...walk1, ...pause, ...walk2]);
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(0);
    expect(segs).toHaveLength(1);
    expect((segs[0] as Move).mode).toBe('walk');
  });

  it('a gap while the app was closed still counts toward the stay', () => {
    const a = still(T0, 34.78, 32.08, 1);
    const b = still(T0 + 3 * 60 * MIN, 34.78, 32.08, 1);
    const segs = segment([...a, ...b]);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('stay');
    expect(segs[0].end - segs[0].start).toBeGreaterThanOrEqual(3 * 60 * MIN);
  });

  it('splits a walk to the car from the drive', () => {
    const walk = track(T0, 34.78, 32.08, 5, 8);
    const w = walk[walk.length - 1];
    const drive = track(w.t + 30_000, w.lng, w.lat, 50, 12);
    const parts = splitByMode([...walk, ...drive]);
    expect(parts.length).toBe(2);
    expect(classifyMove(parts[0])).toBe('walk');
    expect(classifyMove(parts[1])).toBe('car');
    const segs = segment([...walk, ...drive]);
    expect(segs.map((s) => (s as Move).mode)).toEqual(['walk', 'car']);
  });

  it('ignores fixes worse than 100 m', () => {
    const home = still(T0, 34.78, 32.08, 20);
    const noisy = [{ t: T0 + 10 * MIN + 1, lng: 34.9, lat: 32.2, acc: 500 }];
    expect(segment([...home, ...noisy]).map((s) => s.kind)).toEqual(['stay']);
  });
});

describe('mergeSegments / summarize', () => {
  const stay = (start: number, end: number, source: 'gps' | 'google'): Stay => ({ kind: 'stay', id: `${source}${start}`, start, end, lng: 34.78, lat: 32.08, source });
  const mv = (start: number, end: number, d: number): Move => ({ kind: 'move', id: `m${start}`, start, end, mode: 'car', distanceM: d, path: [], source: 'gps' });

  it('imported history wins where both cover the same time', () => {
    const imported: Seg[] = [stay(T0, T0 + 60 * MIN, 'google')];
    const computed: Seg[] = [stay(T0 + 5 * MIN, T0 + 50 * MIN, 'gps'), stay(T0 + 120 * MIN, T0 + 180 * MIN, 'gps')];
    const out = mergeSegments(imported, computed);
    expect(out.map((s) => s.id)).toEqual([`google${T0}`, `gps${T0 + 120 * MIN}`]);
  });

  it('sums distance, places and moving time inside the day, pro rata', () => {
    const segs: Seg[] = [stay(T0, T0 + 60 * MIN, 'gps'), mv(T0 + 60 * MIN, T0 + 80 * MIN, 10_000), mv(T0 - 20 * MIN, T0 + 20 * MIN, 4000)];
    const s = summarize(segs, T0, T0 + 24 * 60 * MIN);
    expect(s.places).toBe(1);
    expect(s.distanceM).toBeCloseTo(12_000);
    expect(s.movingMs).toBe(40 * MIN);
  });
});

describe('days', () => {
  it('day keys and ranges follow the time zone', () => {
    // 23:30 UTC on Oct 9 is already Oct 10 in Jerusalem.
    expect(dayKey(Date.UTC(2026, 9, 9, 23, 30), 'Asia/Jerusalem')).toBe('2026-10-10');
    expect(dayKey(Date.UTC(2026, 9, 9, 23, 30), 'UTC')).toBe('2026-10-09');
    const [a, b] = dayRange('2026-10-10', 'Asia/Jerusalem');
    expect(new Date(a).toISOString()).toBe('2026-10-09T21:00:00.000Z');
    expect(b - a).toBe(24 * 3600_000);
    expect(tzOffsetMs(a, 'Asia/Jerusalem')).toBe(3 * 3600_000);
  });
  it('handles the day clocks go back (25 hours)', () => {
    const [a, b] = dayRange('2026-10-25', 'Europe/London');
    expect(b - a).toBe(25 * 3600_000);
  });
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
