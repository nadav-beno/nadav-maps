import { decodePolyline, type LngLat, type Route, type RouteStep, type TravelMode } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';
import { hebrewInstruction } from '../instructions-he.ts';

const COSTING: Record<TravelMode, string> = { car: 'auto', walk: 'pedestrian', bike: 'bicycle' };

interface ValhallaManeuver {
  type: number;
  instruction?: string;
  street_names?: string[];
  begin_street_names?: string[];
  length: number; // km
  time: number; // s
  begin_shape_index: number;
  roundabout_exit_count?: number;
}
interface ValhallaTrip {
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
  summary: { length: number; time: number };
  status?: number;
}
interface ValhallaResponse {
  trip: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
}

export function tripToRoute(trip: ValhallaTrip, mode: TravelMode): Route {
  const geometry: LngLat[] = [];
  const steps: RouteStep[] = [];
  for (const leg of trip.legs) {
    const offset = geometry.length;
    const pts = decodePolyline(leg.shape, 6);
    // Consecutive legs share their joining point.
    geometry.push(...(offset > 0 ? pts.slice(1) : pts));
    const shift = offset > 0 ? offset - 1 : 0;
    for (const m of leg.maneuvers) {
      // Intermediate "arrive" of a non-final leg is noise.
      if ((m.type === 4 || m.type === 5 || m.type === 6) && leg !== trip.legs[trip.legs.length - 1]) continue;
      if (offset > 0 && m.type >= 1 && m.type <= 3) continue;
      const street = (m.street_names ?? m.begin_street_names)?.[0];
      const step: RouteStep = {
        type: m.type,
        street,
        distanceM: Math.round(m.length * 1000),
        durationS: Math.round(m.time),
        shapeIndex: m.begin_shape_index + shift,
        roundaboutExit: m.roundabout_exit_count,
        instruction: '',
      };
      step.instruction = hebrewInstruction(step);
      steps.push(step);
    }
  }
  const names = steps
    .filter((s) => s.street && s.distanceM > 0)
    .sort((a, b) => b.distanceM - a.distanceM)
    .slice(0, 2)
    .map((s) => s.street!);
  return {
    mode,
    distanceM: Math.round(trip.summary.length * 1000),
    durationS: Math.round(trip.summary.time),
    geometry,
    steps,
    summary: [...new Set(names)].join(', ') || undefined,
  };
}

export async function valhallaRoute(
  ctx: ToolContext,
  waypoints: LngLat[],
  mode: TravelMode,
  opts: { alternatives?: number; avoidTolls?: boolean; avoidHighways?: boolean; heading?: number } = {},
): Promise<Route[]> {
  const costing = COSTING[mode];
  const body = {
    locations: waypoints.map(([lon, lat], i) => ({
      lon,
      lat,
      type: i === 0 || i === waypoints.length - 1 ? 'break' : 'through',
      ...(i === 0 && opts.heading !== undefined ? { heading: Math.round(opts.heading), heading_tolerance: 45 } : {}),
    })),
    costing,
    costing_options:
      mode === 'car' && (opts.avoidTolls || opts.avoidHighways)
        ? { auto: { ...(opts.avoidTolls ? { use_tolls: 0 } : {}), ...(opts.avoidHighways ? { use_highways: 0 } : {}) } }
        : undefined,
    alternates: waypoints.length === 2 ? (opts.alternatives ?? 2) : 0,
    directions_options: { units: 'kilometers', language: 'en-US' },
    units: 'kilometers',
  };
  let data: ValhallaResponse;
  try {
    data = await getJson<ValhallaResponse>(
      ctx,
      new URL('/route', ctx.config.valhallaUrl).toString(),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      'valhalla',
      20000,
    );
  } catch (e) {
    // 400 from Valhalla mostly means "no route between these points".
    if (e instanceof ProviderError && e.status === 400) return [];
    throw e;
  }
  return [data.trip, ...(data.alternates ?? []).map((a) => a.trip)].map((t) => tripToRoute(t, mode));
}
