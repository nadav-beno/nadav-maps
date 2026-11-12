/**
 * The free ADS-B feeds (adsb.lol, OpenSky) send no CORS headers, so a browser on another site
 * can't read them. This tiny relay fetches them for the web app. It has no imports so the same
 * file runs as our Supabase Edge Function (`supabase/functions/flights/`), in `apps/server`, and
 * in unit tests.
 *
 * Request: `POST` with JSON `{ url, body? }`. The upstream URL travels in the body, not the path,
 * so the map area never lands in request logs. Only a few read-only endpoints are allowed.
 * Responses are cached for a few seconds per URL, so many viewers share one upstream call (and
 * OpenSky's daily credits).
 */

export interface RelayRequest {
  url: string;
  /** JSON body for the POST endpoints (adsb.lol routeset). */
  body?: unknown;
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
export async function handleFlightsRelay(req: Request, upstream: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  const reply = (status: number, text: string) =>
    new Response(text, { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, '{"error":"POST only"}');
  if (origin && !headers['access-control-allow-origin']) return reply(403, '{"error":"origin not allowed"}');

  let input: RelayRequest;
  try {
    input = (await req.json()) as RelayRequest;
  } catch {
    return reply(400, '{"error":"bad json"}');
  }
  const route = relayRoute(input?.url);
  if (!route) return reply(400, '{"error":"url not allowed"}');

  const key = route.post ? '' : input.url;
  const hit = key ? cache.get(key) : undefined;
  if (hit && now - hit.at < route.cacheMs) return reply(hit.status, hit.text);

  try {
    const res = await upstream(input.url, {
      method: route.post ? 'POST' : 'GET',
      headers: { accept: 'application/json', 'user-agent': 'NadavMaps/0.2 (+https://github.com/nadav-beno/nadav-maps)', ...(route.post ? { 'content-type': 'application/json' } : {}) },
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
