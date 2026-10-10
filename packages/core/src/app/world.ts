import { signal } from '@preact/signals';
import { decodeWorld, type World, type WorldFile } from '../world.ts';

/** Where the bundled world map is served (the shell points it at its base path). */
export const worldUrl = signal('offline/world-1.json');

let pending: Promise<World> | null = null;

/** Loads the bundled world map once (from the service worker's cache when offline). */
export function loadWorld(): Promise<World> {
  if (!pending) {
    const url = new URL(worldUrl.peek(), document.baseURI).href;
    pending = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`world map ${r.status}`);
        return r.json() as Promise<WorldFile>;
      })
      .then(decodeWorld);
    // A failed load (no network, no cache yet) may succeed later.
    pending.catch(() => (pending = null));
  }
  return pending;
}
