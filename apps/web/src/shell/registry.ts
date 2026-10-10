import { signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';
import { placeActions, placeSections } from '@nm/core/app';
import type { UrlState } from '@nm/core';
import type { Fab, FeatureContext, HomeSection, MapClickHandler, MenuItem, Slot, Tab, ViewProps } from '@nm/core/app';

/** Everything features register lands here; the shell renders from it. */
export const views = new Map<string, { Component: ComponentType<ViewProps<any>>; title?: string; hideTop?: boolean }>();
export const fabs = signal<Fab[]>([]);
export const menuItems = signal<MenuItem[]>([]);
export const tabs = signal<Tab[]>([]);
export const homeSections = signal<HomeSection[]>([]);
export const slots = signal<{ slot: Slot; Component: ComponentType; order: number }[]>([]);

const clickHandlers: { handler: MapClickHandler; priority: number }[] = [];
const longPressHandlers: { handler: (p: { lng: number; lat: number }) => boolean | void; priority: number }[] = [];
const styleHooks: ((map: MapLibreMap) => void)[] = [];

export function createContext(map: MapLibreMap, initialUrl: UrlState): FeatureContext {
  return {
    map,
    initialUrl,
    registerView: (kind, Component, opts) => views.set(kind, { Component, title: opts?.title, hideTop: opts?.hideTop }),
    registerFab: (fab) => (fabs.value = [...fabs.value, fab].sort((a, b) => a.order - b.order)),
    registerMenuItem: (item) => (menuItems.value = [...menuItems.value, item].sort((a, b) => a.order - b.order)),
    registerTab: (t) => (tabs.value = [...tabs.value, t].sort((a, b) => a.order - b.order)),
    registerHomeSection: (s) => (homeSections.value = [...homeSections.value, s].sort((a, b) => a.order - b.order)),
    registerSlot: (slot, Component, order = 0) =>
      (slots.value = [...slots.value, { slot, Component, order }].sort((a, b) => a.order - b.order)),
    registerPlaceAction: (a) => (placeActions.value = [...placeActions.value, a].sort((x, y) => x.order - y.order)),
    registerPlaceSection: (a) => (placeSections.value = [...placeSections.value, a].sort((x, y) => x.order - y.order)),
    onMapClick: (handler, priority = 0) => {
      clickHandlers.push({ handler, priority });
      clickHandlers.sort((a, b) => b.priority - a.priority);
    },
    onMapLongPress: (handler, priority = 0) => {
      longPressHandlers.push({ handler, priority });
      longPressHandlers.sort((a, b) => b.priority - a.priority);
    },
    onStyle: (fn) => {
      styleHooks.push(fn);
      if (map.isStyleLoaded()) fn(map);
    },
  };
}

export function runStyleHooks(map: MapLibreMap): void {
  for (const fn of styleHooks) {
    try {
      fn(map);
    } catch (e) {
      console.error('style hook failed', e);
    }
  }
}

export function dispatchClick(e: MapMouseEvent, features: MapGeoJSONFeature[]): void {
  for (const { handler } of clickHandlers) if (handler(e, features) === true) return;
}

export function dispatchLongPress(p: { lng: number; lat: number }): void {
  for (const { handler } of longPressHandlers) if (handler(p) === true) return;
}
