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

/** Length of a path in meters; `closed` adds the segment from the last point back to the first. */
export function pathLength(points: LngLat[], closed = false): number {
  const open = lineLength(points);
  return closed && points.length > 2 ? open + distance(points[points.length - 1], points[0]) : open;
}

/**
 * Area of a polygon ring on the sphere, in square meters (always positive).
 * The ring may or may not repeat its first point. Same method as d3-geo and turf
 * (Chamberlain & Duquette, "Some algorithms for polygons on a sphere", 2007).
 */
export function ringArea(ring: LngLat[]): number {
  const first = ring[0], last = ring[ring.length - 1];
  const pts = ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  const n = pts.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    sum += rad(b[0] - a[0]) * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
  }
  return Math.abs((sum * R * R) / 2);
}

/**
 * Points along the great circle from a to b (both included), at most `stepM` meters apart,
 * so a long measured line is drawn as the true shortest path, not a straight Mercator line.
 */
export function greatCircle(a: LngLat, b: LngLat, stepM = 20000): LngLat[] {
  const d = distance(a, b);
  const steps = Math.min(256, Math.ceil(d / stepM));
  if (steps <= 1) return [a, b];
  const φ1 = rad(a[1]), λ1 = rad(a[0]), φ2 = rad(b[1]), λ2 = rad(b[0]);
  const δ = d / R;
  const out: LngLat[] = [a];
  let prevLng = a[0];
  // Keep longitudes continuous across the antimeridian so the line doesn't wrap the globe.
  const near = (lng: number) => {
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    return lng;
  };
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * δ) / Math.sin(δ);
    const B = Math.sin(f * δ) / Math.sin(δ);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    prevLng = near((Math.atan2(y, x) * 180) / Math.PI);
    out.push([prevLng, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI]);
  }
  out.push([near(b[0]), b[1]]);
  return out;
}
