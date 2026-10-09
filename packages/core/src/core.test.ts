import { describe, expect, it } from 'vitest';
import { normalizeQuery, queryVariants, isHebrew } from './hebrew.ts';
import { decodePolyline, encodePolyline } from './polyline.ts';
import { parseUrl, buildUrl, viewHash } from './url-state.ts';
import { distance, bearing, bboxOf, inBBox, snapToLine, lineLength, circle } from './geo.ts';
import { formatDistance, formatDuration, formatArrival, formatCoords } from './format.ts';
import { osmPlaceId, pointPlaceId, parsePlaceId } from './ids.ts';
import { regionAt } from './region.ts';
import type { LngLat } from './types.ts';

describe('hebrew', () => {
  it('detects hebrew', () => {
    expect(isHebrew('תל אביב')).toBe(true);
    expect(isHebrew('London')).toBe(false);
  });
  it('strips niqqud and unifies geresh', () => {
    expect(normalizeQuery('שָׁלוֹם')).toBe('שלום');
    expect(normalizeQuery('רח׳ הרצל')).toBe('רחוב הרצל');
    expect(normalizeQuery('ת״א')).toBe('תל אביב');
  });
  it('expands abbreviations and spelling variants', () => {
    expect(normalizeQuery('פ"ת')).toBe('פתח תקווה');
    expect(normalizeQuery('קרית   שמונה')).toBe('קריית שמונה');
    expect(normalizeQuery('פתח תקוה')).toBe('פתח תקווה');
    expect(normalizeQuery('רח\' הרצל, ת"א')).toBe('רחוב הרצל, תל אביב');
  });
  it('leaves non-hebrew text alone', () => {
    expect(normalizeQuery('  Main   St ')).toBe('Main St');
  });
  it('builds retry variants', () => {
    expect(queryVariants('פיצה בתל אביב')).toContain('פיצה תל אביב');
    expect(queryVariants('לירושלים')).toContain('ירושלים');
    expect(queryVariants('קפה ליד הים')).toContain('קפה הים');
    expect(queryVariants('pizza')).toEqual([]);
  });
});

describe('polyline', () => {
  it('round-trips', () => {
    const pts: LngLat[] = [[34.78, 32.08], [34.791234, 32.0912], [35.2, 31.77]];
    const back = decodePolyline(encodePolyline(pts));
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(pts[i][0], 6);
      expect(p[1]).toBeCloseTo(pts[i][1], 6);
    });
  });
  it('decodes precision 5 (Google sample)', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  });
});

describe('url-state', () => {
  it('parses view, place, route from me and mode', () => {
    const s = parseUrl('https://x.test/app/?place=osm:n123&route=me;34.8,32.1&mode=walk#15/32.08/34.78/10/45');
    expect(s.view).toEqual({ zoom: 15, center: [34.78, 32.08], bearing: 10, pitch: 45 });
    expect(s.place).toBe('osm:n123');
    expect(s.fromMe).toBe(true);
    expect(s.route).toEqual([[34.8, 32.1]]);
    expect(s.mode).toBe('walk');
  });
  it('rejects bad input', () => {
    const s = parseUrl('https://x.test/?route=1,2&mode=plane#99/500/1');
    expect(s.view).toBeUndefined();
    expect(s.route).toBeUndefined();
    expect(s.mode).toBeUndefined();
  });
  it('keeps hebrew query', () => {
    expect(parseUrl('https://x.test/?q=' + encodeURIComponent('פיצה')).q).toBe('פיצה');
  });
  it('round-trips through buildUrl', () => {
    const state = { place: 'pt:34.1,32.2', route: [[34.8, 32.1], [35.2, 31.7]] as LngLat[], mode: 'bike' as const, view: { zoom: 12, center: [34.78, 32.08] as LngLat } };
    const url = buildUrl('https://x.test/app/', state);
    expect(url).toContain('route=34.8,32.1;35.2,31.7');
    const back = parseUrl(url);
    expect(back.route).toEqual(state.route);
    expect(back.mode).toBe('bike');
    expect(back.place).toBe('pt:34.1,32.2');
    expect(back.view?.zoom).toBe(12);
  });
  it('omits default car mode and adds bearing only when set', () => {
    expect(buildUrl('https://x.test/', { mode: 'car' })).not.toContain('mode=');
    expect(viewHash(10, [34.78, 32.08])).toBe('#10/32.08/34.78');
    expect(viewHash(10, [34.78, 32.08], 90, 0)).toBe('#10/32.08/34.78/90/0');
  });
});

