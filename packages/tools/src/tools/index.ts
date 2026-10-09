import { normalizeQuery, parsePlaceId, queryVariants, type BBox, type LngLat } from '@nm/core';
import { z } from 'zod';
import { CATEGORIES, categoryById } from '../categories.ts';
import { defineTool } from '../define.ts';
import { overpassCategory, overpassDetails, overpassIdentify } from '../providers/overpass.ts';
import { photonReverse, photonSearch } from '../providers/photon.ts';
import { valhallaRoute } from '../providers/valhalla.ts';

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
  }),
  async run(input, ctx) {
    const q = normalizeQuery(input.query);
    let results = await photonSearch(ctx, q, { near: input.near as LngLat | undefined, zoom: input.zoom, limit: input.limit });
    // Hebrew prefixes and connector words hurt recall; retry with variants when thin.
    if (results.length < 3) {
      for (const v of queryVariants(input.query)) {
        const more = await photonSearch(ctx, v, { near: input.near as LngLat | undefined, zoom: input.zoom, limit: input.limit });
        const ids = new Set(results.map((r) => r.id));
        results = [...results, ...more.filter((m) => !ids.has(m.id))];
        if (results.length >= 3) break;
      }
    }
    return results.slice(0, input.limit);
  },
});

export const reverseGeocode = defineTool({
  name: 'reverse_geocode',
  title: 'מה יש בנקודה',
  description: 'Find the address or place at a coordinate.',
  input: z.object({ lng, lat }),
  run: (input, ctx) => photonReverse(ctx, input.lng, input.lat),
});

export const placeDetails = defineTool({
  name: 'place_details',
  title: 'פרטי מקום',
  description: 'Details of a place by its id ("osm:n123"): opening hours, phone, website, accessibility, image.',
  input: z.object({ id: z.string().regex(/^osm:[nwr]\d+$/, 'expected an OSM place id like osm:n123') }),
  async run(input, ctx) {
    const { osm } = parsePlaceId(input.id);
    if (!osm) return null;
    return overpassDetails(ctx, osm.type, osm.id);
  },
});

export const identifyPlace = defineTool({
  name: 'identify_place',
  title: 'זיהוי מקום לפי שם ומיקום',
  description: 'Find the OSM place with this name near a coordinate (e.g. a label tapped on the map) and return its details.',
  input: z.object({ name: z.string().min(1).max(200), lng, lat }),
  run: (input, ctx) => overpassIdentify(ctx, input.name, input.lng, input.lat),
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

export const TOOLS = [searchPlaces, reverseGeocode, placeDetails, identifyPlace, searchNearby, getDirections];
