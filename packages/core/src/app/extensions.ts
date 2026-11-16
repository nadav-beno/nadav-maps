import { signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import type { Place, PlaceDetails } from '../types.ts';

/**
 * Extension points: one feature adds UI inside another feature's screen without
 * importing it. E.g. "saved" adds a Save button to the place card.
 */
export interface PlaceAction {
  id: string;
  order: number;
  /** `details`: the place's full OSM details (tags…) once loaded, when it has them. */
  Component: ComponentType<{ place: Place; details?: PlaceDetails | null }>;
}

export const placeActions = signal<PlaceAction[]>([]);
/** Extra rows under the place card details (e.g. "photos you took here"). */
export const placeSections = signal<PlaceAction[]>([]);

/** Extra groups in the layers sheet (e.g. weather map layers), drawn after the built-in ones. */
export interface LayerSection {
  id: string;
  order: number;
  Component: ComponentType;
}
export const layerSections = signal<LayerSection[]>([]);

/** Adds (or replaces, by id) a group in the layers sheet. */
export function registerLayerSection(section: LayerSection): void {
  layerSections.value = [...layerSections.value.filter((s) => s.id !== section.id), section].sort((a, b) => a.order - b.order);
}

/**
 * Extra lines about a destination at the time of arrival (e.g. the weather when you get
 * there), shown under the chosen route in directions and under a flight's route.
 */
export interface ArrivalSection {
  id: string;
  order: number;
  /** `at`: the destination; `time`: expected arrival, Unix seconds; `name`: the destination's name. */
  Component: ComponentType<{ at: [number, number]; time: number; name?: string }>;
}
export const arrivalSections = signal<ArrivalSection[]>([]);

/** Adds (or replaces, by id) a line about the destination at arrival time. */
export function registerArrivalSection(section: ArrivalSection): void {
  arrivalSections.value = [...arrivalSections.value.filter((s) => s.id !== section.id), section].sort((a, b) => a.order - b.order);
}
