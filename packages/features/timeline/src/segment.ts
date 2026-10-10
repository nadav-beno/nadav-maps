import { distance, type LngLat } from '@nm/core';
import type { Mode, Move, Seg, Stay, TrackPoint } from './types.ts';

/**
 * Turning raw GPS fixes into a day: stays (you were somewhere for a while) and moves
 * (between stays, split by how you travelled). Pure functions, no I/O.
 */

/** Fixes worse than this are noise indoors / in tunnels. */
export const MAX_ACCURACY_M = 100;
export const STAY_RADIUS_M = 100;
export const STAY_MIN_MS = 5 * 60_000;
/** While moving, keep a fix at most every 10 s and 15 m. */
export const THIN_MIN_MS = 10_000;
export const THIN_MIN_M = 15;
/** While standing still, one fix a minute keeps the stay's end time right. */
export const STILL_HEARTBEAT_MS = 60_000;

const ll = (p: TrackPoint): LngLat => [p.lng, p.lat];

/** Whether to store fix `p`, given the last stored fix. */
export function keepPoint(prev: TrackPoint | undefined, p: TrackPoint): boolean {
  if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat) || !Number.isFinite(p.t)) return false;
  if (p.acc !== undefined && p.acc > MAX_ACCURACY_M) return false;
  if (!prev) return true;
  const dt = p.t - prev.t;
  if (dt <= 0) return false;
  const d = distance(ll(prev), ll(p));
  if (d >= THIN_MIN_M) return dt >= THIN_MIN_MS;
  return dt >= STILL_HEARTBEAT_MS;
}

/** Sort, drop inaccurate fixes and thin a batch (imports, or a day's worth of fixes). */
export function thin(points: TrackPoint[], prev?: TrackPoint): TrackPoint[] {
  const out: TrackPoint[] = [];
  let last = prev;
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    if (keepPoint(last, p)) {
      out.push(p);
      last = p;
    }
  }
  return out;
}

export function pathDistance(path: LngLat[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += distance(path[i - 1], path[i]);
  return d;
}

/** km/h between consecutive fixes (reported speed when the device gave one). */
function stepSpeeds(pts: TrackPoint[]): { kmh: number; ms: number }[] {
  const out: { kmh: number; ms: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    if (dt <= 0) continue;
    const measured = (distance(ll(pts[i - 1]), ll(pts[i])) / (dt / 1000)) * 3.6;
    const reported = pts[i].speed;
    // Reported speed is better for short steps; long gaps only have the average.
    const kmh = reported !== null && reported !== undefined && reported >= 0 && dt < 120_000 ? reported * 3.6 : measured;
    out.push({ kmh, ms: dt });
  }
  return out;
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/**
 * Rough mode from speeds. Thresholds (km/h): walking up to ~7, cycling up to ~25, road
 * vehicles up to ~130, then trains, and anything over 250 (or climbing more than a
 * kilometre) is a flight.
 */
export function classifyMove(pts: TrackPoint[]): Mode {
  if (pts.length < 2) return 'unknown';
  const dur = (pts[pts.length - 1].t - pts[0].t) / 1000;
  if (dur <= 0) return 'unknown';
  const dist = pathDistance(pts.map(ll));
  const avg = (dist / dur) * 3.6;
  const p90 = percentile(stepSpeeds(pts).map((s) => s.kmh), 0.9);
  const alts = pts.map((p) => p.alt).filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
  const altJump = alts.length >= 2 && Math.max(...alts) - Math.min(...alts) > 1000;
  if (p90 > 250 || avg > 200 || altJump) return 'flight';
  if (p90 >= 130 || avg >= 110) return 'train';
  if (p90 >= 28 || avg >= 22) return 'car';
  if (p90 >= 10 || avg >= 7.5) return 'bike';
  return 'walk';
}

function stepMode(kmh: number): Mode {
  return kmh < 7 ? 'walk' : kmh < 25 ? 'bike' : kmh < 130 ? 'car' : kmh < 250 ? 'train' : 'flight';
}

/** Split one move's fixes where the speed changes for good (walk to the car, drive, walk). */
export function splitByMode(pts: TrackPoint[], minRunMs = 3 * 60_000): TrackPoint[][] {
  if (pts.length < 3) return [pts];
  const sp = stepSpeeds(pts).map((s) => s.kmh);
  if (sp.length !== pts.length - 1) return [pts];
  // Median over five steps hides traffic lights and GPS spikes.
  const smooth = sp.map((_, i) => percentile(sp.slice(Math.max(0, i - 2), i + 3), 0.5));
  type Run = { from: number; to: number; mode: Mode };
  let runs: Run[] = [];
  smooth.forEach((v, i) => {
    const m = stepMode(v);
    const last = runs[runs.length - 1];
    if (last && last.mode === m) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, mode: m });
  });
  const dur = (r: Run) => pts[r.to].t - pts[r.from].t;
  // Fold short runs into the longer neighbour until every run is long enough.
  for (let guard = 0; runs.length > 1 && guard < 1000; guard++) {
    let k = -1;
    for (let i = 0; i < runs.length; i++) if (dur(runs[i]) < minRunMs && (k < 0 || dur(runs[i]) < dur(runs[k]))) k = i;
    if (k < 0) break;
    const prev = runs[k - 1];
    const next = runs[k + 1];
    const into = !prev ? next : !next ? prev : dur(prev) >= dur(next) ? prev : next;
    into.from = Math.min(into.from, runs[k].from);
    into.to = Math.max(into.to, runs[k].to);
    runs.splice(k, 1);
    const merged: Run[] = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && last.mode === r.mode) last.to = r.to;
      else merged.push(r);
    }
    runs = merged;
  }
  return runs.map((r) => pts.slice(r.from, r.to + 1));
}

