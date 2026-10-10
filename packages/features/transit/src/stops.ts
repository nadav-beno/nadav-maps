import type { Place } from '@nm/core';

const STOP_VALUES = new Set(['bus_stop', 'bus_station', 'station', 'halt', 'tram_stop', 'subway_entrance', 'platform', 'stop_position', 'stop_area', 'ferry_terminal']);
const OVERTURE_STOPS = /(bus_station|train_station|metro_station|light_rail|transportation|subway|tram|ferry|railway|bus_stop)/;

/** Places worth asking "what leaves from here": stops, stations, terminals. */
export function isTransitStop(p: Pick<Place, 'category'>): boolean {
  const c = p.category;
  if (!c) return false;
  if (c.key === 'overture') return OVERTURE_STOPS.test(c.value);
  if (c.key === 'public_transport') return true;
  if (c.key === 'highway' && c.value === 'bus_stop') return true;
  if ((c.key === 'railway' || c.key === 'amenity') && STOP_VALUES.has(c.value)) return true;
  return false;
}
