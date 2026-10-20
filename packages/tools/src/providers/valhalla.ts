import { decodePolyline, distance, encodePolyline, type Lane, type LngLat, type Route, type RouteGuidance, type RouteStep, type RouteTag, type TravelMode } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';
import { hebrewInstruction } from '../instructions-he.ts';

const COSTING: Record<TravelMode, string> = { car: 'auto', walk: 'pedestrian', bike: 'bicycle', motorcycle: 'motorcycle' };

interface ValhallaManeuver {
  type: number;
  instruction?: string;
  street_names?: string[];
  begin_street_names?: string[];
  length: number; // km
  time: number; // s
  begin_shape_index: number;
  roundabout_exit_count?: number;
  toll?: boolean;
  ferry?: boolean;
}
interface ValhallaTrip {
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
  summary: { length: number; time: number; has_toll?: boolean; has_ferry?: boolean; has_highway?: boolean };
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
        ...(m.toll ? { toll: true } : {}),
        ...(m.ferry ? { ferry: true } : {}),
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
    tags: tagsOf(trip.summary),
  };
}

function tagsOf(sum: ValhallaTrip['summary']): RouteTag[] | undefined {
  const tags: RouteTag[] = [];
  if (sum.has_toll) tags.push('toll');
  if (sum.has_ferry) tags.push('ferry');
  if (sum.has_highway) tags.push('highway');
  return tags.length ? tags : undefined;
}

export interface RouteOptions {
  alternatives?: number;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  avoidUnpaved?: boolean;
  avoidStairs?: boolean;
  heading?: number;
}

/** Valhalla costing_options for the user's "avoid" choices. */
export function costingOptions(mode: TravelMode, o: RouteOptions): Record<string, Record<string, unknown>> | undefined {
  const opts: Record<string, unknown> = {};
  if (mode === 'car' || mode === 'motorcycle') {
    if (o.avoidTolls) opts.use_tolls = 0;
    if (o.avoidHighways) opts.use_highways = 0;
    if (o.avoidUnpaved) opts.exclude_unpaved = true;
  }
  if (o.avoidFerries) opts.use_ferry = 0;
  if (mode === 'walk' && o.avoidStairs) opts.step_penalty = 3600;
  if (mode === 'bike' && o.avoidUnpaved) opts.avoid_bad_surfaces = 1;
  return Object.keys(opts).length ? { [COSTING[mode]]: opts } : undefined;
}

export async function valhallaRoute(
  ctx: ToolContext,
  waypoints: LngLat[],
  mode: TravelMode,
  opts: RouteOptions = {},
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
    costing_options: costingOptions(mode, opts),
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

interface TraceAttributes {
  edges?: { speed_limit?: number | string; begin_shape_index?: number; end_shape_index?: number }[];
}
interface OsrmRoute {
  routes?: { legs: { steps: { intersections?: { location: LngLat; lanes?: { indications: string[]; valid: boolean }[] }[] }[] }[] }[];
}

/**
 * Speed limits (trace_attributes on the route line) and lane arrows (the OSRM-format
 * answer of /route, which carries lanes) for navigation. Either part is empty when the
 * server can't give it; navigation works without both.
 */
export async function valhallaGuidance(ctx: ToolContext, waypoints: LngLat[], geometry: LngLat[], mode: TravelMode): Promise<RouteGuidance> {
  const costing = COSTING[mode];
  const url = (path: string) => new URL(path, ctx.config.valhallaUrl).toString();
  const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const [trace, osrm] = await Promise.allSettled([
    geometry.length >= 2
      ? getJson<TraceAttributes>(
          ctx,
          url('/trace_attributes'),
          post({
            encoded_polyline: encodePolyline(geometry, 6),
            costing,
            shape_match: 'edge_walk',
            filters: { attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index'], action: 'include' },
          }),
          'valhalla',
          20000,
        )
      : Promise.reject(new Error('no geometry')),
    mode === 'car' || mode === 'motorcycle'
      ? getJson<OsrmRoute>(ctx, url('/route'), post({ locations: waypoints.map(([lon, lat]) => ({ lon, lat })), costing, format: 'osrm', directions_options: { language: 'en-US' } }), 'valhalla', 20000)
      : Promise.reject(new Error('no lanes')),
  ]);
  return {
    speedLimits: trace.status === 'fulfilled' ? speedLimitsOf(trace.value) : [],
    lanes: osrm.status === 'fulfilled' ? lanesOf(osrm.value) : [],
  };
}

export function speedLimitsOf(t: TraceAttributes): RouteGuidance['speedLimits'] {
  const out: RouteGuidance['speedLimits'] = [];
  for (const e of t.edges ?? []) {
    const kmh = typeof e.speed_limit === 'number' ? e.speed_limit : Number.parseInt(String(e.speed_limit ?? ''), 10);
    if (!Number.isFinite(kmh) || kmh <= 0 || kmh > 200 || e.begin_shape_index === undefined || e.end_shape_index === undefined) continue;
    const last = out[out.length - 1];
    // Merge runs of the same limit so the list stays short.
    if (last && last.kmh === kmh && last.to >= e.begin_shape_index) last.to = e.end_shape_index;
    else out.push({ from: e.begin_shape_index, to: e.end_shape_index, kmh });
  }
  return out;
}

export function lanesOf(r: OsrmRoute): RouteGuidance['lanes'] {
  const out: RouteGuidance['lanes'] = [];
  for (const leg of r.routes?.[0]?.legs ?? [])
    for (const step of leg.steps)
      for (const i of step.intersections ?? []) {
        if (!i.lanes?.length || i.lanes.every((l) => l.valid)) continue;
        if (out.some((o) => distance(o.at, i.location) < 5)) continue;
        out.push({ at: i.location, lanes: i.lanes.map((l): Lane => ({ indications: l.indications?.length ? l.indications : ['straight'], valid: !!l.valid })) });
      }
  return out;
}
