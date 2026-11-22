import { signal } from '@preact/signals';
import { flagOf, isStopped, shipAlert, shipCategory, type ShipCategory } from '@nm/core';
import { load, save } from '@nm/core/app';
import type { Ship } from '@nm/tools';

/** What the ships map can be narrowed to (kept per device, like the flights filters). */
export interface ShipFilters {
  /** Kinds switched off. */
  hide: ShipCategory[];
  /** Only ships under way (hide anchored and moored ones). */
  moving: boolean;
  /** Only ships and beacons in distress. */
  alerts: boolean;
  /** Flag state (ISO 3166 alpha-2), '' = all. */
  flag: string;
  /** Shortest length in metres, 0 = no limit (ships that don't report a length are hidden then). */
  minLen: number;
}

export const NO_SHIP_FILTERS: ShipFilters = { hide: [], moving: false, alerts: false, flag: '', minLen: 0 };

const KEY = 'nm:ships:filters';
// The old "hidden kinds" list (before the filters panel) is carried over.
export const filters = signal<ShipFilters>({ ...NO_SHIP_FILTERS, hide: load<ShipCategory[]>('nm:ships:hide', []), ...load<Partial<ShipFilters>>(KEY, {}) });

export function setFilters(next: Partial<ShipFilters>): void {
  filters.value = { ...filters.peek(), ...next };
  save(KEY, filters.peek());
}

export const isFiltered = (f: ShipFilters) => f.hide.length > 0 || f.moving || f.alerts || !!f.flag || f.minLen > 0;

export function passes(s: Ship, f: ShipFilters): boolean {
  if (f.hide.length && f.hide.includes(shipCategory(s.type))) return false;
  if (f.moving && isStopped(s)) return false;
  if (f.alerts && !shipAlert(s)) return false;
  if (f.flag && flagOf(s.mmsi) !== f.flag) return false;
  if (f.minLen && (s.length ?? 0) < f.minLen) return false;
  return true;
}

/** How many ships of each kind, and of each flag (most common first), for the chips and the flag list. */
export function tally(ships: Ship[]): { byCat: Record<ShipCategory, number>; flags: [string, number][] } {
  const byCat = {} as Record<ShipCategory, number>;
  const flags = new Map<string, number>();
  for (const s of ships) {
    const c = shipCategory(s.type);
    byCat[c] = (byCat[c] ?? 0) + 1;
    const fl = flagOf(s.mmsi);
    if (fl) flags.set(fl, (flags.get(fl) ?? 0) + 1);
  }
  return { byCat, flags: [...flags].sort((a, b) => b[1] - a[1]) };
}
