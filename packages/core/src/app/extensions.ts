import { signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import type { Place } from '../types.ts';

/**
 * Extension points: one feature adds UI inside another feature's screen without
 * importing it. E.g. "saved" adds a Save button to the place card.
 */
export interface PlaceAction {
  id: string;
  order: number;
  Component: ComponentType<{ place: Place }>;
}

export const placeActions = signal<PlaceAction[]>([]);
/** Extra rows under the place card details (e.g. "photos you took here"). */
export const placeSections = signal<PlaceAction[]>([]);
