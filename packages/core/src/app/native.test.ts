import { describe, expect, it } from 'vitest';
import { installNativeGeolocation, isNativeApp, toPosition, toPositionError } from './native.ts';

describe('native app bridge', () => {
  it('is off outside the iPhone app', () => {
    expect(isNativeApp()).toBe(false);
    expect(() => installNativeGeolocation()).not.toThrow();
  });

  it('turns a native fix into a web GeolocationPosition', () => {
    const p = toPosition({ latitude: 32.1, longitude: 34.8, accuracy: 5, altitude: 12, altitudeAccuracy: 3, bearing: -1, speed: -1, time: 1000 });
    expect(p.timestamp).toBe(1000);
    expect(p.coords).toMatchObject({ latitude: 32.1, longitude: 34.8, accuracy: 5, altitude: 12, heading: null, speed: null });
    const q = toPosition({ latitude: 0, longitude: 0, accuracy: 1, altitude: null, altitudeAccuracy: null, bearing: 270, speed: 4, time: null });
    expect(q.coords.heading).toBe(270);
    expect(q.coords.speed).toBe(4);
    expect(q.timestamp).toBeGreaterThan(0);
  });

  it('keeps the web error codes', () => {
    expect(toPositionError(1, 'x')).toMatchObject({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 });
  });
});
