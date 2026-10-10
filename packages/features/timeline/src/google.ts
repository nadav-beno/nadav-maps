import type { LngLat } from '@nm/core';
import { pathDistance } from './segment.ts';
import type { Mode, Move, Seg, Stay, StayEdit, TrackPoint } from './types.ts';

/**
 * Readers for Google Maps Timeline exports, run in the browser only (never uploaded):
 *  - the on-device export (Android "Timeline.json": semanticSegments / rawSignals /
 *    userLocationProfile, coordinates as "32.0853°, 34.7818°");
 *  - the iPhone variant of it (a top-level array, "geo:32.0853,34.7818" and numbers as strings);
 *  - the old Takeout "Semantic Location History" monthly files (timelineObjects with
 *    placeVisit / activitySegment, E7 coordinates);
 *  - Takeout "Records.json" (locations[] with latitudeE7 / longitudeE7);
 *  - and our own export file.
 */

export type ImportKind = 'device' | 'ios' | 'semantic' | 'records' | 'nadav' | 'unknown';

export interface ImportResult {
  kind: ImportKind;
  points: TrackPoint[];
  segs: Seg[];
  edits: StayEdit[];
}

export const OWN_FORMAT = 'nadav-maps-timeline';

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const valid = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** E7 integers; old exports overflowed int32 for some longitudes. */
export function fromE7(v: unknown): number | undefined {
  let n = num(v);
  if (n === undefined) return undefined;
  if (n > 1_800_000_000) n -= 4_294_967_296;
  if (n < -1_800_000_000) n += 4_294_967_296;
  return n / 1e7;
}

/** "32.0853°, 34.7818°", "32.0853, 34.7818", "geo:32.0853,34.7818" or {latitudeE7, longitudeE7}. */
export function parseLatLng(v: unknown): LngLat | null {
  if (typeof v === 'string') {
    const m = /^\s*(?:geo:)?\s*(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)\s*°?\s*$/.exec(v);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    return valid(lat, lng) ? [lng, lat] : null;
  }
  if (isObj(v)) {
    if ('latLng' in v) return parseLatLng(v.latLng);
    if ('LatLng' in v) return parseLatLng(v.LatLng);
    const lat = fromE7(v.latitudeE7 ?? v.latE7);
    const lng = fromE7(v.longitudeE7 ?? v.lngE7);
    if (lat !== undefined && lng !== undefined) return valid(lat, lng) ? [lng, lat] : null;
    const lat2 = num(v.latitude ?? v.lat);
    const lng2 = num(v.longitude ?? v.lng);
    if (lat2 !== undefined && lng2 !== undefined) return valid(lat2, lng2) ? [lng2, lat2] : null;
  }
  return null;
}