describe('geo', () => {
  const tlv: LngLat = [34.7818, 32.0853];
  const jlm: LngLat = [35.2137, 31.7683];
  it('measures distance', () => {
    expect(distance(tlv, jlm) / 1000).toBeGreaterThan(52);
    expect(distance(tlv, jlm) / 1000).toBeLessThan(56);
    expect(distance(tlv, tlv)).toBe(0);
  });
  it('computes bearing', () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0, 0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90, 0);
  });
  it('handles bboxes', () => {
    const b = bboxOf([tlv, jlm]);
    expect(b).toEqual([34.7818, 31.7683, 35.2137, 32.0853]);
    expect(inBBox([35, 32], b)).toBe(true);
    expect(inBBox([36, 32], b)).toBe(false);
  });
  it('snaps to a line', () => {
    const line: LngLat[] = [[0, 0], [0.01, 0], [0.02, 0]];
    const s = snapToLine([0.015, 0.0001], line);
    expect(s.index).toBe(1);
    expect(s.point[0]).toBeCloseTo(0.015, 5);
    expect(s.distanceM).toBeLessThan(20);
    expect(lineLength(line)).toBeCloseTo(distance([0, 0], [0.02, 0]), 0);
  });
  it('draws a closed circle', () => {
    const c = circle(tlv, 100, 16);
    expect(c[0]).toEqual(c[c.length - 1]);
    expect(distance(tlv, c[3])).toBeCloseTo(100, -1);
  });
});

describe('format', () => {
  it('formats metric distance in hebrew', () => {
    expect(formatDistance(3)).toBe('5 מ׳');
    expect(formatDistance(347)).toBe('350 מ׳');
    expect(formatDistance(2345)).toBe('2.3 ק״מ');
    expect(formatDistance(23456)).toBe('23 ק״מ');
  });
  it('formats imperial distance', () => {
    expect(formatDistance(100, 'imperial')).toBe('330 רגל');
    expect(formatDistance(16093.44, 'imperial')).toBe('10 מייל');
  });
  it('formats durations', () => {
    expect(formatDuration(10)).toBe('1 דק׳');
    expect(formatDuration(45 * 60)).toBe('45 דק׳');
    expect(formatDuration(3600)).toBe('1 שע׳');
    expect(formatDuration(5400)).toBe('1 שע׳ 30 דק׳');
    expect(formatDuration(26 * 3600)).toBe('1 ימים 2 שע׳');
  });
  it('formats arrival and coords', () => {
    expect(formatArrival(600, Date.UTC(2026, 0, 1, 10, 0), 'UTC')).toBe('10:10');
    expect(formatCoords(34.7818, 32.0853)).toBe('32.08530, 34.78180');
  });
});

describe('ids & region', () => {
  it('builds and parses place ids', () => {
    expect(osmPlaceId('node', 5)).toBe('osm:n5');
    expect(parsePlaceId('osm:w12')).toEqual({ osm: { type: 'way', id: 12 } });
    expect(parsePlaceId(pointPlaceId(34.78, 32.08)).point).toEqual([34.78, 32.08]);
    expect(parsePlaceId('garbage')).toEqual({});
  });
  it('finds a region', () => {
    expect(regionAt([34.78, 32.08]).id).toBe('il');
    expect(regionAt([-0.12, 51.5]).id).toBe('gb');
    expect(regionAt([150, -30]).id).toBe('world');
  });
});
