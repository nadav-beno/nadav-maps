/**
 * The free ADS-B feeds (adsb.lol, OpenSky) send no CORS headers, so a browser on another site
 * can't read them. This tiny relay fetches them for the web app. Its only import (world-cells.ts)
 * has none, so the same code runs as our Supabase Edge Function (`supabase/functions/flights/`),
 * in `apps/server`, and in unit tests.
 *
 * Request: `POST` with JSON `{ url, body? }`, or `{ world: [w, s, e, n] }` for every aircraft in
 * a box from the shared world cells (zoomed-out map). The upstream URL travels in the body, not the path,
 * so the map area never lands in request logs. Only a few read-only endpoints are allowed.
 * Responses are cached for a few seconds per URL, so many viewers share one upstream call (and
 * OpenSky's daily credits).
 */

import { worldAircraft, type Box, type CellStore } from './world-cells.ts';

export interface RelayRequest {
  url?: string;
  /** JSON body for the POST endpoints (adsb.im routeset). */
  body?: unknown;
  /** Instead of a url: every aircraft in this box from the shared world cells (world-cells.ts). */
  world?: Box;
}

export interface RelayOptions {
  /** Where world cells are cached; without one, `world` requests are refused. */
  store?: CellStore;
  /** Runs work after the answer is sent (the Edge runtime's waitUntil). */
  defer?: (p: Promise<unknown>) => void;
}

const UA = 'NadavMaps/0.3 (+https://github.com/nadav-beno/nadav-maps)';

/** A valid box: four finite numbers, west <= east, south <= north, inside the world. */
export function validBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [w, s, e, n] = v as Box;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w > e || s > n) return null;
  return [w, s, e, n];
}

/** Upstream URL prefixes the relay may call, with how long a response is shared (ms). */
export const RELAY_ROUTES: { prefix: string; post?: boolean; cacheMs: number }[] = [
  { prefix: 'https://api.adsb.lol/v2/point/', cacheMs: 4_000 },
  { prefix: 'https://api.adsb.lol/v2/callsign/', cacheMs: 4_000 },
  { prefix: 'https://adsb.im/api/0/routeset', post: true, cacheMs: 0 },
  { prefix: 'https://opensky-network.org/api/states/all', cacheMs: 30_000 },
];

/** Sites allowed to use the relay. */
export const RELAY_ORIGINS = [/^https:\/\/nadav-beno\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const MAX_CACHE = 200;
const cache = new Map<string, { at: number; status: number; text: string }>();

export function relayRoute(url: string) {
  if (typeof url !== 'string' || url.length > 600 || /[\s#]|\.\./.test(url)) return null;
  return RELAY_ROUTES.find((r) => url.startsWith(r.prefix)) ?? null;
}

function cors(origin: string | null): Record<string, string> {
  const ok = origin && RELAY_ORIGINS.some((re) => re.test(origin));
  return ok
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' }
    : { vary: 'origin' };
}

/** Handles one request. `upstream` is the fetch used for the feeds (injected in tests). */
export async function handleFlightsRelay(req: Request, upstream: typeof fetch = fetch, now = Date.now(), opts: RelayOptions = {}): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  const gzip = /\bgzip\b/.test(req.headers.get('accept-encoding') ?? '') && typeof CompressionStream !== 'undefined';
  const reply = (status: number, text: string) => {
    const base = { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' };
    // World answers are large (thousands of aircraft); JSON shrinks about five times.
    if (!gzip || text.length < 2048) return new Response(text, { status, headers: base });
    const body = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(body, { status, headers: { ...base, 'content-encoding': 'gzip' } });
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, '{"error":"POST only"}');
  if (origin && !headers['access-control-allow-origin']) return reply(403, '{"error":"origin not allowed"}');

  let input: RelayRequest;
  try {
    input = (await req.json()) as RelayRequest;
  } catch {
    return reply(400, '{"error":"bad json"}');
  }
  if (input && 'world' in input) {
    const box = validBox(input.world);
    if (!box) return reply(400, '{"error":"bad box"}');
    if (!opts.store) return reply(501, '{"error":"world view not available"}');
    try {
      return reply(200, JSON.stringify(await worldAircraft(box, opts.store, upstream, { defer: opts.defer, ua: UA })));
    } catch {
      return reply(502, '{"error":"cache unreachable"}');
    }
  }
  const route = relayRoute(input?.url as string);
  if (!route) return reply(400, '{"error":"url not allowed"}');

  const url = input.url as string;
  const key = route.post ? '' : url;
  const hit = key ? cache.get(key) : undefined;
  if (hit && now - hit.at < route.cacheMs) return reply(hit.status, hit.text);

  try {
    const res = await upstream(url, {
      method: route.post ? 'POST' : 'GET',
      headers: { accept: 'application/json', 'user-agent': UA, ...(route.post ? { 'content-type': 'application/json' } : {}) },
      body: route.post ? JSON.stringify(input.body ?? {}) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (key && res.ok && route.cacheMs) {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: now, status: res.status, text });
    }
    return reply(res.status, text);
  } catch {
    return reply(502, '{"error":"upstream unreachable"}');
  }
}

/** For tests. */
export function clearRelayCache(): void {
  cache.clear();
}
