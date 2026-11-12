import { signal } from '@preact/signals';
import { load, save } from '@nm/core/app';
import type { AircraftKind, AircraftPosition } from '@nm/tools';

/** What the live map can be narrowed to, in the order the chips show. */
export type Group = 'airliner' | 'business' | 'light' | 'heli' | 'military';

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'airliner', label: 'נוסעים ומטען' },
  { id: 'business', label: 'מטוסי מנהלים' },
  { id: 'light', label: 'קלים ודאונים' },
  { id: 'heli', label: 'מסוקים' },
  { id: 'military', label: 'צבאיים' },
];

const GROUP_OF: Record<AircraftKind, Group> = {
  jet: 'airliner',
  heavy: 'airliner',
  prop: 'airliner',
  bizjet: 'business',
  light: 'light',
  glider: 'light',
  balloon: 'light',
  drone: 'light',
  heli: 'heli',
  fighter: 'military',
};

/** The kind in words, for the aircraft card. */
export const KIND_NAME: Record<AircraftKind, string> = {
  jet: 'מטוס סילון',
  heavy: 'מטוס רחב גוף',
  prop: 'מטוס טורבו-פרופ',
  bizjet: 'מטוס מנהלים',
  light: 'מטוס קל',
  heli: 'מסוק',
  fighter: 'מטוס קרב',
  glider: 'דאון',
  balloon: 'כדור פורח',
  drone: 'רחפן',
};

export const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

export function groupOf(a: Pick<AircraftPosition, 'kind' | 'military'>): Group {
  if (a.military) return 'military';
  return GROUP_OF[a.kind ?? 'jet'];
}

export interface Filters {
  /** Groups switched off. */
  hide: Group[];
  /** Only aircraft in the air (hide the ones on the ground). */
  air: boolean;
  /** Only aircraft squawking an emergency. */
  emergency: boolean;
  /** Callsign prefix ("ELY" for El Al), '' = all. */
  airline: string;
  /** Lowest and highest altitude in metres, null = no limit. */
  minM: number | null;
  maxM: number | null;
}

export const NO_FILTERS: Filters = { hide: [], air: false, emergency: false, airline: '', minM: null, maxM: null };

const KEY = 'nm:flights:filters';
export const filters = signal<Filters>({ ...NO_FILTERS, ...load<Partial<Filters>>(KEY, {}) });

export function setFilters(next: Partial<Filters>): void {
  filters.value = { ...filters.peek(), ...next };
  save(KEY, filters.peek());
}

export const isFiltered = (f: Filters) => f.hide.length > 0 || f.air || f.emergency || !!f.airline || f.minM !== null || f.maxM !== null;

export function passes(a: AircraftPosition, f: Filters): boolean {
  if (f.hide.length && f.hide.includes(groupOf(a))) return false;
  if (f.air && a.onGround) return false;
  if (f.emergency && !(a.squawk && EMERGENCY_SQUAWKS.has(a.squawk))) return false;
  if (f.airline && !a.callsign.toUpperCase().replace(/\s/g, '').startsWith(f.airline.toUpperCase())) return false;
  const m = a.onGround ? 0 : a.altitudeM;
  if (f.minM !== null && (m === null || m < f.minM)) return false;
  if (f.maxM !== null && (m === null || m > f.maxM)) return false;
  return true;
}

/** Flights the user keeps an eye on (saved on this device only). */
export interface SavedFlight {
  callsign: string;
  hex: string;
  /** What it was when saved, for the list ("B789 · 4X-EDF"). */
  label?: string;
}

const SAVED_KEY = 'nm:flights:saved';
export const savedFlights = signal<SavedFlight[]>(load<SavedFlight[]>(SAVED_KEY, []));

export const isSaved = (a: Pick<AircraftPosition, 'hex' | 'callsign'>) =>
  savedFlights.value.some((s) => s.hex === a.hex || (!!a.callsign && s.callsign === a.callsign));

export function toggleSaved(a: AircraftPosition): boolean {
  const list = savedFlights.peek();
  const on = list.some((s) => s.hex === a.hex || (!!a.callsign && s.callsign === a.callsign));
  savedFlights.value = on
    ? list.filter((s) => s.hex !== a.hex && (!a.callsign || s.callsign !== a.callsign))
    : [{ callsign: a.callsign, hex: a.hex, label: [a.type, a.registration].filter(Boolean).join(' · ') || undefined }, ...list].slice(0, 30);
  save(SAVED_KEY, savedFlights.peek());
  return !on;
}
