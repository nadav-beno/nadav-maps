import { bearing as bearingOf, distance } from './geo.ts';
import type { LngLat, TransitMode } from './types.ts';

/**
 * Live public transport vehicles on the map. Two kinds of positions:
 * - `gps`: a position the vehicle itself reported (Israel's buses, through the Open Bus Stride API
 *   of Hasadna, which archives the Ministry of Transport's SIRI feed).
 * - `realtime` / `schedule`: a position computed along the trip's path from its stop times, with
 *   live delays where the operator publishes them (MOTIS `map/trips`, i.e. Transitous worldwide).
 *   These carry `legs`, so the map can move the vehicle smoothly between refreshes.
 */
export type VehicleSource = 'gps' | 'realtime' | 'schedule';

export interface VehicleLeg {
  geometry: LngLat[];
  /** ISO times the vehicle leaves `from` and reaches `to` (live where known). */
  start: string;
  end: string;
  from?: string;
  to?: string;
}

export interface LiveVehicle {
  id: string;
  mode: TransitMode;
  line: string;
  headsign?: string;
  agency?: string;
  color?: string;
  textColor?: string;
  source: VehicleSource;
  /** Where the vehicle was at `at` (GPS fix or computed). */
  lng: number;
  lat: number;
  /** Degrees from north, when known. */
  bearing?: number;
  /** km/h, GPS only. */
  speedKph?: number;
  /** When the position was measured (GPS) or computed. */
  at: string;
  /** Seconds late (negative = early), when live times are known. */
  delayS?: number;
  /** The trip's path near now, oldest first (computed positions only). */
  legs?: VehicleLeg[];
}

/** A point `f` (0..1) of the way along a line, with the heading there. */
export function alongLine(line: LngLat[], f: number): { at: LngLat; bearing?: number } {
  if (line.length === 0) return { at: [0, 0] };
  if (line.length === 1) return { at: line[0] };
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = distance(line[i - 1], line[i]);
    seg.push(d);
    total += d;
  }
  if (total === 0) return { at: line[0] };
  let left = Math.min(1, Math.max(0, f)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, left / seg[i]) : 0;
      const a = line[i];
      const b = line[i + 1];
      return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearingOf(a, b) };
    }
    left -= seg[i];
  }
  return { at: line[line.length - 1] };
}

/**
 * Where a vehicle with legs is at time `t` (ms): moving along the leg it is on, waiting at the stop
 * between two legs, or at the first/last stop outside the window. Null when it has no legs.
 */
export function vehiclePositionAt(v: Pick<LiveVehicle, 'legs'>, t: number): { at: LngLat; bearing?: number; nextStop?: string } | null {
  const legs = v.legs;
  if (!legs?.length) return null;
  for (const l of legs) {
    const s = Date.parse(l.start);
    const e = Date.parse(l.end);
    if (t < s) {
      // Before this leg starts: waiting at its first stop.
      return { ...alongLine(l.geometry, 0), nextStop: l.from ?? l.to };
    }
    if (t <= e) return { ...alongLine(l.geometry, e > s ? (t - s) / (e - s) : 1), nextStop: l.to };
  }
  const last = legs[legs.length - 1];
  return { ...alongLine(last.geometry, 1), nextStop: last.to };
}

/** The last time any leg of the vehicle ends (ms), or Infinity for GPS vehicles. */
export function vehicleEndsAt(v: Pick<LiveVehicle, 'legs'>): number {
  return v.legs?.length ? Math.max(...v.legs.map((l) => Date.parse(l.end))) : Infinity;
}

/**
 * Israel's GTFS route_long_name reads "origin/city<->destination/city-1#": the part after "<->",
 * without the direction suffix, reads well as a headsign ("ת. מרכזית, ירושלים").
 */
export function israelHeadsign(longName?: string): string | undefined {
  if (!longName) return undefined;
  const to = longName.split('<->')[1] ?? longName;
  const clean = to
    .replace(/-\d[^/<>-]*#?\s*$/, '')
    .replace(/#\s*$/, '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
  return clean || undefined;
}
