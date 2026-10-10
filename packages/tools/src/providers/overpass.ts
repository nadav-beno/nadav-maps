import { osmPlaceId, type BBox, type OsmType, type PlaceDetails } from '@nm/core';
import { getJson, type ToolContext } from '../define.ts';

interface OverpassElement {
  type: OsmType;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const PRIMARY_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic', 'office', 'craft', 'natural', 'railway', 'aeroway', 'place', 'building'];

function nameOf(tags: Record<string, string>, lang: string): string | undefined {
  return tags[`name:${lang}`] ?? tags.name ?? tags['name:en'] ?? tags.brand;
}

function addressOf(tags: Record<string, string>): string | undefined {
  const street = tags['addr:street'];
  const line = street ? `${street}${tags['addr:housenumber'] ? ` ${tags['addr:housenumber']}` : ''}` : undefined;
  return [line, tags['addr:city']].filter(Boolean).join(', ') || undefined;
}

/** Commons file name -> a 640px thumbnail URL (no API call needed). */
export function commonsThumb(file: string, width = 640): string {
  const name = file.replace(/^(File|Image|קובץ):/i, '').trim().replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

export function elementToDetails(el: OverpassElement, lang: string): PlaceDetails | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat === undefined || lng === undefined) return null;
  const key = PRIMARY_KEYS.find((k) => tags[k]);
  const image = tags.image?.startsWith('http')
    ? tags.image
    : tags.wikimedia_commons?.startsWith('File:')
      ? commonsThumb(tags.wikimedia_commons)
      : undefined;
  return {
    id: osmPlaceId(el.type, el.id),
    name: nameOf(tags, lang) ?? addressOf(tags) ?? 'מקום ללא שם',
    lng,
    lat,
    address: addressOf(tags),
    category: key ? { key, value: tags[key] } : undefined,
    osm: { type: el.type, id: el.id },
    tags,
    phone: tags.phone ?? tags['contact:phone'],
    website: tags.website ?? tags['contact:website'] ?? tags.url,
    openingHours: tags.opening_hours,
    wheelchair: tags.wheelchair,
    cuisine: tags.cuisine,
    imageUrl: image,
    wikipedia: tags.wikipedia,
    wikidata: tags.wikidata,
  };
}

async function overpass(ctx: ToolContext, query: string): Promise<OverpassElement[]> {
  const data = await getJson<{ elements: OverpassElement[] }>(
    ctx,
    ctx.config.overpassUrl,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` },
    'overpass',
    25000,
  );
  return data.elements;
}

export async function overpassDetails(ctx: ToolContext, type: OsmType, id: number): Promise<PlaceDetails | null> {
  const els = await overpass(ctx, `[out:json][timeout:15];${type}(${id});out tags center;`);
  return els[0] ? elementToDetails(els[0], ctx.lang) : null;
}

export async function overpassCategory(ctx: ToolContext, filters: string[], bbox: BBox, limit = 60): Promise<PlaceDetails[]> {
  const [w, s, e, n] = bbox;
  const b = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  const parts = filters.map((f) => `nwr${f}(${b});`).join('');
  const els = await overpass(ctx, `[out:json][timeout:20];(${parts});out tags center ${limit};`);
  return els
    .map((el) => elementToDetails(el, ctx.lang))
    .filter((p): p is PlaceDetails => !!p && !!(p.tags.name || p.tags.brand));
}

/** Find the OSM object behind a label the user tapped on the map (we know its name and position). */
export async function overpassIdentify(ctx: ToolContext, name: string, lng: number, lat: number): Promise<PlaceDetails | null> {
  const safe = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const q = `[out:json][timeout:10];(nwr(around:60,${lat.toFixed(6)},${lng.toFixed(6)})["name"="${safe}"];nwr(around:60,${lat.toFixed(6)},${lng.toFixed(6)})["name:he"="${safe}"];);out tags center 5;`;
  const els = await overpass(ctx, q);
  const details = els.map((e) => elementToDetails(e, ctx.lang)).filter((d): d is PlaceDetails => !!d);
  // Prefer a node/way with a category over a bare building or route relation.
  details.sort((a, b) => Number(!!b.category && b.category.key !== 'building') - Number(!!a.category && a.category.key !== 'building'));
  return details[0] ?? null;
}
