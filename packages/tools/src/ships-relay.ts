/**
 * The ships relay: our Supabase Edge Function "ships" (`supabase/functions/ships/`).
 *
 * aisstream.io streams AIS (ship positions) worldwide for free, but only over a WebSocket with a
 * key, and its terms forbid connecting from the browser. So the relay holds the key, keeps at
 * most ONE stream open at a time for everyone (an account may open 3), and caches what it hears in
 * Postgres (`supabase/migrations/*_ships.sql`). Viewers ask for a box and get what is cached in it;
 * asking also marks the box's 10° tiles as wanted, and whoever finds no stream running starts one
 * for the most recently wanted tiles, listens for half a minute in the background and stores it.
 *
 * No imports, so the same file runs in Deno (Edge Function), in Node (apps/server) and in tests.
 *
 * Request: `POST` JSON `{ box: [w, s, e, n] }` -> `{ ships: ShipRow[], at, live }`, or
 * `{ track: mmsi }` -> `{ track: [lng, lat, unixSeconds][] }` (the last hours, kept 12 h).
 * The box travels in the body, so the map area never lands in request logs.
 */

export type Box = [number, number, number, number];

/**
 * One ship as the relay sends it (an array keeps thousands of them small):
 * [mmsi, lng, lat, sog kn, cog °, heading °, nav status, position time (unix s), name, type code,
 *  length m, beam m, draught m, destination, eta "MM-DDTHH:MM" UTC, imo, call sign]
 */
export type ShipRow = [
  number, number, number, number | null, number | null, number | null, number | null, number,
  string | null, number | null, number | null, number | null, number | null, string | null, string | null, number | null, string | null,
];

/** What one AIS message tells us about a ship. Missing fields are unknown, not cleared. */
export interface ShipUpdate {
  mmsi: number;
  lng?: number;
  lat?: number;
  sog?: number | null;
  cog?: number | null;
  hdg?: number | null;
  nav?: number | null;
  /** Position time, unix seconds. */
  at?: number;
  name?: string;
  callsign?: string;
  imo?: number;
  type?: number;
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  draught?: number;
  dest?: string;
  eta?: string;
}

export interface ShipStore {
  /**
   * Ships in the box; marks `tiles` as wanted. With `stream`, tries to take the stream lease:
   * `boxes` = the recently wanted tiles to stream, when this caller got it.
   */
  get(box: Box, max: number, tiles: number[], stream: boolean): Promise<{ ships: ShipRow[]; boxes: Box[] | null }>;
  put(updates: ShipUpdate[], done: boolean): Promise<void>;
  track(mmsi: number): Promise<[number, number, number][]>;
}

export interface MiniSocket {
  binaryType?: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ShipsRelayOptions {
  store?: ShipStore;
  /** The aisstream.io key; without it the relay only serves what is cached. */
  key?: string;
  /** Runs work after the answer is sent (the Edge runtime's waitUntil). */
  defer?: (p: Promise<unknown>) => void;
  /** Opens the stream (injected in tests). */
  socket?: (url: string) => MiniSocket;
  /** How long one collection listens (ms). */
  listenMs?: number;
}

export const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
/** One collection: how long, and at most how many messages (the free Edge runtime allows ~2 s CPU). */
export const LISTEN_MS = 30_000;
export const MAX_MESSAGES = 7_000;
/** At most this many 10° tiles per collection. */
export const MAX_TILES = 8;
export const MAX_SHIPS = 4_000;
/** A view asks for its tiles only when it covers at most this many (about a 40° x 30° map). */
export const WANT_TILES = 16;

/** Sites allowed to use the relay. */
export const SHIPS_ORIGINS = [/^https:\/\/nadav-beno\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

/** A valid box: four finite numbers, west <= east, south <= north, inside the world. */
export function shipBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [w, s, e, n] = v as Box;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w > e || s > n) return null;
  return [w, s, e, n];
}

/** The 10° tiles (id = row * 36 + col) covering a box. */
export function tilesOf([w, s, e, n]: Box): number[] {
  const c0 = Math.max(0, Math.floor((w + 180) / 10)), c1 = Math.min(35, Math.floor((Math.min(e, 179.999) + 180) / 10));
  const r0 = Math.max(0, Math.floor((s + 90) / 10)), r1 = Math.min(17, Math.floor((Math.min(n, 89.999) + 90) / 10));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * 36 + c);
  return out;
}

export function tileBox(id: number): Box {
  const r = Math.floor(id / 36), c = id % 36;
  return [c * 10 - 180, r * 10 - 90, c * 10 - 170, r * 10 - 80];
}

