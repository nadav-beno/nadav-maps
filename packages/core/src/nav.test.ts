import { describe, expect, it } from 'vitest';
import { isNight, lanesAt, laneIcon, plausibleFix, speedLimitAt, sunAltitude, zoomForSpeed } from './nav.ts';

describe('plausibleFix', () => {
  const tlv = { lng: 34.78, lat: 32.08, accuracy: 10, timestamp: 0 };
  it('accepts normal movement', () => {
    expect(plausibleFix(tlv, { lng: 34.781, lat: 32.081, accuracy: 10, timestamp: 5000 })).toBe(true);
  });
  it('rejects a jump to Beirut', () => {
    expect(plausibleFix(tlv, { lng: 35.49, lat: 33.82, accuracy: 10, timestamp: 5000 })).toBe(false);
  });
  it('rejects null island', () => {
    expect(plausibleFix(null, { lng: 0, lat: 0, timestamp: 0 })).toBe(false);
  });
  it('allows a long gap', () => {
    expect(plausibleFix(tlv, { lng: 35.21, lat: 31.77, accuracy: 10, timestamp: 3600_000 })).toBe(true);
  });
});

describe('sun', () => {
  it('is high at noon in Tel Aviv in summer, below the horizon at midnight', () => {
    expect(sunAltitude(34.78, 32.08, new Date('2026-06-21T09:40:00Z'))).toBeGreaterThan(70);
    expect(isNight(34.78, 32.08, new Date('2026-06-21T21:00:00Z'))).toBe(true);
    expect(isNight(34.78, 32.08, new Date('2026-06-21T12:00:00Z'))).toBe(false);
  });
});

describe('guidance helpers', () => {
  const g = {
    speedLimits: [{ from: 0, to: 10, kmh: 50 }, { from: 10, to: 30, kmh: 90 }],
    lanes: [{ at: [34.78, 32.08] as [number, number], lanes: [{ indications: ['left'], valid: true }, { indications: ['straight'], valid: false }] }],
  };
  it('finds the speed limit by index', () => {
    expect(speedLimitAt(g, 5)).toBe(50);
    expect(speedLimitAt(g, 12)).toBe(90);
    expect(speedLimitAt(g, 40)).toBeNull();
  });
  it('finds lanes near a turn', () => {
    expect(lanesAt(g, [34.7801, 32.0801])?.length).toBe(2);
    expect(lanesAt(g, [34.79, 32.09])).toBeNull();
    expect(laneIcon(['slight_right'])).toBe('turn_slight_right');
  });
  it('zooms out with speed', () => {
    expect(zoomForSpeed(30, 2000)).toBeLessThan(zoomForSpeed(5, 2000));
    expect(zoomForSpeed(30, 100)).toBe(17.5);
  });
});
