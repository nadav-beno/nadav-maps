import { describe, expect, it } from 'vitest';
import { distance, greatCircle, pathLength, ringArea } from './geo.ts';
import { formatArea } from './format.ts';
import type { LngLat } from './types.ts';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

describe('pathLength', () => {
  const tri: LngLat[] = [
    [0, 0],
    [0.01, 0],
    [0.01, 0.01],
  ];
  it('sums the segments of an open path', () => {
    expect(pathLength(tri)).toBeCloseTo(distance(tri[0], tri[1]) + distance(tri[1], tri[2]), 6);
  });
  it('adds the closing segment of a closed path', () => {
    expect(pathLength(tri, true)).toBeCloseTo(pathLength(tri) + distance(tri[2], tri[0]), 6);
  });
  it('is zero for fewer than two points', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([[34.78, 32.08]], true)).toBe(0);
  });
});

describe('ringArea', () => {
  it('matches the exact area of a 1° cell on the equator', () => {
    const cell: LngLat[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    // A lat/lng rectangle covers R²·Δλ·(sin φ2 − sin φ1).
    const exact = R * R * rad(1) * Math.sin(rad(1));
    expect(ringArea(cell) / exact).toBeCloseTo(1, 6);
  });

  it('measures a 100 m square in Tel Aviv as about 10,000 m²', () => {
    const lat = 32.08;
    const dLat = 100 / 111194.9;
    const dLng = dLat / Math.cos(rad(lat));
    const sq: LngLat[] = [
      [34.78, lat],
      [34.78 + dLng, lat],
      [34.78 + dLng, lat + dLat],
      [34.78, lat + dLat],
    ];
    expect(ringArea(sq)).toBeGreaterThan(9950);
    expect(ringArea(sq)).toBeLessThan(10050);
  });

  it('ignores winding order and a repeated closing point', () => {
    const ring: LngLat[] = [
      [35.2, 31.7],
      [35.25, 31.7],
      [35.22, 31.76],
    ];
    const a = ringArea(ring);
    expect(ringArea([...ring].reverse())).toBeCloseTo(a, 3);
    expect(ringArea([...ring, ring[0]])).toBeCloseTo(a, 3);
  });

  it('is zero for a line', () => {
    expect(ringArea([[0, 0], [1, 1]])).toBe(0);
  });
});

describe('greatCircle', () => {
  it('keeps short segments as they are', () => {
    expect(greatCircle([34.78, 32.08], [34.79, 32.09])).toEqual([
      [34.78, 32.08],
      [34.79, 32.09],
    ]);
  });

  it('follows the great circle between distant points', () => {
    const tlv: LngLat = [34.78, 32.08];
    const nyc: LngLat = [-74.0, 40.71];
    const path = greatCircle(tlv, nyc, 100000);
    expect(path[0]).toEqual(tlv);
    expect(path[path.length - 1]).toEqual(nyc);
    for (let i = 1; i < path.length; i++) expect(distance(path[i - 1], path[i])).toBeLessThan(100001);
    // The shortest path bulges north of both cities.
    expect(Math.max(...path.map((p) => p[1]))).toBeGreaterThan(50);
    // Its length is the great-circle distance.
    expect(pathLength(path) / distance(tlv, nyc)).toBeCloseTo(1, 4);
  });

  it('stays continuous across the antimeridian', () => {
    const path = greatCircle([170, 0], [-170, 0], 100000);
    for (const [lng] of path) expect(lng).toBeGreaterThanOrEqual(170);
    expect(path[path.length - 1][0]).toBeCloseTo(190, 6);
  });
});

describe('formatArea', () => {
  it('uses square meters, dunams and km² in Hebrew regions', () => {
    expect(formatArea(850)).toBe('850 מ״ר');
    expect(formatArea(2500)).toBe('2.5 דונם');
    expect(formatArea(45_300)).toBe('45.3 דונם');
    expect(formatArea(3_200_000)).toBe('3.2 קמ״ר');
  });
  it('uses hectares where Hebrew is not spoken', () => {
    expect(formatArea(2500, 'metric', 'en')).toBe('2,500 מ״ר');
    expect(formatArea(25_000, 'metric', 'en')).toBe('2.5 הקטאר');
  });
  it('uses imperial units', () => {
    expect(formatArea(500, 'imperial')).toBe('5,382 רגל רבועה');
    expect(formatArea(4046.8564224 * 3, 'imperial')).toBe('3 אייקר');
    expect(formatArea(2589988.110336 * 1000, 'imperial')).toBe('1,000 מייל רבוע');
  });
});
