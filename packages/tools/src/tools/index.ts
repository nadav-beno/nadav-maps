import { normalizeQuery, parsePlaceId, queryVariants, regionAt, trafficProvider, type BBox, type LngLat, type Place } from '@nm/core';
import { z } from 'zod';
import { CATEGORIES, categoryById } from '../categories.ts';
import { defineTool, ProviderError, type ToolContext } from '../define.ts';
import { findFlight } from '../providers/adsb.ts';
import { overpassCategory, overpassDetails, overpassIdentify } from '../providers/overpass.ts';
import { photonReverse, photonSearch } from '../providers/photon.ts';
import { localgeoDetails, localgeoIdentify, localgeoReverse, localgeoSearch, mergePlaces } from '../providers/localgeo.ts';
import { hereIncidents, hereTrafficTime } from '../providers/here.ts';
import { NO_KEY_MESSAGE, tomtomIncidents, tomtomTrafficTime } from '../providers/tomtom.ts';
import { transitDepartures, transitPlan } from '../providers/transitous.ts';
import { valhallaRoute } from '../providers/valhalla.ts';
import { wikipediaSummary } from '../providers/wikipedia.ts';

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const point = z.tuple([lng, lat]);

export const searchPlaces = defineTool({
  name: 'search_places',
  title: 'חיפוש מקומות',
  description:
    'Search places and addresses worldwide (Hebrew or any language). Optionally bias results toward a point. Returns places with stable ids ("osm:n123").',
  input: z.object({
    query: z.string().min(1).max(200),
    near: point.optional().describe('[lng, lat] to prefer results near'),
    zoom: z.number().min(0).max(22).optional().describe('How local the bias is (map zoom)'),
    limit: z.number().int().min(1).max(20).default(8),
    bbox: z.tuple([lng, lat, lng, lat]).optional().describe('[west, south, east, north] to search only inside (e.g. "search this area")'),
  }),
  async run(input, ctx) {
    const q = normalizeQuery(input.query);
    const opts = { near: input.near as LngLat | undefined, zoom: input.zoom, limit: input.limit, bbox: input.bbox as BBox | undefined };
    // Our own OSM data first (regions with geodata, e.g. Israel); Photon only when it has no good answer.
    const local = await localgeoSearch(ctx, input.query, opts);
    if (local?.strong) return local.places.slice(0, input.limit);
    let results: Place[];
    try {
      results = await photonSearch(ctx, q, opts);
      // Hebrew prefixes and connector words hurt recall; retry with variants when thin.
      if (results.length < 3) {
        for (const v of queryVariants(input.query)) {
          const more = await photonSearch(ctx, v, opts);
          const ids = new Set(results.map((r) => r.id));
          results = [...results, ...more.filter((m) => !ids.has(m.id))];
          if (results.length >= 3) break;
        }
      }
    } catch (e) {
      if (local?.places.length) return local.places.slice(0, input.limit);
      throw e;
    }
    if (local?.places.length) {
      // Settlements and exact names stay on top; the rest come after Photon's.
      results = mergePlaces(mergePlaces(local.top, results), local.places);
    }
    return results.slice(0, input.limit);
  },
});

export const reverseGeocode = defineTool({
  name: 'reverse_geocode',
  title: 'מה יש בנקודה',
  description: 'Find the address or place at a coordinate.',
  input: z.object({ lng, lat }),
  async run(input, ctx) {
    return (await localgeoReverse(ctx, input.lng, input.lat)) ?? photonReverse(ctx, input.lng, input.lat);
  },
});

export const placeDetails = defineTool({
  name: 'place_details',
  title: 'פרטי מקום',
  description: 'Details of a place by its id ("osm:n123"): opening hours, phone, website, accessibility, image.',
  input: z.object({ id: z.string().regex(/^osm:[nwr]\d+$/, 'expected an OSM place id like osm:n123') }),
  async run(input, ctx) {
    const { osm } = parsePlaceId(input.id);
    if (!osm) return null;
    return (await localgeoDetails(ctx, osm.type, osm.id)) ?? overpassDetails(ctx, osm.type, osm.id);
  },
});