function centroid(pts: TrackPoint[]): LngLat {
  let x = 0, y = 0;
  for (const p of pts) {
    x += p.lng;
    y += p.lat;
  }
  return [x / pts.length, y / pts.length];
}

export interface SegmentOptions {
  radiusM?: number;
  minStayMs?: number;
}

/**
 * Stays and moves from a list of fixes. A stay is a run of fixes within `radiusM` of
 * their centre for at least `minStayMs` (gaps count: the app was closed while you sat
 * there). Everything between stays is a move, split by mode.
 */
export function segment(input: TrackPoint[], opts: SegmentOptions = {}): Seg[] {
  const R = opts.radiusM ?? STAY_RADIUS_M;
  const MIN = opts.minStayMs ?? STAY_MIN_MS;
  const pts = input.filter((p) => p.acc === undefined || p.acc <= MAX_ACCURACY_M).sort((a, b) => a.t - b.t);
  const n = pts.length;
  if (!n) return [];

  type Cluster = { i: number; j: number; c: LngLat };
  const clusters: Cluster[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    let cx = pts[i].lng, cy = pts[i].lat, k = 1;
    while (j + 1 < n && distance([cx, cy], ll(pts[j + 1])) <= R) {
      j++;
      cx = (cx * k + pts[j].lng) / (k + 1);
      cy = (cy * k + pts[j].lat) / (k + 1);
      k++;
    }
    if (pts[j].t - pts[i].t >= MIN) {
      clusters.push({ i, j, c: [cx, cy] });
      i = j + 1;
    } else i++;
  }

  // Two stays at the same spot with only wobble in between are one stay.
  const merged: Cluster[] = [];
  for (const c of clusters) {
    const last = merged[merged.length - 1];
    if (last && distance(last.c, c.c) <= R) {
      const between = pts.slice(last.j + 1, c.i);
      if (between.every((p) => distance(last.c, ll(p)) <= 2 * R)) {
        last.j = c.j;
        last.c = centroid(pts.slice(last.i, c.j + 1));
        continue;
      }
    }
    merged.push({ ...c });
  }

  const out: Seg[] = [];
  const pushMove = (from: number, to: number) => {
    const span = pts.slice(from, to + 1);
    if (span.length < 2) return;
    for (const part of splitByMode(span)) {
      const path = part.map(ll);
      const d = pathDistance(path);
      if (part.length < 2 || d < 50) continue;
      const m: Move = {
        kind: 'move',
        id: `m:${part[0].t}`,
        start: part[0].t,
        end: part[part.length - 1].t,
        mode: classifyMove(part),
        distanceM: d,
        path,
        source: 'gps',
      };
      const last = out[out.length - 1];
      if (last?.kind === 'move' && last.mode === m.mode) {
        last.end = m.end;
        last.path = [...last.path, ...m.path.slice(1)];
        last.distanceM += m.distanceM;
      } else out.push(m);
    }
  };

  let cursor = 0;
  for (const c of merged) {
    // The move runs from the last fix of the previous stay to the first fix of this one.
    pushMove(cursor, c.i);
    const stay: Stay = {
      kind: 'stay',
      id: `s:${pts[c.i].t}`,
      start: pts[c.i].t,
      end: pts[c.j].t,
      lng: c.c[0],
      lat: c.c[1],
      source: 'gps',
    };
    out.push(stay);
    cursor = c.j;
  }
  pushMove(cursor, n - 1);
  return out;
}

/** Segments that touch [from, to). */
export function overlapping<T extends { start: number; end: number }>(segs: T[], from: number, to: number): T[] {
  return segs.filter((s) => s.end > from && s.start < to);
}

/**
 * Combine imported (Google) segments with ones computed from recorded fixes. Imported
 * history wins where both cover the same time.
 */
export function mergeSegments(imported: Seg[], computed: Seg[]): Seg[] {
  const kept = computed.filter((c) => {
    const len = Math.max(1, c.end - c.start);
    let covered = 0;
    for (const g of imported) covered += Math.max(0, Math.min(c.end, g.end) - Math.max(c.start, g.start));
    return covered / len < 0.5;
  });
  return [...imported, ...kept].sort((a, b) => a.start - b.start || (a.kind === 'stay' ? -1 : 1));
}

export interface DaySummary {
  distanceM: number;
  places: number;
  movingMs: number;
  byMode: Partial<Record<Mode, number>>;
}

/** Totals for the part of the segments inside [from, to). */
export function summarize(segs: Seg[], from: number, to: number): DaySummary {
  const s: DaySummary = { distanceM: 0, places: 0, movingMs: 0, byMode: {} };
  for (const g of overlapping(segs, from, to)) {
    if (g.kind === 'stay') {
      s.places++;
      continue;
    }
    const total = Math.max(1, g.end - g.start);
    const inside = Math.min(g.end, to) - Math.max(g.start, from);
    const share = Math.max(0, Math.min(1, inside / total));
    s.distanceM += g.distanceM * share;
    s.movingMs += inside;
    s.byMode[g.mode] = (s.byMode[g.mode] ?? 0) + g.distanceM * share;
  }
  return s;
}
