import { bearing, distance, snapToLine, type LngLat, type Route, type RouteStep } from '@nm/core';

/** Pure navigation math, separate from UI so it can be unit-tested. */
export interface Progress {
  /** Index of the route segment we're on. */
  segment: number;
  snapped: LngLat;
  offRouteM: number;
  /** Meters travelled along the route. */
  doneM: number;
  remainingM: number;
  remainingS: number;
  /** Next maneuver (the one to announce), and meters until it. */
  next: RouteStep | null;
  nextIndex: number;
  toNextM: number;
  /** The maneuver after next, for "then turn left". */
  after: RouteStep | null;
  /** Direction of travel along the route here, degrees. */
  course: number;
  arrived: boolean;
}

export function cumulative(geometry: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < geometry.length; i++) cum.push(cum[i - 1] + distance(geometry[i - 1], geometry[i]));
  return cum;
}

export function progressOn(route: Route, cum: number[], pos: LngLat, lastSegment = 0): Progress {
  const g = route.geometry;
  const total = cum[cum.length - 1] || 1;
  // Search near where we were first (cheap, avoids jumping to a parallel road), then everywhere.
  const windowStart = Math.max(0, lastSegment - 5);
  let snap = snapToLine(pos, g.slice(0, Math.min(g.length, lastSegment + 200)), windowStart);
  if (snap.distanceM > 60) {
    const all = snapToLine(pos, g, 0);
    if (all.distanceM < snap.distanceM) snap = all;
  }
  const seg = snap.index;
  const doneM = cum[seg] + distance(g[seg], snap.point);
  const remainingM = Math.max(0, total - doneM);
  let nextIndex = route.steps.findIndex((s) => s.shapeIndex > seg || (s.shapeIndex === seg && cum[s.shapeIndex] > doneM));
  if (nextIndex === -1) nextIndex = route.steps.length - 1;
  const next = route.steps[nextIndex] ?? null;
  const toNextM = next ? Math.max(0, cum[Math.min(next.shapeIndex, cum.length - 1)] - doneM) : remainingM;
  const after = route.steps[nextIndex + 1] ?? null;
  const course = seg < g.length - 1 ? bearing(g[seg], g[seg + 1]) : 0;
  return {
    segment: seg,
    snapped: snap.point,
    offRouteM: snap.distanceM,
    doneM,
    remainingM,
    remainingS: route.durationS * (remainingM / total),
    next,
    nextIndex,
    toNextM,
    after,
    course,
    arrived: remainingM < 25,
  };
}

/** Announcement distances (meters before the maneuver) by mode. */
export const PROMPTS: Record<Route['mode'], number[]> = {
  car: [1500, 400, 80],
  bike: [300, 60],
  walk: [120, 25],
};

/** Which prompt (index into PROMPTS) should fire now, if any, given what was already said for this step. */
export function promptDue(mode: Route['mode'], toNextM: number, said: Set<number>): number | null {
  const list = PROMPTS[mode];
  for (let i = list.length - 1; i >= 0; i--) {
    if (toNextM <= list[i] && !said.has(i)) {
      // Skip the far prompts once we're already close.
      for (let j = 0; j < i; j++) said.add(j);
      return i;
    }
  }
  return null;
}
