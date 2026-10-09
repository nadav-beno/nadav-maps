/** Longitude/latitude pair, in that order (GeoJSON order). */
export type LngLat = [lng: number, lat: number];

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

export type OsmType = 'node' | 'way' | 'relation';

/**
 * A place anywhere in the world. `id` is stable across sessions:
 * "osm:n123" / "osm:w123" / "osm:r123" for OSM objects, "pt:<lng>,<lat>" for a dropped pin.
 */
export interface Place {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** One-line address or locality, already formatted for display. */
  address?: string;
  /** OSM key/value, e.g. amenity=cafe. */
  category?: { key: string; value: string };
  osm?: { type: OsmType; id: number };
  countryCode?: string;
  /** Bounding box for areas (cities, countries) so the map can fit them. */
  extent?: BBox;
}

export interface PlaceDetails extends Place {
  tags: Record<string, string>;
  phone?: string;
  website?: string;
  openingHours?: string;
  wheelchair?: string;
  cuisine?: string;
  imageUrl?: string;
  wikipedia?: string;
}

export type TravelMode = 'car' | 'walk' | 'bike';

export interface RouteStep {
  /** Valhalla maneuver type number. */
  type: number;
  instruction: string;
  street?: string;
  distanceM: number;
  durationS: number;
  /** Index into the route geometry where this step starts. */
  shapeIndex: number;
  roundaboutExit?: number;
}

export interface Route {
  mode: TravelMode;
  distanceM: number;
  durationS: number;
  geometry: LngLat[];
  steps: RouteStep[];
  /** Short name of the main roads, e.g. "כביש 1". */
  summary?: string;
}
