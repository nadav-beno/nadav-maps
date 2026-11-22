/**
 * Every aircraft in the world, from feeds that only answer "what is within 250 NM of this point".
 *
 * The world is cut into a fixed grid of cells, each covered by one 250 NM circle. Each cell's
 * aircraft are cached (in Postgres for the Supabase relay, in memory elsewhere) and shared by
 * every viewer: a request for a map area returns what the cache has for the cells in it and
 * refreshes a few of the stalest cells, so the upstream load grows with the area being watched,
 * not with the number of viewers. Empty cells (oceans, deserts) are rechecked once an hour.
 * A sweep once a minute (sweepCells) keeps the whole world fresh even when no one is watching.
 *
 * No imports: this file runs in the Supabase Edge Function, in apps/server and in unit tests.
 */

export type Box = [west: number, south: number, east: number, north: number];

/** Latitude band height, degrees (556 km). */
export const BAND_DEG = 5;
/** Widest cell, km, so that a cell's half diagonal fits in a 250 NM (463 km) circle. */
const CELL_KM = 740;
const KM_PER_DEG = 111.32;
export const CELL_RADIUS_NM = 250;

/** Seconds before a cell is refreshed: busy cells often, empty ones rarely. */
export const BUSY_S = 30;
export const EMPTY_S = 3600;
/** A cell being refreshed is left to that request for this long. */
export const CLAIM_S = 20;
/** Positions older than this at fetch time are dropped (the aircraft left coverage). */
const MAX_SEEN_S = 60;

interface Band {
  south: number;
  cols: number;
  step: number;
}

const BANDS: Band[] = [];
for (let south = -90; south < 90; south += BAND_DEG) {
  // Widest at the edge nearer the equator.
  const edge = Math.min(Math.abs(south), Math.abs(south + BAND_DEG));
  const km = 360 * KM_PER_DEG * Math.cos((edge * Math.PI) / 180);
  const cols = Math.max(1, Math.ceil(km / CELL_KM));
  BANDS.push({ south, cols, step: 360 / cols });
}

/** How many cells cover the world. */
export const CELL_COUNT = BANDS.reduce((n, b) => n + b.cols, 0);

/** Cell id = band index * 1000 + column. */
export function cellCenter(id: number): { lat: number; lon: number } {
  const band = BANDS[Math.floor(id / 1000)];
  const col = id % 1000;
  if (!band || col >= band.cols) throw new Error(`no cell ${id}`);
  return { lat: band.south + BAND_DEG / 2, lon: round(-180 + (col + 0.5) * band.step) };
}

/** The cells that touch a box (west <= east, no antimeridian crossing). */
export function cellsIn([w, s, e, n]: Box): number[] {
  const out: number[] = [];
  BANDS.forEach((band, i) => {
    if (band.south >= n || band.south + BAND_DEG <= s) return;
    const c0 = Math.max(0, Math.floor((w + 180) / band.step));
    const c1 = Math.min(band.cols - 1, Math.floor((Math.min(e, 179.9999) + 180) / band.step));
    for (let c = c0; c <= c1; c++) out.push(i * 1000 + c);
  });
  return out;
}

const round = (v: number, f = 1000) => Math.round(v * f) / f;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * One aircraft, compact (thousands go to the browser at once):
 * [hex, callsign, lon, lat, altitude ft (-1 = on the ground, null = unknown), track, ground speed kt,
 *  seconds since the position, emitter category, ICAO type, registration, squawk, vertical rate ft/min, db flags]
 */
export type Row = [
  hex: string,
  callsign: string | null,
  lon: number,
  lat: number,
  altFt: number | null,
  track: number | null,
  gsKt: number | null,
  ageS: number,
  category: string | null,
  type: string | null,
  reg: string | null,
  squawk: string | null,
  rateFpm: number | null,
  flags: number | null,
];

