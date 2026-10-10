/** Longitude/latitude pair, in that order (GeoJSON order). */
export type LngLat = [lng: number, lat: number];

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

export type OsmType = 'node' | 'way' | 'relation';

/**
 * A place anywhere in the world. `id` is stable across sessions:
 * "osm:n123" / "osm:w123" / "osm:r123" for OSM objects, "ovt:<uuid>" for an Overture place,
 * "pt:<lng>,<lat>" for a dropped pin.
 */
export interface Place {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** One-line address or locality, already formatted for display. */
  address?: string;
  /** OSM key/value, e.g. amenity=cafe; key "overture" holds an Overture basic_category. */
  category?: { key: string; value: string };
  /** Contact details that came with the place itself (Overture), before any lookup. */
  contact?: { phone?: string; website?: string; email?: string; socials?: string[] };
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
  wikidata?: string;
}

export type TravelMode = 'car' | 'walk' | 'bike';
/** What the directions screen can plan: the road modes plus public transport. */
export type DirectionsMode = TravelMode | 'transit';

/** Kinds of public transport, for icons and colours. */
export type TransitMode = 'bus' | 'coach' | 'rail' | 'tram' | 'subway' | 'ferry' | 'cable' | 'other';

export interface TransitStop {
  name: string;
  lng: number;
  lat: number;
  stopId?: string;
  /** Platform or track, when the operator publishes one. */
  track?: string;
}

/** One part of a public transport journey: a walk, or a ride on one line. */
export interface TransitLeg {
  kind: 'walk' | 'ride';
  mode?: TransitMode;
  from: TransitStop;
  to: TransitStop;
  /** ISO times; `scheduled*` differ from the actual times only with live data. */
  start: string;
  end: string;
  scheduledStart: string;
  scheduledEnd: string;
  realtime: boolean;
  distanceM?: number;
  /** Line number or name ("5", "רכבת ישראל"). */
  line?: string;
  headsign?: string;
  /** Hex colours without '#', from the operator. */
  color?: string;
  textColor?: string;
  agency?: string;
  /** Number of stops ridden. */
  stops?: number;
  geometry: LngLat[];
}

export interface TransitItinerary {
  start: string;
  end: string;
  durationS: number;
  transfers: number;
  walkM: number;
  legs: TransitLeg[];
}

/** A departure from a stop near the user. */
export interface Departure {
  stop: TransitStop;
  mode: TransitMode;
  line: string;
  headsign: string;
  time: string;
  scheduledTime: string;
  realtime: boolean;
  cancelled: boolean;
  color?: string;
  textColor?: string;
  agency?: string;
}

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
