import type { ComponentType } from 'preact';
import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';
import type { View } from './state.ts';
import type { PlaceAction } from './extensions.ts';
import type { UrlState } from '../url-state.ts';

export interface ViewProps<P = Record<string, unknown>> {
  view: View & { props?: P };
}

export interface Fab {
  id: string;
  /** Lower = closer to the bottom. */
  order: number;
  Component: ComponentType;
}

/** A bottom tab on phones (Google's Explore / You / Contribute). Opens a panel view. */
export interface Tab {
  id: string;
  label: string;
  /** Material Symbols name. */
  icon: string;
  order: number;
  /** View kind the tab opens. */
  view: string;
}

export interface MenuItem {
  id: string;
  label: string;
  /** Material Symbols name (or an emoji). */
  icon: string;
  order: number;
  run: () => void;
}

export interface HomeSection {
  id: string;
  order: number;
  Component: ComponentType;
}

/** Return true to say "handled", which stops lower-priority handlers. */
export type MapClickHandler = (e: MapMouseEvent, features: MapGeoJSONFeature[]) => boolean | void;

/** top: above the map (search); controls: round buttons at the top edge (layers, compass); overlay: full screen. */
export type Slot = 'top' | 'controls' | 'overlay';

export interface FeatureContext {
  map: MapLibreMap;
  /** The URL the app was opened with, so features can restore their screen. */
  initialUrl: UrlState;
  registerSlot(slot: Slot, Component: ComponentType, order?: number): void;
  /** hideTop: the screen has its own header (directions), so the search bar steps aside. */
  registerView(kind: string, Component: ComponentType<ViewProps<any>>, opts?: { title?: string; hideTop?: boolean }): void;
  registerFab(fab: Fab): void;
  registerMenuItem(item: MenuItem): void;
  registerTab(tab: Tab): void;
  registerHomeSection(section: HomeSection): void;
  /** priority: higher runs first. */
  onMapClick(handler: MapClickHandler, priority?: number): void;
  registerPlaceAction(action: PlaceAction): void;
  registerPlaceSection(section: PlaceAction): void;
  onMapLongPress(handler: (lngLat: { lng: number; lat: number }) => void): void;
  /** Runs now (if the style is ready) and again after every style change (e.g. dark mode). */
  onStyle(fn: (map: MapLibreMap) => void): void;
}

export interface Feature {
  id: string;
  title: string;
  description?: string;
  /** Off-by-default features can be turned on from the menu or with ?flags=id. */
  enabledByDefault: boolean;
  setup(ctx: FeatureContext): void | (() => void);
}

export function defineFeature(f: Feature): Feature {
  return f;
}
