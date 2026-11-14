/**
 * Step-by-step guidance for a public transit journey, like Google Maps' transit navigation:
 * walk to the stop, wait for the line, ride (stops left, "get off at the next stop"), transfer,
 * walk to the destination. Pure: the screen feeds it positions and the time, and shows what it
 * says. Itineraries have no list of the stops in between, only how many and the line's shape,
 * so stops left are estimated from the distance still to ride.
 */
import { distance, lineLength, snapToLine } from './geo.ts';
import type { LngLat, TransitItinerary, TransitLeg } from './types.ts';

export type TransitPhase = 'walk' | 'wait' | 'ride' | 'arrived';

/** Moments worth an alert (sound, vibration, a notification when the page is in the background). */
export type TransitAlert = 'leave-now' | 'bus-soon' | 'board' | 'get-off-next' | 'get-off' | 'transfer' | 'arrived';

export interface TransitNavState {
  /** The leg being done now. */
  leg: number;
  phase: TransitPhase;
  /** Metres to the end of this leg (the stop to walk to, the stop to get off at, or the destination). */
  toEndM: number;
  /** Seconds until the next ride leaves (walk and wait), negative once it should have left. */
  departInS?: number;
  /** Seconds of walking still needed to reach the stop, at walking pace. */
  walkS?: number;
  /** Stops still to ride, estimated (ride). */
  stopsLeft?: number;
  /** Alerts already raised, so each is raised once per leg. */
  raised: string[];
}

export const WALK_MS = 1.25;
/** Close enough to a stop to be waiting at it. */
const AT_STOP_M = 60;
/** Close enough to the end of a walk to count it as done. */
const WALK_DONE_M = 35;
/** The last stretch of a ride: the stop to get off at is the next one, or this one. */
const GET_OFF_NEXT_M = 700;
const GET_OFF_M = 180;

const t = (iso: string) => new Date(iso).getTime();

/** The first state: the first leg, nothing raised. */
export function startTransitNav(it: TransitItinerary): TransitNavState {
  const first = it.legs[0];
  return { leg: 0, phase: first?.kind === 'ride' ? 'wait' : 'walk', toEndM: first ? lineLength(first.geometry) : 0, raised: [] };
}

function nextRide(it: TransitItinerary, from: number): TransitLeg | undefined {
  return it.legs.slice(from).find((l) => l.kind === 'ride');
}

function remainingOn(leg: TransitLeg, pos: LngLat): { toEndM: number; offM: number } {
  const g: LngLat[] = leg.geometry.length >= 2 ? leg.geometry : [[leg.from.lng, leg.from.lat], [leg.to.lng, leg.to.lat]];
  const snap = snapToLine(pos, g);
  const after = lineLength(g, snap.index + 1);
  const toNext = g[snap.index + 1] ? distance(snap.point, g[snap.index + 1]) : 0;
  return { toEndM: toNext + after, offM: snap.distanceM };
}

/**
 * Where the traveller is in the journey now, and which alerts are due. Legs only move forward:
 * a walk ends at its stop, a ride ends near its last stop (or once its arrival time has passed
 * and the traveller is closer to the next leg).
 */
