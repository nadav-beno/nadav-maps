import type { FuzzyName } from '../fuzzy.ts';
import { IL_NAMES } from './il.ts';
import { WORLD_NAMES } from './world.ts';

/** "hebrew|english|kind|weight|city" lines -> entries, one per language, each pointing at the other. */
export function parseNameLines(text: string, defaultKind = 'city'): FuzzyName[] {
  const out: FuzzyName[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [he, en, a, b, c] = line.split('|').map((s) => s?.trim());
    // World lines are "he|en|population" or "he|en|country".
    const kind = a && !/^\d+$/.test(a) ? a : defaultKind;
    const weight = kind === 'country' ? 500 : Number(/^\d+$/.test(a ?? '') ? a : b) || 1;
    const city = kind === a ? c : undefined;
    if (he) out.push({ n: he, k: kind, w: weight, ...(city ? { c: city } : {}), ...(en ? { alt: en } : {}) });
    if (en) out.push({ n: en, k: kind, w: weight, ...(city ? { c: city } : {}), ...(he ? { alt: he } : {}) });
  }
  return out;
}

/** The dictionary that ships with the app: Israel (hand-curated) and world cities and countries. */
export const BUILTIN_NAMES: FuzzyName[] = [...parseNameLines(IL_NAMES), ...parseNameLines(WORLD_NAMES)];
