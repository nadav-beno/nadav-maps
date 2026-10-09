import type { OsmType, Place } from './types.ts';

const LETTER: Record<OsmType, string> = { node: 'n', way: 'w', relation: 'r' };
const TYPE: Record<string, OsmType> = { n: 'node', w: 'way', r: 'relation' };

/** Stable id for an OSM object: "osm:n123". */
export function osmPlaceId(type: OsmType, id: number): string {
  return `osm:${LETTER[type]}${id}`;
}

/** Stable id for a dropped pin, rounded to ~1 m. */
export function pointPlaceId(lng: number, lat: number): string {
  return `pt:${lng.toFixed(5)},${lat.toFixed(5)}`;
}

export function parsePlaceId(id: string): { osm?: { type: OsmType; id: number }; point?: [number, number]; overture?: string } {
  const o = /^ovt:([0-9a-f-]{8,64})$/i.exec(id);
  if (o) return { overture: o[1] };
  const m = /^osm:([nwr])(\d+)$/.exec(id);
  if (m) return { osm: { type: TYPE[m[1]], id: Number(m[2]) } };
  const p = /^pt:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(id);
  if (p) return { point: [Number(p[1]), Number(p[2])] };
  return {};
}

export function droppedPin(lng: number, lat: number, name = 'נקודה שנבחרה'): Place {
  return { id: pointPlaceId(lng, lat), name, lng, lat };
}
