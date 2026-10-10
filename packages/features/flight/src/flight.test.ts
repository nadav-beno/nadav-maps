import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWorld, type WorldFile } from '@nm/core';
import { aboveText, altitudeReadout, compassName, distanceReadout, formatElapsed, formatLatLng, headingReadout, speedReadout } from './format.ts';
import { addFix, etaSeconds, newLog, type Fix } from './track.ts';

const world = decodeWorld(JSON.parse(readFileSync(new URL('../../../../apps/web/public/offline/world-1.json', import.meta.url), 'utf8')) as WorldFile);

const fix = (lng: number, lat: number, t: number, extra: Partial<Fix> = {}): Fix => ({
  lngLat: [lng, lat],
  t,
  accuracy: 10,
  altitude: null,
  speed: null,
  heading: null,
  ...extra,
});

describe('flight readouts', () => {
  it('formats speed in the region units, with knots', () => {
    expect(speedReadout(250, 'metric')).toEqual({ value: '900', unit: 'קמ״ש', sub: '486 קשר' });
    expect(speedReadout(250, 'imperial')).toEqual({ value: '559', unit: 'מייל/שעה', sub: '486 קשר' });
    expect(speedReadout(null, 'metric').value).toBe('—');
  });

  it('formats altitude in meters and feet', () => {
    expect(altitudeReadout(10668, 'metric')).toEqual({ value: '10,668', unit: 'מ׳', sub: '35,000 רגל' });
    expect(altitudeReadout(10668, 'imperial')).toEqual({ value: '35,000', unit: 'רגל', sub: '10,668 מ׳' });
    expect(altitudeReadout(null, 'metric').sub).toBe('הגובה לא זמין');
  });

  it('names headings and coordinates', () => {
    expect(compassName(0)).toBe('צפון');
    expect(compassName(359)).toBe('צפון');
    expect(compassName(135)).toBe('דרום-מזרח');
    expect(compassName(-90)).toBe('מערב');
    expect(headingReadout(275.6)).toEqual({ value: '276°', unit: '', sub: 'מערב' });
    expect(formatLatLng([-73.7781, 40.6413])).toBe('40.6413° N, 73.7781° W');
    expect(formatLatLng([151.17, -33.94])).toBe('33.9400° S, 151.1700° E');
  });

  it('formats distances and elapsed time', () => {
    expect(distanceReadout(1234567, 'metric')).toEqual({ value: '1,235', unit: 'ק״מ' });
    expect(distanceReadout(5200, 'metric')).toEqual({ value: '5.2', unit: 'ק״מ' });
    expect(distanceReadout(1609344, 'imperial')).toEqual({ value: '1,000', unit: 'מייל' });
    expect(formatElapsed(3 * 3600_000 + 5 * 60_000 + 59_000)).toBe('3:05');
  });

  it('says what you are flying over, offline', () => {
    expect(aboveText(world, [23.75, 37.98], 'metric')).toEqual({ title: 'יוון', near: 'מעל אתונה' });
    const sea = aboveText(world, [33, 34], 'metric');
    expect(sea.title).toBe('מעל הים');
    expect(sea.near).toMatch(/^\d+ ק״מ מ/);
    const usa = aboveText(world, [-100, 40], 'imperial');
    expect(usa.title).toBe('ארצות הברית');
    expect(usa.near).toMatch(/מייל/);
  });
});

describe('flight log', () => {
  it('adds up distance and derives speed and heading', () => {
    let log = newLog(0);
    log = addFix(log, fix(34, 32, 0));
    log = addFix(log, fix(34.1, 32, 40_000)); // ~9.4 km east in 40 s
    expect(log.distanceM).toBeGreaterThan(9000);
    expect(log.distanceM).toBeLessThan(10000);
    expect(log.speedMs).toBeGreaterThan(230);
    expect(log.speedMs).toBeLessThan(240);
    expect(log.heading).toBeCloseTo(90, 0);
    expect(log.track).toHaveLength(2);
  });

  it('ignores jitter, jumps and bad fixes', () => {
    let log = newLog(0);
    log = addFix(log, fix(34, 32, 0));
    log = addFix(log, fix(34.0001, 32, 1000)); // 9 m: jitter
    expect(log.distanceM).toBe(0);
    log = addFix(log, fix(40, 32, 2000)); // 570 km in a second
    expect(log.distanceM).toBe(0);
    const before = log;
    expect(addFix(log, fix(35, 32, 3000, { accuracy: 5000 }))).toBe(before);
    expect(addFix(log, fix(NaN, 32, 3000))).toBe(before);
  });

  it('prefers the GPS speed and heading when given', () => {
    let log = newLog(0);
    log = addFix(log, fix(34, 32, 0, { speed: 240, heading: 300, altitude: 11000 }));
    expect(log.speedMs).toBe(240);
    expect(log.heading).toBe(300);
    expect(log.last?.altitude).toBe(11000);
  });

  it('estimates arrival only when moving', () => {
    expect(etaSeconds(900_000, 250)).toBe(3600);
    expect(etaSeconds(900_000, 3)).toBeNull();
    expect(etaSeconds(900_000, null)).toBeNull();
  });
});