export const identifyPlace = defineTool({
  name: 'identify_place',
  title: 'זיהוי מקום לפי שם ומיקום',
  description: 'Find the OSM place with this name near a coordinate (e.g. a label tapped on the map) and return its details.',
  input: z.object({ name: z.string().min(1).max(200), lng, lat }),
  async run(input, ctx) {
    const local = await localgeoIdentify(ctx, input.name, input.lng, input.lat);
    return local !== undefined ? local : overpassIdentify(ctx, input.name, input.lng, input.lat);
  },
});

export const searchNearby = defineTool({
  name: 'search_nearby',
  title: 'חיפוש לפי קטגוריה',
  description: `Find places of a category inside a bounding box. Categories: ${CATEGORIES.map((c) => c.id).join(', ')}.`,
  input: z.object({
    category: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]),
    bbox: z.tuple([lng, lat, lng, lat]).describe('[west, south, east, north]'),
    limit: z.number().int().min(1).max(100).default(40),
  }),
  async run(input, ctx) {
    const [w, s, e, n] = input.bbox;
    // Overpass gets slow on huge boxes; refuse rather than time out.
    if ((e - w) * (n - s) > 0.5) throw new Error('האזור גדול מדי. התקרבו במפה ונסו שוב.');
    return overpassCategory(ctx, categoryById(input.category)!.filters, input.bbox as BBox, input.limit);
  },
});

export const getDirections = defineTool({
  name: 'get_directions',
  title: 'מסלול',
  description:
    'Route between 2 to 10 points by car, walking or bike. Returns up to 3 alternatives with distance (m), duration (s), geometry and Hebrew turn-by-turn steps.',
  input: z.object({
    waypoints: z.array(point).min(2).max(10).describe('[[lng, lat], ...] origin first, destination last'),
    mode: z.enum(['car', 'walk', 'bike']).default('car'),
    alternatives: z.number().int().min(0).max(2).default(2),
    avoidTolls: z.boolean().default(false),
    avoidHighways: z.boolean().default(false),
    heading: z.number().min(0).max(360).optional().describe('Current heading, for re-routing while driving'),
    includeGeometry: z.boolean().default(true),
  }),
  async run(input, ctx) {
    const routes = await valhallaRoute(ctx, input.waypoints as LngLat[], input.mode, input);
    return input.includeGeometry ? routes : routes.map((r) => ({ ...r, geometry: [] }));
  },
});

export const placeSummary = defineTool({
  name: 'place_summary',
  title: 'תיאור מקום מוויקיפדיה',
  description:
    'Short description and photo of a place from Wikipedia, in the UI language when an article exists. Pass the OSM "wikipedia" tag ("he:Title") and/or "wikidata" id ("Q123") from place_details.',
  input: z
    .object({
      wikipedia: z.string().max(300).optional(),
      wikidata: z.string().regex(/^Q\d+$/).optional(),
    })
    .refine((v) => v.wikipedia || v.wikidata, 'wikipedia or wikidata is required'),
  run: (input, ctx) => wikipediaSummary(ctx, input),
});

export const transitDirections = defineTool({
  name: 'transit_directions',
  title: 'מסלול בתחבורה ציבורית',
  description:
    'Public transport journeys (bus, train, light rail, ferry) between two points, with walking to and from stops. Times are ISO 8601; live times when the operator publishes them. Returns up to 5 options with each leg: line, headsign, stops, times and geometry.',
  input: z.object({
    from: point.describe('[lng, lat] origin'),
    to: point.describe('[lng, lat] destination'),
    time: z.string().datetime({ offset: true }).optional().describe('Departure (or arrival with arriveBy) time, ISO 8601; default now'),
    arriveBy: z.boolean().default(false),
    wheelchair: z.boolean().default(false).describe('Only step-free journeys'),
    maxItineraries: z.number().int().min(1).max(8).default(5),
  }),
  run: (input, ctx) => transitPlan(ctx, input.from as LngLat, input.to as LngLat, input),
});