// ---------- aisstream messages ----------

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || undefined;
};
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-14 11:16:50.12 +0000 UTC" -> unix seconds. */
function utcSeconds(v: unknown, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const t = Date.parse(v.slice(0, 19).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? Math.round(t / 1000) : fallback;
}

function position(u: ShipUpdate, p: Record<string, unknown>, at: number) {
  const lat = num(p.Latitude), lng = num(p.Longitude);
  if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return;
  u.lat = lat;
  u.lng = lng;
  u.at = at;
  const sog = num(p.Sog), cog = num(p.Cog), hdg = num(p.TrueHeading);
  u.sog = sog === undefined || sog >= 102.3 ? null : Math.round(sog * 10) / 10;
  u.cog = cog === undefined || cog >= 360 ? null : Math.round(cog);
  u.hdg = hdg === undefined || hdg >= 360 ? null : hdg;
  if (num(p.NavigationalStatus) !== undefined) u.nav = num(p.NavigationalStatus)!;
}

function dims(u: ShipUpdate, d: unknown) {
  if (!d || typeof d !== 'object') return;
  const x = d as Record<string, unknown>;
  u.a = num(x.A);
  u.b = num(x.B);
  u.c = num(x.C);
  u.d = num(x.D);
}

/** One aisstream message to what it tells us, or null for messages we don't use. */
export function parseAisstream(m: unknown, nowS = Math.round(Date.now() / 1000)): ShipUpdate | null {
  if (!m || typeof m !== 'object') return null;
  const msg = m as { MessageType?: string; MetaData?: Record<string, unknown>; Message?: Record<string, Record<string, unknown>> };
  const meta = msg.MetaData ?? {};
  const mmsi = num(meta.MMSI);
  const type = msg.MessageType ?? '';
  const body = msg.Message?.[type];
  if (!mmsi || mmsi < 1e8 || mmsi > 999_999_999 || !body) return null;
  const at = Math.min(nowS, utcSeconds(meta.time_utc ?? meta.TimeUtc, nowS));
  const u: ShipUpdate = { mmsi };
  const metaName = text(meta.ShipName);
  if (type === 'PositionReport' || type === 'StandardClassBPositionReport' || type === 'ExtendedClassBPositionReport') {
    position(u, body, at);
    if (type === 'ExtendedClassBPositionReport') {
      u.name = text(body.Name);
      if (num(body.Type)) u.type = num(body.Type);
      dims(u, body.Dimension);
    }
    if (!u.name && metaName) u.name = metaName;
  } else if (type === 'ShipStaticData') {
    u.name = text(body.Name) ?? metaName;
    u.callsign = text(body.CallSign);
    if (num(body.ImoNumber)) u.imo = num(body.ImoNumber);
    if (num(body.Type)) u.type = num(body.Type);
    dims(u, body.Dimension);
    const dr = num(body.MaximumStaticDraught);
    if (dr) u.draught = dr;
    u.dest = text(body.Destination);
    const e = body.Eta as Record<string, unknown> | undefined;
    const mo = num(e?.Month), da = num(e?.Day);
    if (mo && da && mo <= 12 && da <= 31) {
      const h = num(e?.Hour) ?? 0, mi = num(e?.Minute) ?? 0;
      u.eta = `${pad(mo)}-${pad(da)}T${pad(h < 24 ? h : 0)}:${pad(mi < 60 ? mi : 0)}`;
    }
  } else if (type === 'StaticDataReport') {
    const a = body.ReportA as Record<string, unknown> | undefined;
    const b = body.ReportB as Record<string, unknown> | undefined;
    if (a?.Valid) u.name = text(a.Name);
    if (b?.Valid) {
      if (num(b.ShipType)) u.type = num(b.ShipType);
      u.callsign = text(b.CallSign);
      dims(u, b.Dimension);
    }
    if (!u.name && metaName) u.name = metaName;
  } else {
    return null;
  }
  for (const k of Object.keys(u) as (keyof ShipUpdate)[]) if (u[k] === undefined) delete u[k];
  return Object.keys(u).length > 1 ? u : null;
}

/** Folds an update into what we have for that ship (newest position wins; static fields fill in). */
export function mergeUpdate(into: Map<number, ShipUpdate>, u: ShipUpdate) {
  const prev = into.get(u.mmsi);
  if (!prev) return void into.set(u.mmsi, { ...u });
  const newer = u.at !== undefined && (prev.at === undefined || u.at >= prev.at);
  for (const [k, v] of Object.entries(u) as [keyof ShipUpdate, unknown][]) {
    if (['lng', 'lat', 'sog', 'cog', 'hdg', 'at'].includes(k) && !newer) continue;
    (prev as unknown as Record<string, unknown>)[k] = v;
  }
}

// ---------- the stream ----------

/** Listens to aisstream for `boxes`, storing what it hears every few seconds. Never throws. */
export async function collect(boxes: Box[], key: string, store: ShipStore, open: (url: string) => MiniSocket, listenMs = LISTEN_MS): Promise<number> {
  const pending = new Map<number, ShipUpdate>();
  let count = 0;
  let flushing: Promise<void> = Promise.resolve();
  const flush = (done: boolean) => {
    const batch = [...pending.values()];
    pending.clear();
    flushing = flushing.then(() => (batch.length || done ? store.put(batch, done) : undefined)).catch(() => {});
    return flushing;
  };
  await new Promise<void>((resolve) => {
    let ws: MiniSocket;
    let ended = false;
    const decoder = new TextDecoder();
    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      clearTimeout(stopper);
      try {
        ws.close();
      } catch {
        /* closed already */
      }
      resolve();
    };
    const timer = setInterval(() => void flush(false), 5000);
    const stopper = setTimeout(end, listenMs);
    try {
      ws = open(AISSTREAM_URL);
    } catch {
      return end();
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.send(JSON.stringify({
        APIKey: key,
        // aisstream boxes are [[lat, lng], [lat, lng]] corners.
        BoundingBoxes: boxes.map(([w, s, e, n]) => [[s, w], [n, e]]),
        FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'],
      }));
    };
    ws.onmessage = (ev) => {
      if (ended) return;
      const d = ev.data;
      const raw = typeof d === 'string' ? d : d instanceof ArrayBuffer ? decoder.decode(d) : ArrayBuffer.isView(d) ? decoder.decode(d as Uint8Array) : '';
      if (!raw) return;
      let m: unknown;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if ((m as { error?: unknown })?.error) return end();
      const u = parseAisstream(m);
      if (u) mergeUpdate(pending, u);
      if (++count >= MAX_MESSAGES) end();
    };
    ws.onerror = end;
    ws.onclose = end;
  });
  await flush(true);
  return count;
}