/** ISO strings, or millisecond strings/numbers (old "timestampMs"). */
export function parseTime(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || !v) return undefined;
  if (/^\d{10,}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

/** Google's activity names (any case, spaces or underscores) to our modes. */
export function googleMode(type: unknown): Mode {
  const t = String(type ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  if (/WALK|ON_FOOT|RUNNING|HIKING/.test(t)) return 'walk';
  if (/MOTOR/.test(t)) return 'car';
  if (/CYCL|BICYCLE|BIKING/.test(t)) return 'bike';
  if (/BUS/.test(t)) return 'bus';
  if (/TRAIN|SUBWAY|TRAM|RAIL|METRO/.test(t)) return 'train';
  if (/FLY|FLIGHT|PLANE/.test(t)) return 'flight';
  if (/FERRY|BOAT|SAIL/.test(t)) return 'boat';
  if (/VEHICLE|CAR|DRIV|TAXI|MOTOR/.test(t)) return 'car';
  return 'unknown';
}

function semantic(v: unknown): 'home' | 'work' | undefined {
  const s = String(v ?? '').toUpperCase();
  if (/HOME/.test(s)) return 'home';
  if (/WORK/.test(s)) return 'work';
  return undefined;
}

function stay(start: number, end: number, at: LngLat, extra: Partial<Stay> = {}): Stay {
  return { kind: 'stay', id: `g:s:${start}`, start, end, lng: at[0], lat: at[1], source: 'google', ...extra };
}

function move(start: number, end: number, mode: Mode, path: LngLat[], distanceM?: number): Move {
  return { kind: 'move', id: `g:m:${start}`, start, end, mode, path, distanceM: distanceM ?? pathDistance(path), source: 'google' };
}

/** Attach timelinePath samples to the move they fall in. */
function attachPaths(segs: Seg[], samples: { t: number; p: LngLat }[]): void {
  if (!samples.length) return;
  samples.sort((a, b) => a.t - b.t);
  for (const s of segs) {
    if (s.kind !== 'move') continue;
    const inside = samples.filter((x) => x.t >= s.start && x.t <= s.end).map((x) => x.p);
    if (!inside.length) continue;
    const first = s.path[0];
    const last = s.path[s.path.length - 1];
    s.path = [...(first ? [first] : []), ...inside, ...(last ? [last] : [])];
    if (!s.distanceM) s.distanceM = pathDistance(s.path);
  }
}

// ---------- on-device export (Android object / iPhone array) ----------

function parseDevice(root: J | J[], kind: 'device' | 'ios'): ImportResult {
  const segments = (Array.isArray(root) ? root : Array.isArray(root.semanticSegments) ? root.semanticSegments : []) as unknown[];
  const segs: Seg[] = [];
  const points: TrackPoint[] = [];
  const samples: { t: number; p: LngLat }[] = [];

  // Home/work from the profile, by Google place id.
  const labels = new Map<string, 'home' | 'work'>();
  const profile = !Array.isArray(root) && isObj(root.userLocationProfile) ? root.userLocationProfile : undefined;
  for (const f of (Array.isArray(profile?.frequentPlaces) ? profile.frequentPlaces : []) as unknown[]) {
    if (!isObj(f)) continue;
    const sem = semantic(f.label);
    if (sem && typeof f.placeId === 'string') labels.set(f.placeId, sem);
  }

  for (const s of segments) {
    if (!isObj(s)) continue;
    const start = parseTime(s.startTime);
    const end = parseTime(s.endTime);
    if (start === undefined || end === undefined || end < start) continue;
    if (isObj(s.visit)) {
      const v = s.visit;
      // Nested visits (a shop inside a mall) overlap their parent; keep the top level.
      if ((num(v.hierarchyLevel) ?? 0) > 0) continue;
      const c = isObj(v.topCandidate) ? v.topCandidate : {};
      const at = parseLatLng(c.placeLocation);
      if (!at) continue;
      const placeId = typeof c.placeId === 'string' ? c.placeId : typeof c.placeID === 'string' ? c.placeID : undefined;
      const sem = semantic(c.semanticType) ?? (placeId ? labels.get(placeId) : undefined);
      segs.push(stay(start, end, at, { semantic: sem, place: placeId ? { name: '', lng: at[0], lat: at[1], googlePlaceId: placeId, source: 'google', semantic: sem } : undefined }));
    } else if (isObj(s.activity)) {
      const a = s.activity;
      const from = parseLatLng(a.start);
      const to = parseLatLng(a.end);
      const c = isObj(a.topCandidate) ? a.topCandidate : {};
      segs.push(move(start, end, googleMode(c.type), [from, to].filter((p): p is LngLat => !!p), num(a.distanceMeters)));
    } else if (Array.isArray(s.timelinePath)) {
      for (const p of s.timelinePath as unknown[]) {
        if (!isObj(p)) continue;
        const at = parseLatLng(p.point);
        const off = num(p.durationMinutesOffsetFromStartTime);
        const t = parseTime(p.time) ?? (off !== undefined ? start + off * 60_000 : undefined);
        if (at && t !== undefined) samples.push({ t, p: at });
      }
    }
  }
  attachPaths(segs, samples);

  if (!Array.isArray(root) && Array.isArray(root.rawSignals)) {
    for (const r of root.rawSignals as unknown[]) {
      if (!isObj(r) || !isObj(r.position)) continue;
      const pos = r.position;
      const at = parseLatLng(pos.LatLng ?? pos.latLng);
      const t = parseTime(pos.timestamp);
      if (!at || t === undefined) continue;
      points.push({ t, lng: at[0], lat: at[1], acc: num(pos.accuracyMeters), alt: num(pos.altitudeMeters) ?? null, speed: num(pos.speedMetersPerSecond) ?? null });
    }
  }
  return { kind, points, segs, edits: [] };
}

// ---------- Takeout Semantic Location History ----------

function duration(d: unknown): [number, number] | null {
  if (!isObj(d)) return null;
  const a = parseTime(d.startTimestamp ?? d.startTimestampMs);
  const b = parseTime(d.endTimestamp ?? d.endTimestampMs);
  return a !== undefined && b !== undefined && b >= a ? [a, b] : null;
}

function parseSemantic(root: J): ImportResult {
  const segs: Seg[] = [];
  for (const o of (root.timelineObjects ?? []) as unknown[]) {
    if (!isObj(o)) continue;
    if (isObj(o.placeVisit)) {
      const v = o.placeVisit;
      const span = duration(v.duration);
      const loc = isObj(v.location) ? v.location : {};
      const at = parseLatLng(loc) ?? parseLatLng({ latitudeE7: v.centerLatE7, longitudeE7: v.centerLngE7 });
      if (!span || !at) continue;
      const sem = semantic(loc.semanticType);
      const name = typeof loc.name === 'string' ? loc.name : '';
      segs.push(
        stay(span[0], span[1], at, {
          semantic: sem,
          place: {
            name,
            lng: at[0],
            lat: at[1],
            address: typeof loc.address === 'string' ? loc.address.replace(/\n/g, ', ') : undefined,
            googlePlaceId: typeof loc.placeId === 'string' ? loc.placeId : undefined,
            source: 'google',
            semantic: sem,
          },
        }),
      );
    } else if (isObj(o.activitySegment)) {
      const a = o.activitySegment;
      const span = duration(a.duration);
      if (!span) continue;
      const from = parseLatLng(a.startLocation);
      const to = parseLatLng(a.endLocation);
      const raw = isObj(a.simplifiedRawPath) && Array.isArray(a.simplifiedRawPath.points) ? (a.simplifiedRawPath.points as unknown[]) : [];
      const way = isObj(a.waypointPath) && Array.isArray(a.waypointPath.waypoints) ? (a.waypointPath.waypoints as unknown[]) : [];
      const mid = (raw.length ? raw : way).map(parseLatLng).filter((p): p is LngLat => !!p);
      const path = [from, ...mid, to].filter((p): p is LngLat => !!p);
      segs.push(move(span[0], span[1], googleMode(a.activityType), path, num(a.distance)));
    }
  }
  return { kind: 'semantic', points: [], segs, edits: [] };
}

// ---------- Takeout Records.json ----------

function parseRecords(root: J): ImportResult {
  const points: TrackPoint[] = [];
  for (const l of (root.locations ?? []) as unknown[]) {
    if (!isObj(l)) continue;
    const at = parseLatLng(l);
    const t = parseTime(l.timestamp ?? l.timestampMs);
    if (!at || t === undefined) continue;
    points.push({ t, lng: at[0], lat: at[1], acc: num(l.accuracy), alt: num(l.altitude) ?? null, speed: num(l.velocity) ?? null });
  }
  return { kind: 'records', points, segs: [], edits: [] };
}

// ---------- our own file ----------

export interface OwnExport {
  format: typeof OWN_FORMAT;
  version: 1;
  exportedAt: string;
  points: TrackPoint[];
  segs: Seg[];
  edits: StayEdit[];
}

export function ownExport(points: TrackPoint[], segs: Seg[], edits: StayEdit[], now = Date.now()): OwnExport {
  return { format: OWN_FORMAT, version: 1, exportedAt: new Date(now).toISOString(), points, segs, edits };
}

function parseOwn(root: J): ImportResult {
  const points = (Array.isArray(root.points) ? root.points : []).filter(
    (p): p is TrackPoint => isObj(p) && typeof p.t === 'number' && typeof p.lng === 'number' && typeof p.lat === 'number' && valid(p.lat, p.lng),
  );
  const segs = (Array.isArray(root.segs) ? root.segs : []).filter(
    (s): s is Seg => isObj(s) && (s.kind === 'stay' || s.kind === 'move') && typeof s.id === 'string' && typeof s.start === 'number' && typeof s.end === 'number',
  );
  const edits = (Array.isArray(root.edits) ? root.edits : []).filter((e): e is StayEdit => isObj(e) && typeof e.id === 'string' && isObj(e.place));
  return { kind: 'nadav', points, segs, edits };
}

/** Detect the format and read it. Unknown shapes return kind "unknown" with nothing in it. */
export function parseTimelineExport(json: unknown): ImportResult {
  if (Array.isArray(json)) {
    const looksLikeDevice = json.some((x) => isObj(x) && ('visit' in x || 'activity' in x || 'timelinePath' in x));
    return looksLikeDevice ? parseDevice(json as J[], 'ios') : { kind: 'unknown', points: [], segs: [], edits: [] };
  }
  if (!isObj(json)) return { kind: 'unknown', points: [], segs: [], edits: [] };
  if (json.format === OWN_FORMAT) return parseOwn(json);
  if (Array.isArray(json.semanticSegments) || Array.isArray(json.rawSignals)) return parseDevice(json, 'device');
  if (Array.isArray(json.timelineObjects)) return parseSemantic(json);
  if (Array.isArray(json.locations)) return parseRecords(json);
  return { kind: 'unknown', points: [], segs: [], edits: [] };
}
