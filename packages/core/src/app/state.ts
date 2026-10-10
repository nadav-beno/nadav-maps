import { computed, signal } from '@preact/signals';
import { DEFAULT_REGION, type Region } from '../region.ts';
import type { Place } from '../types.ts';
import type { Units } from '../format.ts';
import { DEFAULT_PROVIDERS, type ProviderConfig } from '../config.ts';
import { load, save } from './storage.ts';

/** A screen in the side panel / bottom sheet. Features register a component per `kind`. */
export interface View {
  kind: string;
  props?: Record<string, unknown>;
}

export type SheetSize = 'peek' | 'half' | 'full';
export type ThemePref = 'system' | 'light' | 'dark';

export interface UserLocation {
  lng: number;
  lat: number;
  accuracy: number;
  heading?: number | null;
  speed?: number | null;
  timestamp: number;
}

const systemDark =
  typeof matchMedia === 'function' ? signal(matchMedia('(prefers-color-scheme: dark)').matches) : signal(false);
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => (systemDark.value = e.matches));
}

export const theme = signal<ThemePref>(load<ThemePref>('theme', 'system'));
theme.subscribe((v) => save('theme', v));
export const isDark = computed(() => (theme.value === 'system' ? systemDark.value : theme.value === 'dark'));

export const unitsPref = signal<Units | 'auto'>(load<Units | 'auto'>('units', 'auto'));
unitsPref.subscribe((v) => save('units', v));

/** Base map look, chosen in the layers sheet. */
export type MapTypePref = 'default' | 'satellite' | 'terrain';
export const mapType = signal<MapTypePref>(load<MapTypePref>('mapType', 'default'));
mapType.subscribe((v) => save('mapType', v));
export interface MapLayers {
  transit: boolean;
  bike: boolean;
  buildings3d: boolean;
}
export const mapLayers = signal<MapLayers>({ transit: false, bike: false, buildings3d: true, ...load<Partial<MapLayers>>('mapLayers', {}) });
mapLayers.subscribe((v) => save('mapLayers', v));

/** Region under the map center, updated by the shell. */
export const region = signal<Region>(DEFAULT_REGION);
/** Data provider URLs in use (set by the shell from env). */
export const providers = signal<ProviderConfig>(DEFAULT_PROVIDERS);
export const units = computed<Units>(() => (unitsPref.value === 'auto' ? region.value.units : unitsPref.value));

/** View stack: the last entry is what the panel shows. Empty = home. */
export const viewStack = signal<View[]>([]);
export const currentView = computed<View>(() => viewStack.value[viewStack.value.length - 1] ?? { kind: 'home' });

export const sheet = signal<SheetSize>('peek');
export const selectedPlace = signal<Place | null>(null);
export const userLocation = signal<UserLocation | null>(null);
export const toastMessage = signal<{ text: string; action?: { label: string; run: () => void } } | null>(null);
/** Full-screen modes (navigation) hide the regular chrome. */
export const immersive = signal(false);

/** Bumped when a feature needs the user's location; the location feature starts GPS. */
export const locationRequests = signal(0);