// ---------- Postgres (PostgREST RPCs, service role) ----------

export function postgrestShipStore(baseUrl: string, serviceKey: string, f: typeof fetch = fetch): ShipStore {
  const rpc = async <T>(name: string, args: unknown): Promise<T> => {
    const res = await f(`${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    async get(box, max, tiles, stream) {
      const r = await rpc<{ ships: ShipRow[] | null; boxes: Box[] | null }>('ships_get', { w: box[0], s: box[1], e: box[2], n: box[3], max_rows: max, tiles, max_tiles: MAX_TILES, stream });
      return { ships: r.ships ?? [], boxes: r.boxes && r.boxes.length ? r.boxes : null };
    },
    async put(updates, done) {
      await rpc('ships_put', { rows: updates, done });
    },
    async track(mmsi) {
      return (await rpc<[number, number, number][] | null>('ships_track', { ship: mmsi })) ?? [];
    },
  };
}

// ---------- HTTP ----------

function cors(origin: string | null): Record<string, string> {
  const ok = origin && SHIPS_ORIGINS.some((re) => re.test(origin));
  return ok
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' }
    : { vary: 'origin' };
}

export async function handleShipsRelay(req: Request, opts: ShipsRelayOptions = {}): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  const gzip = /\bgzip\b/.test(req.headers.get('accept-encoding') ?? '') && typeof CompressionStream !== 'undefined';
  const reply = (status: number, body: unknown) => {
    const t = JSON.stringify(body);
    const base = { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (!gzip || t.length < 2048) return new Response(t, { status, headers: base });
    return new Response(new Blob([t]).stream().pipeThrough(new CompressionStream('gzip')), { status, headers: { ...base, 'content-encoding': 'gzip' } });
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (origin && !headers['access-control-allow-origin']) return reply(403, { error: 'origin not allowed' });
  let input: { box?: unknown; track?: unknown };
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return reply(400, { error: 'bad json' });
  }
  const store = opts.store;
  if (!store) return reply(501, { error: 'no store' });
  if (input && 'track' in input) {
    const mmsi = input.track;
    if (typeof mmsi !== 'number' || !Number.isInteger(mmsi) || mmsi < 1e8 || mmsi > 999_999_999) return reply(400, { error: 'bad mmsi' });
    try {
      return reply(200, { track: await store.track(mmsi) });
    } catch {
      return reply(502, { error: 'store unreachable' });
    }
  }
  const box = shipBox(input?.box);
  if (!box) return reply(400, { error: 'bad box' });
  let got: Awaited<ReturnType<ShipStore['get']>>;
  try {
    // A zoomed-out view (many tiles) doesn't ask for its tiles, or it would crowd out the close-up
    // views; it still shows what is cached and keeps the stream going. Without a key nobody streams.
    const tiles = tilesOf(box);
    got = await store.get(box, MAX_SHIPS, tiles.length <= WANT_TILES ? tiles : [], !!opts.key && !!opts.socket);
  } catch {
    return reply(502, { error: 'store unreachable' });
  }
  const live = !!opts.key;
  if (got.boxes && opts.key && opts.socket) {
    const job = collect(got.boxes, opts.key, store, opts.socket, opts.listenMs);
    if (opts.defer) opts.defer(job);
    else void job;
  }
  return reply(200, { ships: got.ships, at: Math.round(Date.now() / 1000), live });
}
