import { decodePolyline, type Departure, type LngLat, type TransitItinerary, type TransitLeg, type TransitMode, type TransitStop } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

/**
 * Public transport through a MOTIS server (Transitous by default: worldwide GTFS
 * timetables, with live times where operators publish them). API: /api/v{N}/plan,
 * /stoptimes. Newer servers speak v6; we fall back to v5 for older deployments.
 */

interface MotisPlace {
  name: string;
  stopId?: string;
  lat: number;
  lon: number;
  track?: string;
  scheduledTrack?: string;
  arrival?: string;
  departure?: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
}
interface MotisLeg {
  mode: string;
  from: MotisPlace;
  to: MotisPlace;
  duration: number;
  startTime: string;
  endTime: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  realTime?: boolean;
  distance?: number;
  headsign?: string;
  routeShortName?: string;
  routeLongName?: string;
  displayName?: string;
  tripShortName?: string;
  routeColor?: string;
  routeTextColor?: string;
  agencyName?: string;
  intermediateStops?: MotisPlace[];
  legGeometry?: { points: string; precision?: number };
}
interface MotisItinerary {
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: MotisLeg[];
}
interface MotisStopTime {
  place: MotisPlace;
  mode: string;
  realTime?: boolean;
  headsign?: string;
  routeShortName?: string;
  routeLongName?: string;
  displayName?: string;
  tripShortName?: string;
  routeColor?: string;
  routeTextColor?: string;
  agencyName?: string;
  cancelled?: boolean;
  tripCancelled?: boolean;
}

const WALK_MODES = new Set(['WALK', 'BIKE', 'CAR', 'RENTAL', 'CAR_PARKING', 'CAR_DROPOFF']);

export function transitMode(m: string): TransitMode {
  switch (m) {
    case 'BUS':
      return 'bus';
    case 'COACH':
      return 'coach';
    case 'TRAM':
      return 'tram';
    case 'SUBWAY':
    case 'METRO':
      return 'subway';
    case 'FERRY':
      return 'ferry';
    case 'AERIAL_LIFT':
    case 'AREAL_LIFT':
    case 'CABLE_CAR':
    case 'FUNICULAR':
      return 'cable';
    case 'RAIL':
    case 'HIGHSPEED_RAIL':
    case 'LONG_DISTANCE':
    case 'NIGHT_RAIL':
    case 'REGIONAL_FAST_RAIL':
    case 'REGIONAL_RAIL':
    case 'SUBURBAN':
      return 'rail';
    default:
      return 'other';
  }
}

const hex = (c?: string) => (c && /^[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined);

function stop(p: MotisPlace): TransitStop {
  return { name: p.name, lng: p.lon, lat: p.lat, stopId: p.stopId, track: p.track ?? p.scheduledTrack };
}

function lineName(x: { routeShortName?: string; displayName?: string; tripShortName?: string; routeLongName?: string }): string {
  return (x.routeShortName || x.displayName || x.tripShortName || x.routeLongName || '').trim();
}

export function motisLeg(l: MotisLeg): TransitLeg {
  const walk = WALK_MODES.has(l.mode);
  const geometry: LngLat[] = l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6) : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]];
  const leg: TransitLeg = {
    kind: walk ? 'walk' : 'ride',
    from: stop(l.from),
    to: stop(l.to),
    start: l.startTime,
    end: l.endTime,
    scheduledStart: l.scheduledStartTime ?? l.startTime,
    scheduledEnd: l.scheduledEndTime ?? l.endTime,
    realtime: !!l.realTime,
    distanceM: l.distance,
    geometry,
  };
  if (!walk) {
    Object.assign(leg, {
      mode: transitMode(l.mode),
      line: lineName(l),
      headsign: l.headsign,
      color: hex(l.routeColor),
      textColor: hex(l.routeTextColor),
      agency: l.agencyName,
      stops: (l.intermediateStops?.length ?? 0) + 1,
    });
  }
  return leg;
}

export function motisItinerary(it: MotisItinerary): TransitItinerary {
  const legs = it.legs.map(motisLeg);
  return {
    start: it.startTime,
    end: it.endTime,
    durationS: it.duration,
    transfers: it.transfers,
    walkM: Math.round(legs.filter((l) => l.kind === 'walk').reduce((s, l) => s + (l.distanceM ?? 0), 0)),
    legs,
  };
}

export function motisDeparture(st: MotisStopTime): Departure {
  return {
    stop: stop(st.place),
    mode: transitMode(st.mode),
    line: lineName(st),
    headsign: st.headsign ?? '',
    time: st.place.departure ?? st.place.arrival ?? '',
    scheduledTime: st.place.scheduledDeparture ?? st.place.scheduledArrival ?? st.place.departure ?? '',
    realtime: !!st.realTime,
    cancelled: !!(st.cancelled || st.tripCancelled),
    color: hex(st.routeColor),
    textColor: hex(st.routeTextColor),
    agency: st.agencyName,
  };
}

/** Calls /api/v6/<path>, falling back to v5 when the server is older. */
async function motis<T>(ctx: ToolContext, path: string, params: URLSearchParams): Promise<T> {
  const base = ctx.config.transitUrl.replace(/\/$/, '');
  if (!base) throw new ProviderError('תחבורה ציבורית לא מוגדרת בשרת הזה.', undefined, 'transit');
  try {
    return await getJson<T>(ctx, `${base}/api/v6/${path}?${params}`, {}, 'transit', 15000);
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return getJson<T>(ctx, `${base}/api/v5/${path}?${params}`, {}, 'transit', 15000);
    throw e;
  }
}

const place = ([lng, lat]: LngLat) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

export async function transitPlan(
  ctx: ToolContext,
  from: LngLat,
  to: LngLat,
  opts: { time?: string; arriveBy?: boolean; maxItineraries?: number; wheelchair?: boolean },
): Promise<TransitItinerary[]> {
  const params = new URLSearchParams({ fromPlace: place(from), toPlace: place(to), detailedTransfers: 'false', numItineraries: String(opts.maxItineraries ?? 5) });
  if (opts.time) params.set('time', opts.time);
  if (opts.arriveBy) params.set('arriveBy', 'true');
  if (opts.wheelchair) params.set('pedestrianProfile', 'WHEELCHAIR');
  params.set('language', ctx.lang);
  const res = await motis<{ itineraries?: MotisItinerary[]; direct?: MotisItinerary[] }>(ctx, 'plan', params);
  // Walking only is the "direct" answer; keep it when it's the sensible choice.
  const its = (res.itineraries ?? []).map(motisItinerary);
  const direct = (res.direct ?? []).map(motisItinerary).filter((d) => d.legs.every((l) => l.kind === 'walk'));
  return [...its, ...direct.filter((d) => !its.length || d.durationS < Math.min(...its.map((i) => i.durationS)))].slice(0, opts.maxItineraries ?? 5);
}

export async function transitDepartures(ctx: ToolContext, at: { stopId?: string; center?: LngLat; radiusM?: number }, n: number, time?: string): Promise<Departure[]> {
  const params = new URLSearchParams({ n: String(n) });
  if (at.stopId) params.set('stopId', at.stopId);
  else if (at.center) {
    params.set('center', place(at.center));
    params.set('radius', String(at.radiusM ?? 200));
  }
  if (time) params.set('time', time);
  params.set('language', ctx.lang);
  const res = await motis<{ stopTimes?: MotisStopTime[] }>(ctx, 'stoptimes', params);
  return (res.stopTimes ?? []).map(motisDeparture).filter((d) => d.time);
}
