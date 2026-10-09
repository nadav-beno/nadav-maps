import { describe, expect, it } from 'vitest';
import type { LngLat, Route } from '@nm/core';
import { cumulative, progressOn, promptDue } from './engine.ts';

// An L-shaped route: east ~1.9 km, then north ~1.1 km.
const geometry: LngLat[] = [[34.78, 32.08], [34.79, 32.08], [34.8, 32.08], [34.8, 32.09]];
const route: Route = {
  mode: 'car',
  distanceM: 3000,
  durationS: 300,
  geometry,
  steps: [
    { type: 1, instruction: 'צאו לדרך', distanceM: 1900, durationS: 190, shapeIndex: 0 },
    { type: 15, instruction: 'פנו שמאלה', distanceM: 1100, durationS: 110, shapeIndex: 2 },
    { type: 4, instruction: 'הגעתם ליעד', distanceM: 0, durationS: 0, shapeIndex: 3 },
  ],
};
const cum = cumulative(geometry);

describe('navigation engine', () => {
  it('tracks progress and the next maneuver', () => {
    const p = progressOn(route, cum, [34.785, 32.0801]);
    expect(p.segment).toBe(0);
    expect(p.offRouteM).toBeLessThan(20);
    expect(p.next?.type).toBe(15);
    expect(p.toNextM).toBeGreaterThan(1300);
    expect(p.toNextM).toBeLessThan(1500);
    expect(p.after?.type).toBe(4);
    expect(p.course).toBeCloseTo(90, 0);
    expect(p.arrived).toBe(false);
  });
  it('detects off-route and arrival', () => {
    expect(progressOn(route, cum, [34.785, 32.085]).offRouteM).toBeGreaterThan(400);
    const end = progressOn(route, cum, [34.8, 32.0899], 2);
    expect(end.arrived).toBe(true);
    expect(end.next?.type).toBe(4);
  });
  it('prefers the segment near the last one', () => {
    const p = progressOn(route, cum, [34.8, 32.085], 2);
    expect(p.segment).toBe(2);
    expect(p.remainingS).toBeGreaterThan(0);
  });
  it('fires each prompt once and skips far prompts when already close', () => {
    const said = new Set<number>();
    expect(promptDue('car', 2000, said)).toBeNull();
    expect(promptDue('car', 1400, said)).toBe(0);
    said.add(0); // the caller marks what it spoke
    expect(promptDue('car', 1300, said)).toBeNull();
    expect(promptDue('car', 70, said)).toBe(2);
    said.add(2);
    expect(said.has(1)).toBe(true);
    expect(promptDue('car', 50, said)).toBeNull();
  });
});
