import { distance } from './geo.ts';
import type { Lane, LngLat, RouteGuidance } from './types.ts';

/** A location fix as the browser reports it (only what the checks need). */
export interface Fix {
  lng: number;
  lat: number;
  accuracy?: number;
  timestamp: number;
}

/**
 * Is a new fix believable after the last one? GPS spoofing and jamming (common in Israel
 * since 2023) make the position jump hundreds of km, often to Beirut or Cairo airport. A
 * jump faster than a plane, or one at "0,0", is rejected so the blue dot and navigation
 * keep the last good position.
 */
export function plausibleFix(prev: Fix | null, next: Fix, maxSpeedMs = 300): boolean {
  if (!Number.isFinite(next.lng) || !Number.isFinite(next.lat)) return false;
  if (Math.abs(next.lng) < 0.01 && Math.abs(next.lat) < 0.01) return false;
  if (!prev) return true;
  const dt = Math.max(1, (next.timestamp - prev.timestamp) / 1000);
  const d = distance([prev.lng, prev.lat], [next.lng, next.lat]);
  // Allow for both fixes' inaccuracy before calling it a jump.
  const slack = (prev.accuracy ?? 50) + (next.accuracy ?? 50);
  return d - slack <= maxSpeedMs * dt;
}

/** The sun's altitude above the horizon in degrees (NOAA's simple formula, good to ~1°). */
export function sunAltitude(lng: number, lat: number, at = new Date()): number {
  const rad = Math.PI / 180;
  const day = (at.getTime() - Date.UTC(at.getUTCFullYear(), 0, 0)) / 86400000;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (at.getUTCHours() - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
  const solarTime = minutes + eqTime + 4 * lng;
  const hourAngle = (solarTime / 4 - 180) * rad;
  const cosZenith = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / rad;
}

/** Dark enough for the night map: after sunset (with a little civil twilight). */
export function isNight(lng: number, lat: number, at = new Date()): boolean {
  return sunAltitude(lng, lat, at) < -2;
}

/**
 * Navigation zoom: close in town, wider on the highway so the next turn is on screen
 * sooner, and closer again just before a turn.
 */
export function zoomForSpeed(speedMs: number | null | undefined, distToTurnM: number): number {
  if (distToTurnM < 150) return 17.5;
  const kmh = Math.max(0, (speedMs ?? 0) * 3.6);
  if (kmh > 90) return 15;
  if (kmh > 60) return 15.8;
  if (kmh > 30) return 16.5;
  return 17;
}

/** The speed limit at a geometry index, if the route has one there. */
export function speedLimitAt(g: RouteGuidance | null | undefined, index: number): number | null {
  if (!g) return null;
  for (const s of g.speedLimits) if (index >= s.from && index < s.to) return s.kmh;
  return null;
}

/** Lane arrows for the junction at a point (the next turn), within 40 m. */
export function lanesAt(g: RouteGuidance | null | undefined, at: LngLat): Lane[] | null {
  if (!g) return null;
  let best: { d: number; lanes: Lane[] } | null = null;
  for (const l of g.lanes) {
    const d = distance(l.at, at);
    if (d < 40 && (!best || d < best.d)) best = { d, lanes: l.lanes };
  }
  // A junction where every lane fits says nothing worth showing.
  return best && best.lanes.length > 1 && best.lanes.some((l) => !l.valid) ? best.lanes : null;
}

/** Material Symbols icon for a lane's main arrow. */
export function laneIcon(indications: string[]): string {
  const i = indications[0] ?? 'straight';
  if (i === 'uturn') return 'u_turn_left';
  if (i.includes('sharp') && i.includes('left')) return 'turn_sharp_left';
  if (i.includes('sharp') && i.includes('right')) return 'turn_sharp_right';
  if (i.includes('slight') && i.includes('left')) return 'turn_slight_left';
  if (i.includes('slight') && i.includes('right')) return 'turn_slight_right';
  if (i.includes('left')) return 'turn_left';
  if (i.includes('right')) return 'turn_right';
  return 'straight';
}
