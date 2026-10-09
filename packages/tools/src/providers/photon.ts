import { osmPlaceId, type BBox, type OsmType, type Place } from '@nm/core';
import { getJson, type ToolContext } from '../define.ts';

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: 'N' | 'W' | 'R';
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
    extent?: [number, number, number, number]; // [minLon, maxLat, maxLon, minLat]
  };
}

const OSM_TYPE: Record<string, OsmType> = { N: 'node', W: 'way', R: 'relation' };

export function photonToPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const streetLine = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : undefined;
  const name = p.name ?? streetLine ?? p.city ?? p.state ?? p.country ?? 'מקום';
  const parts = [p.name ? streetLine : undefined, p.district ?? p.locality, p.city, p.city ? undefined : p.county, p.country]
    .filter((x): x is string => !!x && x !== name);
  const address = [...new Set(parts)].join(', ') || undefined;
  const type = p.osm_type ? OSM_TYPE[p.osm_type] : undefined;
  const place: Place = {
    id: type && p.osm_id ? osmPlaceId(type, p.osm_id) : `pt:${lng.toFixed(5)},${lat.toFixed(5)}`,
    name,
    lng,
    lat,
    address,
    countryCode: p.countrycode?.toLowerCase(),
  };
  if (p.osm_key && p.osm_value) place.category = { key: p.osm_key, value: p.osm_value };
  if (type && p.osm_id) place.osm = { type, id: p.osm_id };
  if (p.extent) {
    const [minLon, maxLat, maxLon, minLat] = p.extent;
    place.extent = [minLon, minLat, maxLon, maxLat] as BBox;
  }
  return place;
}

/** Photon only supports a few `lang` values; anything else means "local names". */
const PHOTON_LANGS = new Set(['en', 'de', 'fr', 'it']);

export async function photonSearch(
  ctx: ToolContext,
  q: string,
  opts: { near?: [number, number]; zoom?: number; limit?: number; bbox?: BBox } = {},
): Promise<Place[]> {
  const u = new URL('/api', ctx.config.photonUrl);
  u.searchParams.set('q', q);
  u.searchParams.set('limit', String(opts.limit ?? 8));
  u.searchParams.set('lang', PHOTON_LANGS.has(ctx.lang) ? ctx.lang : 'default');
  if (opts.near) {
    u.searchParams.set('lon', opts.near[0].toFixed(5));
    u.searchParams.set('lat', opts.near[1].toFixed(5));
    if (opts.zoom !== undefined) u.searchParams.set('zoom', String(Math.round(Math.min(18, Math.max(4, opts.zoom)))));
    u.searchParams.set('location_bias_scale', '0.3');
  }
  if (opts.bbox) u.searchParams.set('bbox', opts.bbox.map((n) => n.toFixed(4)).join(','));
  const data = await getJson<{ features: PhotonFeature[] }>(ctx, u.toString(), {}, 'photon');
  return dedupe(data.features.map(photonToPlace));
}

export async function photonReverse(ctx: ToolContext, lng: number, lat: number): Promise<Place | null> {
  const u = new URL('/reverse', ctx.config.photonUrl);
  u.searchParams.set('lon', lng.toFixed(6));
  u.searchParams.set('lat', lat.toFixed(6));
  u.searchParams.set('limit', '1');
  u.searchParams.set('lang', PHOTON_LANGS.has(ctx.lang) ? ctx.lang : 'default');
  const data = await getJson<{ features: PhotonFeature[] }>(ctx, u.toString(), {}, 'photon');
  return data.features[0] ? photonToPlace(data.features[0]) : null;
}

/** Photon often returns the same street several times (one per OSM way). */
function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = p.category?.key === 'highway' ? `${p.name}|${p.address}` : p.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
