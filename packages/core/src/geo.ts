import type { BBox, LngLat } from './types.ts';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function distance(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0..360). */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function inBBox(p: LngLat, b: BBox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

export function bboxOf(points: LngLat[]): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** A small circle polygon (for accuracy rings), `steps` points. */
export function circle(center: LngLat, radiusM: number, steps = 48): LngLat[] {
  const out: LngLat[] = [];
  const latR = radiusM / 111320;
  const lngR = radiusM / (111320 * Math.cos(rad(center[1])) || 1);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    out.push([center[0] + lngR * Math.cos(t), center[1] + latR * Math.sin(t)]);
  }
  return out;
}

/**
 * Snap a point to the nearest segment of a line.
 * Returns the snapped point, the distance to it in meters, and the index of the segment start.
 */
export function snapToLine(p: LngLat, line: LngLat[], fromIndex = 0): { point: LngLat; distanceM: number; index: number } {
  let best = { point: line[0] ?? p, distanceM: Infinity, index: 0 };
  const cosLat = Math.cos(rad(p[1]));
  for (let i = Math.max(0, fromIndex); i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    // Project in a local equirectangular plane; accurate enough at route scale.
    const ax = a[0] * cosLat, ay = a[1], bx = b[0] * cosLat, by = b[1], px = p[0] * cosLat, py = p[1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const q: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = distance(p, q);
    if (d < best.distanceM) best = { point: q, distanceM: d, index: i };
  }
  return best;
}

/** Length of a line from point index `from` to the end, in meters. */
export function lineLength(line: LngLat[], from = 0, to = line.length - 1): number {
  let sum = 0;
  for (let i = Math.max(0, from); i < Math.min(to, line.length - 1); i++) sum += distance(line[i], line[i + 1]);
  return sum;
}