export function updateTransitNav(it: TransitItinerary, prev: TransitNavState, pos: LngLat, now: number): { state: TransitNavState; alerts: TransitAlert[] } {
  let leg = prev.leg;
  let raised = prev.raised;
  const alerts: TransitAlert[] = [];
  const raise = (a: TransitAlert, key = `${leg}:${a}`) => {
    if (raised.includes(key)) return;
    raised = [...raised, key];
    alerts.push(a);
  };
  // Move on from legs that are done.
  for (;;) {
    const l = it.legs[leg];
    if (!l) break;
    const { toEndM } = remainingOn(l, pos);
    const done =
      l.kind === 'walk'
        ? toEndM < WALK_DONE_M
        : toEndM < GET_OFF_M / 2 || (now > t(l.end) + 60_000 && it.legs[leg + 1] && remainingOn(it.legs[leg + 1], pos).offM < remainingOn(l, pos).offM);
    if (!done) break;
    leg++;
    if (leg < it.legs.length && it.legs[leg].kind === 'walk' && it.legs.slice(leg).some((x) => x.kind === 'ride')) raise('transfer');
  }
  if (leg >= it.legs.length) {
    raise('arrived', 'arrived');
    return { state: { leg: it.legs.length - 1, phase: 'arrived', toEndM: 0, raised }, alerts };
  }
  const l = it.legs[leg];
  const { toEndM } = remainingOn(l, pos);
  if (l.kind === 'walk') {
    const ride = nextRide(it, leg);
    const walkS = toEndM / WALK_MS;
    const departInS = ride ? (t(ride.start) - now) / 1000 : undefined;
    // Last leg on foot: just walk to the destination.
    if (!ride) {
      if (toEndM < WALK_DONE_M) raise('arrived', 'arrived');
      return { state: { leg, phase: 'walk', toEndM, walkS, raised }, alerts };
    }
    if (departInS !== undefined && departInS - walkS < 120) raise('leave-now');
    return { state: { leg, phase: 'walk', toEndM, walkS, departInS, raised }, alerts };
  }
  // A ride: waiting at its stop until it leaves, then riding.
  const departInS = (t(l.start) - now) / 1000;
  const atStop = distance(pos, [l.from.lng, l.from.lat]) < AT_STOP_M;
  const rideLen = lineLength(l.geometry);
  const ridden = rideLen - toEndM;
  if (departInS > 0 && (atStop || ridden < AT_STOP_M)) {
    if (departInS < 180) raise('bus-soon');
    return { state: { leg, phase: 'wait', toEndM, departInS, raised }, alerts };
  }
  if (departInS > -120 && ridden < AT_STOP_M) raise('board');
  const stops = l.stops ?? 1;
  const stopsLeft = Math.max(1, Math.min(stops, Math.ceil((stops * toEndM) / Math.max(1, rideLen))));
  if (toEndM < GET_OFF_M) raise('get-off');
  else if (toEndM < Math.max(GET_OFF_NEXT_M, rideLen / Math.max(1, stops)) && stops > 1) raise('get-off-next');
  return { state: { leg, phase: 'ride', toEndM, departInS, stopsLeft: toEndM < GET_OFF_M ? 0 : stopsLeft, raised }, alerts };
}

/** What to say for an alert, in Hebrew, like Google's transit prompts. */
export function transitAlertText(a: TransitAlert, it: TransitItinerary, s: TransitNavState): string {
  const l = it.legs[s.leg];
  const ride = l?.kind === 'ride' ? l : it.legs.slice(s.leg).find((x) => x.kind === 'ride');
  const line = ride?.line ? `קו ${ride.line}` : 'הקו';
  const mins = (sec?: number) => Math.max(0, Math.round((sec ?? 0) / 60));
  switch (a) {
    case 'leave-now':
      return `צאו עכשיו לתחנה ${ride?.from.name ?? ''} כדי לתפוס את ${line}`.trim();
    case 'bus-soon':
      return `${line} מגיע בעוד ${mins(s.departInS) || 'פחות מדקה'}${mins(s.departInS) ? ' דקות' : ''}`;
    case 'board':
      return `עלו על ${line}${ride?.headsign ? ` לכיוון ${ride.headsign}` : ''}`;
    case 'get-off-next':
      return `רדו בתחנה הבאה: ${l?.to.name ?? ''}`.trim();
    case 'get-off':
      return `רדו כאן: ${l?.to.name ?? ''}`.trim();
    case 'transfer':
      return ride ? `החלפה: הלכו לתחנה ${ride.from.name} ל${line}` : 'הלכו ליעד';
    case 'arrived':
      return 'הגעתם ליעד';
  }
}
