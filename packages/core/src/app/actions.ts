import { batch } from '@preact/signals';
import type { Place } from '../types.ts';
import { locationRequests, selectedPlace, sheet, toastMessage, viewStack, type View } from './state.ts';

/**
 * Navigation between panel screens. Features never import each other; they open
 * each other's screens by `kind` ("place", "directions", "results"...).
 */
export function open(view: View, opts: { replace?: boolean; reset?: boolean } = {}): void {
  batch(() => {
    const stack = opts.reset ? [] : viewStack.value;
    const top = stack[stack.length - 1];
    viewStack.value = opts.replace || top?.kind === view.kind ? [...stack.slice(0, -1), view] : [...stack, view];
    if (sheet.value === 'peek') sheet.value = 'half';
  });
}

export function back(): void {
  const stack = viewStack.value;
  if (!stack.length) return;
  batch(() => {
    viewStack.value = stack.slice(0, -1);
    const top = viewStack.value[viewStack.value.length - 1];
    if (!top || top.kind !== 'place') selectedPlace.value = null;
  });
}

export function home(): void {
  batch(() => {
    viewStack.value = [];
    selectedPlace.value = null;
  });
}

export function openPlace(place: Place, opts: { replace?: boolean } = {}): void {
  batch(() => {
    selectedPlace.value = place;
    open({ kind: 'place', props: { place, url: { place: place.id } } }, opts);
  });
}

export function directionsTo(to: Place, from?: Place): void {
  open({ kind: 'directions', props: { to, from } });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, action?: { label: string; run: () => void }, ms = 4000): void {
  toastMessage.value = { text, action };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMessage.value = null), ms);
}

export function requestLocation(): void {
  locationRequests.value++;
}