/** A readsb-style answer (adsb.lol `ac`, adsb.fi `aircraft`) as compact rows. */
export function compactAircraft(json: unknown): Row[] {
  const root = (json ?? {}) as { ac?: unknown; aircraft?: unknown };
  const list = Array.isArray(root.ac) ? root.ac : Array.isArray(root.aircraft) ? root.aircraft : [];
  const out: Row[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const lat = num(a.lat), lon = num(a.lon);
    const hex = str(a.hex)?.replace(/^~/, '').toLowerCase();
    if (lat === null || lon === null || !hex || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const cat = str(a.category);
    if (cat && cat[0].toUpperCase() === 'C') continue; // ground vehicles and obstacles
    const age = num(a.seen_pos) ?? num(a.seen) ?? 0;
    if (age > MAX_SEEN_S) continue;
    const alt = a.alt_baro === 'ground' ? -1 : num(a.alt_geom) ?? num(a.alt_baro);
    const trk = num(a.track) ?? num(a.true_heading);
    const gs = num(a.gs);
    const rate = num(a.geom_rate) ?? num(a.baro_rate);
    out.push([
      hex,
      str(a.flight),
      round(lon),
      round(lat),
      alt === null ? null : Math.round(alt),
      trk === null ? null : Math.round(trk),
      gs === null ? null : Math.round(gs),
      Math.round(age),
      cat,
      str(a.t),
      str(a.r),
      str(a.squawk),
      rate === null ? null : Math.round(rate),
      num(a.dbFlags),
    ]);
  }
  return out;
}

export interface CachedCell {
  id: number;
  /** When it was fetched, epoch ms. */
  at: number;
  rows: Row[];
}

/** Where cells are kept. `take` also claims up to `max` stale cells for the caller to refresh. */
export interface CellStore {
  /** Claims never-fetched cells first, then the most overdue ones, within BUDGET per 10 s. */
  take(ids: number[], max: number, now: number): Promise<{ cells: CachedCell[]; claim: number[]; unknown: number }>;
  put(cells: { id: number; rows: Row[] }[], now: number): Promise<void>;
}

/** An in-memory store (one process: apps/server, tests). */
export function memoryStore(): CellStore {
  const cells = new Map<number, { at: number | null; claimed: number | null; rows: Row[] }>();
  const recent: number[] = [];
  return {
    async take(ids, max, now) {
      while (recent.length && now - recent[0] > 10_000) recent.shift();
      const stale: { id: number; over: number; rank: number }[] = [];
      const out: CachedCell[] = [];
      let unknown = 0;
      for (const id of ids) {
        const c = cells.get(id);
        if (!c || c.at === null) unknown++;
        if (c?.at != null && c.rows.length) out.push({ id, at: c.at, rows: c.rows });
        const due = !c || c.at === null || now - c.at > (c.rows.length ? BUSY_S : EMPTY_S) * 1000;
        const free = !c?.claimed || now - c.claimed > CLAIM_S * 1000;
        // Never fetched first, then the most overdue (age over its refresh interval), so empty
        // cells are still rechecked while busy ones are always due.
        if (due && free) stale.push({ id, rank: !c || c.at === null ? 0 : 1, over: c?.at == null ? 0 : (now - c.at) / ((c.rows.length ? BUSY_S : EMPTY_S) * 1000) });
      }
      const room = Math.max(0, Math.min(max, BUDGET - recent.length));
      const claim = stale.sort((x, y) => x.rank - y.rank || y.over - x.over).slice(0, room).map((c) => c.id);
      for (const id of claim) {
        cells.set(id, { at: cells.get(id)?.at ?? null, rows: cells.get(id)?.rows ?? [], claimed: now });
        recent.push(now);
      }
      return { cells: out, claim, unknown };
    },
    async put(list, now) {
      for (const c of list) cells.set(c.id, { at: now, claimed: null, rows: c.rows });
    },
  };
}

/** Cells kept in Postgres through PostgREST (the Supabase relay); see supabase/migrations. */
export function postgrestStore(baseUrl: string, key: string, fetcher: typeof fetch = fetch): CellStore {
  const rpc = async (name: string, body: unknown) => {
    const res = await fetcher(`${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  return {
    async take(ids, max) {
      const r = (await rpc('flight_cells_claim', { ids, max_claim: max, busy_s: BUSY_S, empty_s: EMPTY_S, claim_s: CLAIM_S, budget: BUDGET })) as {
        cells?: [number, number, Row[]][];
        claim?: number[];
        unknown?: number;
      };
      return {
        cells: (r.cells ?? []).map(([id, at, rows]) => ({ id, at: at * 1000, rows })),
        claim: r.claim ?? [],
        unknown: r.unknown ?? 0,
      };
    },
    async put(cells) {
      await rpc('flight_cells_put', { cells });
    },
  };
}

/**
 * The feeds a cell is read from (readsb format, 250 NM around a point). adsb.fi asks for at most
 * one request a second. adsb.lol is not one of them: without a key it allows 500 requests a day
 * per IP, and our key is kept for close-up maps and flight tracks. airplanes.live answers 403 to
 * Supabase's servers until they approve the project by email. More feeds here = more lanes.
 */
export const FEEDS: { name: string; gapMs: number; url: (lat: number, lon: number) => string }[] = [
  { name: 'adsb.fi', gapMs: 1100, url: (lat, lon) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${CELL_RADIUS_NM}` },
];

export function cellUrls(id: number): string[] {
  const { lat, lon } = cellCenter(id);
  return FEEDS.map((f) => f.url(lat, lon));
}

/**
 * The feeds rate-limit by IP and every relay instance shares a few IPs. So refreshes are spread
 * out: at most BUDGET cells per 10 s across all viewers and the sweep (counted in the store),
 * each viewer request takes at most MAX_REFRESH of them, and each feed is its own lane of
 * requests one after another (about one a second each, so BUDGET = 9 x the feeds).
 */
export const MAX_REFRESH = 8;
export const BUDGET = 9 * FEEDS.length;

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Fetches the claimed cells (spread over the feeds, one lane each) and stores what came back. */
export async function refreshCells(
  store: CellStore,
  ids: number[],
  upstream: typeof fetch,
  ua: string,
  now: () => number,
  gaps: number[] = FEEDS.map((f) => f.gapMs),
): Promise<number> {
  let stored = 0;
  await Promise.all(
    FEEDS.map(async (feed, lane) => {
      const list = ids.filter((_, i) => i % FEEDS.length === lane);
      for (let i = 0; i < list.length; i++) {
        if (i) await wait(gaps[lane] ?? feed.gapMs);
        const id = list[i];
        try {
          const res = await upstream(cellUrls(id)[lane], { headers: { accept: 'application/json', 'user-agent': ua }, signal: AbortSignal.timeout(10_000) });
          // Rate limited or refused: stop this lane; its cells stay claimed for a little while, then retry.
          if (res.status === 429 || res.status === 403) return;
          if (!res.ok) continue;
          const rows = compactAircraft(await res.json());
          await store.put([{ id, rows }], now());
          stored++;
        } catch {
          /* the cell is retried after its claim runs out */
        }
      }
    }),
  );
  return stored;
}

/** Every cell id in the world. */
export const ALL_CELLS: number[] = BANDS.flatMap((b, i) => Array.from({ length: b.cols }, (_, c) => i * 1000 + c));

/**
 * Keeps the whole world warm without anyone watching: for `ms`, claims the most overdue cells
 * anywhere (within the shared budget) and refreshes them. Run once a minute (pg_cron calls the
 * relay with `{ sweep: true }`), so the zoomed-out map shows every aircraft from its first second.
 */
export async function sweepCells(
  store: CellStore,
  upstream: typeof fetch,
  opts: { ms?: number; now?: () => number; ua?: string; gaps?: number[]; idleMs?: number } = {},
): Promise<number> {
  const now = opts.now ?? Date.now;
  const end = now() + (opts.ms ?? 50_000);
  let stored = 0;
  while (now() < end) {
    const started = now();
    const { claim } = await store.take(ALL_CELLS, BUDGET, started);
    if (claim.length) stored += await refreshCells(store, claim, upstream, opts.ua ?? 'NadavMaps', now, opts.gaps);
    // The budget is per 10 s: wait for the rest of the window before claiming again.
    const left = Math.max(opts.idleMs ?? 0, 10_000 - (now() - started));
    if (now() + left >= end) break;
    if (left > 0) await wait(left);
  }
  return stored;
}

export interface WorldAnswer {
  /** Epoch ms of the answer. */
  at: number;
  /** Seconds in each row are since the position, as of `at`. */
  ac: Row[];
  /** Cells in the area, and how many have never been fetched (the client asks again soon). */
  cells: number;
  pending: number;
}

/**
 * The aircraft in a box from the cache, refreshing the stalest cells. With `defer` (the Edge
 * runtime's waitUntil) the refresh runs after the answer, so answers never wait for a feed.
 */
export async function worldAircraft(
  box: Box,
  store: CellStore,
  upstream: typeof fetch,
  opts: { now?: () => number; defer?: (p: Promise<unknown>) => void; ua?: string; max?: number; gaps?: number[] } = {},
): Promise<WorldAnswer> {
  const now = opts.now ?? Date.now;
  const [w, s, e, n] = box;
  const ids = cellsIn(box);
  const t = now();
  const { cells, claim, unknown } = await store.take(ids, opts.max ?? MAX_REFRESH, t);
  const refresh = claim.length ? refreshCells(store, claim, upstream, opts.ua ?? 'NadavMaps', now, opts.gaps) : null;
  let all = cells;
  let pending = unknown;
  if (refresh && opts.defer) opts.defer(refresh.catch(() => 0));
  else if (refresh) {
    await refresh.catch(() => 0);
    const again = await store.take(ids, 0, now());
    all = again.cells;
    pending = again.unknown;
  }
  const at = now();
  // Neighbouring circles overlap: one row per aircraft, the freshest.
  const best = new Map<string, Row>();
  for (const c of all) {
    const extra = Math.round((at - c.at) / 1000);
    for (const r of c.rows) {
      if (r[2] < w || r[2] > e || r[3] < s || r[3] > n) continue;
      const age = r[7] + extra;
      const prev = best.get(r[0]);
      if (!prev || age < prev[7]) {
        const copy = r.slice() as Row;
        copy[7] = age;
        best.set(r[0], copy);
      }
    }
  }
  return { at, ac: [...best.values()], cells: ids.length, pending };
}
