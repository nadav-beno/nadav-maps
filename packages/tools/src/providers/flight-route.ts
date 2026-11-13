import { distance, type LngLat } from '@nm/core';
import { getJson, type ToolContext } from '../define.ts';

/**
 * Where a flight is going, from adsb.lol's route database (crowd-maintained callsign → airports,
 * the same data their map shows): POST {routesUrl} (adsb.im's /api/0/routeset) with the callsign and the
 * aircraft's position, so it can say whether the route is plausible for where the plane is.
 * Only the flight's callsign and position are sent.
 */

export interface RouteAirport {
  name: string;
  iata?: string;
  icao?: string;
  /** City or area. */
  city?: string;
  countryCode?: string;
  lngLat: LngLat;
}

export interface FlightRoute {
  callsign: string;
  from: RouteAirport;
  to: RouteAirport;
  /** Airports of a multi-leg route other than this leg's ends, in order. */
  stops: RouteAirport[];
  /** False when the aircraft's position doesn't fit the route (stale data, a diversion). */
  plausible: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function airport(raw: unknown): RouteAirport | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const lat = num(a.lat), lon = num(a.lon) ?? num(a.lng);
  if (lat === null || lon === null) return null;
  return { name: str(a.name) ?? str(a.iata) ?? str(a.icao) ?? '', iata: str(a.iata), icao: str(a.icao), city: str(a.location), countryCode: str(a.countryiso2), lngLat: [lon, lat] };
}

/** The leg of a multi-stop route the aircraft is on: the one with the smallest detour through it. */
export function currentLeg(airports: RouteAirport[], at: LngLat): number {
  let best = 0, bestDetour = Infinity;
  for (let i = 0; i + 1 < airports.length; i++) {
    const a = airports[i].lngLat, b = airports[i + 1].lngLat;
    const detour = distance(a, at) + distance(at, b) - distance(a, b);
    if (detour < bestDetour) {
      bestDetour = detour;
      best = i;
    }
  }
  return best;
}

export function parseRouteset(json: unknown, callsign: string, at: LngLat): FlightRoute | null {
  const list = Array.isArray(json) ? json : [];
  const cs = callsign.trim().toUpperCase();
  const hit = (list.find((r) => str((r as Record<string, unknown>)?.callsign)?.toUpperCase() === cs) ?? list[0]) as Record<string, unknown> | undefined;
  if (!hit) return null;
  const airports = (Array.isArray(hit._airports) ? hit._airports : []).map(airport).filter((a): a is RouteAirport => !!a);
  if (airports.length < 2) return null;
  const leg = currentLeg(airports, at);
  const plausible = hit.plausible === undefined ? true : hit.plausible === true || hit.plausible === 1 || hit.plausible === '1';
  return { callsign: cs, from: airports[leg], to: airports[leg + 1], stops: airports.filter((_, i) => i !== leg && i !== leg + 1), plausible };
}

export async function flightRoute(ctx: ToolContext, callsign: string, at: LngLat): Promise<FlightRoute | null> {
  const url = ctx.config.routesUrl;
  if (!url) return null;
  const json = await getJson<unknown>(
    ctx,
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planes: [{ callsign: callsign.trim().toUpperCase(), lat: at[1], lng: at[0] }] }) },
    'flights',
    10000,
  );
  return parseRouteset(json, callsign, at);
}
