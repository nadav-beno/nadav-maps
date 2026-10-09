import { signal } from '@preact/signals';
import { load, save } from './storage.ts';

/** Per-device feature switches: { featureId: true|false }. Unset = feature default. */
export const flagOverrides = signal<Record<string, boolean>>(load('flags', {}));
flagOverrides.subscribe((v) => save('flags', v));

/** ?flags=photos,-navigation turns features on/off for this visit and remembers it. */
export function applyUrlFlags(search: string): void {
  const raw = new URLSearchParams(search).get('flags');
  if (!raw) return;
  const next = { ...flagOverrides.value };
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.startsWith('-')) next[part.slice(1)] = false;
    else next[part] = true;
  }
  flagOverrides.value = next;
}

export function isEnabled(id: string, byDefault: boolean): boolean {
  return flagOverrides.value[id] ?? byDefault;
}

/** All features the app was built with (set by the shell), for the settings screen. */
export const featureCatalog = signal<{ id: string; title: string; description?: string; enabledByDefault: boolean }[]>([]);
