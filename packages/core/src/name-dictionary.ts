/**
 * The names search corrects typos against. The built-in dictionary (packages/core/src/names)
 * is loaded lazily, on the first search that needs it. A bigger list built elsewhere (e.g.
 * from OpenStreetMap in CI: a JSON array of {n: name, k: kind, w: weight, c?: city}) can be
 * plugged in with useNamesFile(url); when that file is missing or broken, the built-in one
 * is used alone.
 */
import { makeIndex, mergeNames, type NameEntry, type NameIndex } from './fuzzy.ts';

let fileUrl: string | null = null;
let fetchImpl: typeof fetch | null = null;
let indexPromise: Promise<NameIndex> | null = null;
let ready: NameIndex | null = null;

/** Use a names file (if it exists) next to the built-in dictionary. Call before the first search. */
export function useNamesFile(url: string | null, f: typeof fetch = (...a) => fetch(...a)): void {
  fileUrl = url;
  fetchImpl = f;
  indexPromise = null;
  ready = null;
}

/** Entries from a names file, or [] when it is not there or not a names list. */
export function parseNamesFile(data: unknown): NameEntry[] {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { names?: unknown }).names) ? (data as { names: unknown[] }).names : [];
  const out: NameEntry[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    if (typeof e.n !== 'string' || !e.n.trim() || e.n.length > 120) continue;
    out.push({
      n: e.n,
      k: typeof e.k === 'string' ? e.k : undefined,
      w: typeof e.w === 'number' && e.w >= 0 ? e.w : undefined,
      c: typeof e.c === 'string' ? e.c : undefined,
      alt: typeof e.alt === 'string' ? e.alt : undefined,
    });
  }
  return out;
}

async function loadFile(): Promise<NameEntry[]> {
  if (!fileUrl || !fetchImpl) return [];
  try {
    const res = await fetchImpl(fileUrl);
    if (!res.ok || !/json/.test(res.headers.get('content-type') ?? 'application/json')) return [];
    return parseNamesFile(await res.json());
  } catch {
    return [];
  }
}

/** Yield to the browser between chunks of work so typing stays smooth. */
const idle = () =>
  new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 0)));

/** The correction index (built once, lazily). */
export function nameIndex(): Promise<NameIndex> {
  indexPromise ??= (async () => {
    const [{ BUILTIN_NAMES }, extra] = await Promise.all([import('./names/index.ts'), loadFile()]);
    await idle();
    ready = makeIndex(extra.length ? mergeNames(BUILTIN_NAMES, extra) : BUILTIN_NAMES);
    return ready;
  })();
  return indexPromise;
}

/** The index if it is already built (no waiting), for keystroke-time use. */
export function nameIndexNow(): NameIndex | null {
  if (!ready) void nameIndex();
  return ready;
}
