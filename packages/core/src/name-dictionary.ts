/**
 * The names search corrects typos against, in two tiers:
 *  - the built-in dictionary (packages/core/src/names, ~3,500 names, ~26 KB gzipped), loaded
 *    lazily on the first search that needs it and indexed in a few tens of milliseconds;
 *  - a region's full names list from our own geodata (`<geodata>/<region>/names.json`, built
 *    from OpenStreetMap in CI: ~150,000 {n, k, w, c?} entries, ~10 MB). Never loaded at
 *    startup: only when a query found nothing good (or after a first search, in idle time),
 *    then kept in memory.
 */
import { makeIndex, makeIndexAsync, mergeNames, type FuzzyName, type NameIndex } from './fuzzy.ts';

let builtin: Promise<NameIndex> | null = null;
let builtinReady: NameIndex | null = null;

/** The built-in correction index (built once, lazily). */
export function nameIndex(): Promise<NameIndex> {
  builtin ??= import('./names/index.ts').then(({ BUILTIN_NAMES }) => (builtinReady = makeIndex(BUILTIN_NAMES)));
  return builtin;
}

/** The built-in index if it is already built (no waiting), for keystroke-time use. */
export function nameIndexNow(): NameIndex | null {
  if (!builtinReady) void nameIndex();
  return builtinReady;
}

/** Entries from a names file, or [] when it is not a names list. */
export function parseNamesFile(data: unknown): FuzzyName[] {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { names?: unknown }).names) ? (data as { names: unknown[] }).names : [];
  const out: FuzzyName[] = [];
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

/** Yield to the browser between chunks of indexing so typing stays smooth. */
const idle = () =>
  new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 100 }) : setTimeout(r, 0)));

const files = new Map<string, { promise: Promise<NameIndex | null>; ready: NameIndex | null }>();

/**
 * The built-in names plus a names file, indexed together (once per URL, then cached).
 * Null when the file is missing or broken; a failure is retried after a while.
 */
export function namesFileIndex(url: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<NameIndex | null> {
  const hit = files.get(url);
  if (hit) return hit.promise;
  const entry: { promise: Promise<NameIndex | null>; ready: NameIndex | null } = { promise: Promise.resolve(null), ready: null };
  entry.promise = (async () => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok || /html/.test(res.headers.get('content-type') ?? '')) throw new Error('no names file');
      const extra = parseNamesFile(await res.json());
      if (!extra.length) throw new Error('empty names file');
      const { BUILTIN_NAMES } = await import('./names/index.ts');
      entry.ready = await makeIndexAsync(mergeNames(BUILTIN_NAMES, extra), idle);
      return entry.ready;
    } catch {
      const t = setTimeout(() => files.get(url) === entry && files.delete(url), 5 * 60_000);
      (t as { unref?: () => void }).unref?.();
      return null;
    }
  })();
  files.set(url, entry);
  return entry.promise;
}

/** The names-file index if it is already loaded (no waiting). */
export function namesFileIndexNow(url: string): NameIndex | null {
  return files.get(url)?.ready ?? null;
}
