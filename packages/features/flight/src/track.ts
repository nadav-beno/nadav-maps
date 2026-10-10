import { bearing, distance, type LngLat } from '@nm/core';

/**
 * The flight log: GPS fixes in, a clean breadcrumb track, distance flown, ground speed and
 * heading out. Pure, so it is easy to test and to keep across a reload (stored on the device
 * only; positions never leave it).
 */
export interface Fix {
  lngLat: LngLat;
  /** ms since epoch */
  t: number;
  /** Horizontal accuracy, meters. */
  accuracy: number;
  /** Meters above sea level, when the GPS reports it. */
  altitude: number | null;
  /** m/s from the GPS, when reported. */
  speed: number | null;
  /** Degrees from true north, when reported. */
  heading: number | null;
}

export interface FlightLog {
  startedAt: number;
  /** Breadcrumbs for the map, at least TRACK_STEP_M apart. */
  track: LngLat[];
  distanceM: number;
  last: Fix | null;
  /** Last position that counted toward the distance. */
  anchor: { lngLat: LngLat; t: number } | null;
  /** Smoothed ground speed (m/s) and heading. */
  speedMs: number | null;
  heading: number | null;
}

/** Fixes worse than this are ignored (a cell-tower guess, not GPS). */
export const MAX_ACCURACY_M = 3000;
/** Faster than any airliner: a jump in the GPS, not movement. */
const MAX_SPEED_MS = 420;
const TRACK_STEP_M = 500;
const MAX_TRACK = 20000;

export function newLog(now = Date.now()): FlightLog {
  return { startedAt: now, track: [], distanceM: 0, last: null, anchor: null, speedMs: null, heading: null };
}

export function addFix(log: FlightLog, fix: Fix): FlightLog {
  if (!Number.isFinite(fix.lngLat[0]) || !Number.isFinite(fix.lngLat[1]) || fix.accuracy > MAX_ACCURACY_M) return log;
  const next: FlightLog = { ...log, last: fix };
  const a = log.anchor;
  let derived: number | null = null;
  if (!a) {
    next.anchor = { lngLat: fix.lngLat, t: fix.t };
  } else {
    const d = distance(a.lngLat, fix.lngLat);
    const dt = (fix.t - a.t) / 1000;
    // Only movement bigger than the GPS jitter counts, so standing still adds nothing.
    if (d >= Math.max(30, fix.accuracy) && dt > 0) {
      derived = d / dt;
      if (derived <= MAX_SPEED_MS) {
        next.distanceM = log.distanceM + d;
        next.heading = bearing(a.lngLat, fix.lngLat);
      } else derived = null;
      next.anchor = { lngLat: fix.lngLat, t: fix.t };
    } else if (dt > 120) {
      // Parked for a while: speed is zero.
      derived = 0;
      next.anchor = { lngLat: fix.lngLat, t: fix.t };
    }
  }
  const measured = fix.speed !== null && fix.speed >= 0 ? fix.speed : derived;
  if (measured !== null) next.speedMs = log.speedMs === null ? measured : log.speedMs * 0.4 + measured * 0.6;
  if (fix.heading !== null && Number.isFinite(fix.heading) && (fix.speed ?? derived ?? 0) > 2) next.heading = fix.heading;

  const lastPt = log.track[log.track.length - 1];
  if (!lastPt || distance(lastPt, fix.lngLat) >= TRACK_STEP_M) {
    const track = [...log.track, fix.lngLat];
    // Very long logs keep every other old point.
    next.track = track.length > MAX_TRACK ? track.filter((_, i) => i % 2 === 0 || i > track.length - 100) : track;
  }
  return next;
}

/** Seconds to cover `remainingM` at the current ground speed; null when too slow to say. */
export function etaSeconds(remainingM: number, speedMs: number | null): number | null {
  if (speedMs === null || speedMs < 15) return null;
  return remainingM / speedMs;
}
