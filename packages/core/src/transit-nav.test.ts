import { describe, expect, it } from 'vitest';
import { startTransitNav, transitAlertText, updateTransitNav, type TransitNavState } from './transit-nav.ts';
import type { LngLat, TransitItinerary, TransitLeg } from './types.ts';

// A straight east-west journey: walk 300 m to the stop, ride 3 km (6 stops), walk 200 m.
const LAT = 32.08;
const M = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const at = (m: number): LngLat => [34.78 + m * M, LAT];
const T0 = Date.parse('2026-11-15T08:00:00Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const stop = (name: string, m: number) => ({ name, lng: at(m)[0], lat: LAT });
const leg = (kind: 'walk' | 'ride', a: [string, number], b: [string, number], s: number, e: number, extra: Partial<TransitLeg> = {}): TransitLeg => ({
  kind,
  from: stop(...a),
  to: stop(...b),
  start: iso(s),
  end: iso(e),
  scheduledStart: iso(s),
  scheduledEnd: iso(e),
  realtime: false,
  geometry: Array.from({ length: 11 }, (_, i) => at(a[1] + ((b[1] - a[1]) * i) / 10)),
  ...extra,
});
const it_: TransitItinerary = {
  start: iso(0),
  end: iso(20),
  durationS: 1200,
  transfers: 0,
  walkM: 500,
  legs: [
    leg('walk', ['מוצא', 0], ['דיזנגוף סנטר', 300], 0, 5),
    leg('ride', ['דיזנגוף סנטר', 300], ['עזריאלי', 3300], 6, 16, { line: '5', headsign: 'תחנה מרכזית', stops: 6 }),
    leg('walk', ['עזריאלי', 3300], ['יעד', 3500], 16, 20),
  ],
};

function run(steps: [number, number][]): { state: TransitNavState; alerts: string[] } {
  let state = startTransitNav(it_);
  const alerts: string[] = [];
  for (const [m, min] of steps) {
    const r = updateTransitNav(it_, state, at(m), T0 + min * 60_000);
    state = r.state;
    alerts.push(...r.alerts);
  }
  return { state, alerts };
}

describe('transit navigation', () => {
  it('starts on the first walk', () => {
    const s = startTransitNav(it_);
    expect(s.phase).toBe('walk');
    expect(Math.round(s.toEndM)).toBe(300);
  });

  it('tells you to leave when walking would miss the bus', () => {
    const early = run([[0, -10]]);
    expect(early.alerts).not.toContain('leave-now');
    const late = run([[0, 3]]);
    expect(late.alerts).toContain('leave-now');
    expect(late.state.walkS).toBeCloseTo(240, -1);
  });

  it('waits at the stop, then boards, rides and gets off', () => {
    const r = run([
      [0, 0],
      [295, 4.5],
    ]);
    expect(r.state.phase).toBe('wait');
    expect(r.alerts).toContain('bus-soon');
    const ride = run([
      [0, 0],
      [295, 4.5],
      [320, 6.2],
      [1800, 11],
    ]);
    expect(ride.alerts).toContain('board');
    expect(ride.state.phase).toBe('ride');
    expect(ride.state.stopsLeft).toBe(3);
    const end = run([
      [0, 0],
      [295, 4.5],
      [320, 6.2],
      [1800, 11],
      [2750, 14.5],
      [3200, 15.5],
    ]);
    expect(end.alerts).toContain('get-off-next');
    expect(end.alerts).toContain('get-off');
    expect(end.state.stopsLeft).toBe(0);
  });

  it('raises each alert once', () => {
    const r = run([
      [0, 3],
      [10, 3.1],
      [20, 3.2],
    ]);
    expect(r.alerts.filter((a) => a === 'leave-now')).toHaveLength(1);
  });

  it('walks to the destination after the ride and arrives', () => {
    const r = run([
      [0, 0],
      [300, 5],
      [320, 6.2],
      [3280, 16],
      [3400, 18],
      [3490, 20],
    ]);
    expect(r.alerts).toContain('arrived');
    expect(r.state.phase).toBe('arrived');
  });

  it('speaks Hebrew', () => {
    const s = startTransitNav(it_);
    expect(transitAlertText('leave-now', it_, s)).toBe('צאו עכשיו לתחנה דיזנגוף סנטר כדי לתפוס את קו 5');
    expect(transitAlertText('board', it_, { ...s, leg: 1 })).toBe('עלו על קו 5 לכיוון תחנה מרכזית');
    expect(transitAlertText('get-off-next', it_, { ...s, leg: 1 })).toBe('רדו בתחנה הבאה: עזריאלי');
  });
});