export const transitDeparturesTool = defineTool({
  name: 'transit_departures',
  title: 'יציאות מתחנה',
  description: 'Next public transport departures from the stops around a point (or from one stop id): line, headsign, time, and whether the time is live.',
  input: z.object({
    near: point.optional().describe('[lng, lat]; departures from all stops within radius'),
    radius: z.number().int().min(20).max(1000).default(200),
    stopId: z.string().max(200).optional(),
    time: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(50).default(12),
  }).refine((v) => v.near || v.stopId, 'near or stopId is required'),
  run: (input, ctx) => transitDepartures(ctx, { stopId: input.stopId, center: input.near as LngLat | undefined, radiusM: input.radius }, input.limit, input.time),
});

/** The traffic provider for a place with the keys this client or server has (see trafficProvider). */
function trafficAt(ctx: ToolContext, at: LngLat) {
  const choice = trafficProvider(regionAt(at), ctx.config);
  if (!choice) throw new ProviderError(NO_KEY_MESSAGE, 503, 'traffic');
  return choice.id;
}

export const trafficIncidents = defineTool({
  name: 'traffic_incidents',
  title: 'אירועי תנועה',
  description:
    'Live traffic incidents (accidents, road works, closures, jams) inside a bounding box (at most 10,000 km² with TomTom, 1° by 1° with HERE), worst first: type, description, delay (s, TomTom only), length (m), from/to road names, roads and a [lng, lat] point. Data from HERE where TomTom has no live traffic (Israel) and TomTom elsewhere, whichever has a configured key.',
  input: z.object({
    bbox: z.tuple([lng, lat, lng, lat]).describe('[west, south, east, north]'),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  run: (input, ctx) => {
    const [w, s, e, n] = input.bbox as BBox;
    return trafficAt(ctx, [(w + e) / 2, (s + n) / 2]) === 'here' ? hereIncidents(ctx, input.bbox as BBox, input.limit) : tomtomIncidents(ctx, input.bbox as BBox, input.limit);
  },
});

export const trafficTravelTime = defineTool({
  name: 'traffic_travel_time',
  title: 'זמן נסיעה עם תנועה',
  description:
    'Travel time by car with live traffic (HERE or TomTom, by region and configured keys) for a route: the time, the time without traffic and the delay, in seconds. Pass the route geometry from get_directions to time that exact route. Needs a configured key.',
  input: z.object({
    waypoints: z.array(point).min(2).max(10).describe('[[lng, lat], ...] origin first, destination last'),
    geometry: z.array(point).max(5000).optional().describe('The route line to time, [[lng, lat], ...]'),
  }),
  run: (input, ctx) =>
    (trafficAt(ctx, input.waypoints[0] as LngLat) === 'here' ? hereTrafficTime : tomtomTrafficTime)(ctx, input.waypoints as LngLat[], input.geometry as LngLat[] | undefined),
});

export const flightPosition = defineTool({
  name: 'flight_position',
  title: 'איפה הטיסה',
  description:
    'Live position of an aircraft by flight number or callsign ("LY001", "ELY001", "BAW123"), from public ADS-B data (adsb.lol, ODbL). Returns position, altitude (m), ground speed (km/h), track and how old the position is; empty when the aircraft is not being received.',
  input: z.object({ callsign: z.string().trim().min(2).max(10).regex(/^[A-Za-z0-9 -]+$/, 'letters and digits only') }),
  run: (input, ctx) => findFlight(ctx, input.callsign),
});

export const TOOLS = [searchPlaces, reverseGeocode, placeDetails, identifyPlace, searchNearby, getDirections, transitDirections, transitDeparturesTool, placeSummary, trafficIncidents, trafficTravelTime, flightPosition];
