import type { LngLat } from '@nm/core';

/** One GPS fix as we keep it on the device. `t` is epoch milliseconds (and the storage key). */
export interface TrackPoint {
  t: number;
  lng: number;
  lat: number;
  /** Horizontal accuracy, metres. */
  acc?: number;
  /** Metres per second, when the device reports it. */
  speed?: number | null;
  /** Metres above sea level, when known. */
  alt?: number | null;
}

/** How a move was made. Recorded moves are one of walk/bike/car/train/flight; imports can say more. */
export type Mode = 'walk' | 'bike' | 'car' | 'bus' | 'train' | 'flight' | 'boat' | 'unknown';

/** What a stay was: a saved place, a business, an address... */
export interface PlaceRef {
  /** A place id the place card understands ("osm:n1", "ovt:<uuid>", "pt:lng,lat"). */
  id?: string;
  name: string;
  lng: number;
  lat: number;
  address?: string;
  category?: { key: string; value: string };
  /** Google's place id from an imported Timeline (no lookup API, kept for re-imports). */
  googlePlaceId?: string;
  /** Where the name came from, for the "why this name" hint. */
  source?: 'edit' | 'saved' | 'google' | 'map' | 'lookup';
  /** Home and work get their own icons. */
  semantic?: 'home' | 'work';
}

export interface Stay {
  kind: 'stay';
  id: string;
  start: number;
  end: number;
  lng: number;
  lat: number;
  place?: PlaceRef;
  semantic?: 'home' | 'work';
  source: 'gps' | 'google';
}

export interface Move {
  kind: 'move';
  id: string;
  start: number;
  end: number;
  mode: Mode;
  distanceM: number;
  path: LngLat[];
  source: 'gps' | 'google';
}

export type Seg = Stay | Move;

/** A correction the user made to a stay ("this was…"), keyed by the stay id. */
export interface StayEdit {
  id: string;
  place: PlaceRef;
  at: number;
}
