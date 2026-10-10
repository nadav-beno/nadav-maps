/**
 * Links pasted from other map apps (Google Maps, Waze, Apple Maps, OpenStreetMap, geo: URIs)
 * -> a coordinate we can open. Short links (maps.app.goo.gl) redirect server-side and can't
 * be read in the browser, so they are reported as `short`.
 */

export type MapLinkSource = 'google' | 'waze' | 'apple' | 'osm' | 'geo' | 'coords';

export type MapLink =
  | { kind: 'point'; source: MapLinkSource; lat: number; lng: number; zoom?: number; name?: string }
  /** A link that searches for text (google.com/maps/search/פיצה, ?q=name). */
  | { kind: 'query'; source: MapLinkSource; query: string }
  /** A short link we can't expand client-side. */
  | { kind: 'short'; source: MapLinkSource }
  /** A map link with nothing we could read. */
  | { kind: 'unknown'; source: MapLinkSource };

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const PAIR = new RegExp(String.raw`^\s*(${NUM})\s*,\s*(${NUM})\s*$`);

function valid(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** "32.08,34.78" -> [lat, lng]. */
function latLng(s: string | null | undefined): [number, number] | null {
  if (!s) return null;
  const m = PAIR.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return valid(lat, lng) ? [lat, lng] : null;
}

function clean(s: string | null | undefined): string | undefined {
  const t = s?.replace(/\+/g, ' ').trim();
  if (!t) return undefined;
  try {
    return decodeURIComponent(t).trim() || undefined;
  } catch {
    return t;
  }
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Geohash -> its centre [lat, lng] (Waze's waze.com/ul/h<geohash> links). */
export function decodeGeohash(hash: string): [number, number] | null {
  let even = true;
  const lat = [-90, 90];
  const lng = [-180, 180];
  for (const c of hash.toLowerCase()) {
    const v = BASE32.indexOf(c);
    if (v < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const r = even ? lng : lat;
      const mid = (r[0] + r[1]) / 2;
      if ((v >> bit) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return [(lat[0] + lat[1]) / 2, (lng[0] + lng[1]) / 2];
}

function point(source: MapLinkSource, ll: [number, number], extra: { zoom?: number; name?: string } = {}): MapLink {
  const out: MapLink = { kind: 'point', source, lat: ll[0], lng: ll[1] };
  if (extra.zoom !== undefined && Number.isFinite(extra.zoom)) out.zoom = Math.max(1, Math.min(20, extra.zoom));
  if (extra.name) out.name = extra.name;
  return out;
}

/** Text that is a coordinate pair rather than a place to look up. */
function textOrPoint(source: MapLinkSource, text: string | undefined, name?: string, zoom?: number): MapLink | null {
  if (!text) return null;
  const ll = latLng(text) ?? latLng(text.replace(/^loc:\s*/i, '').replace(/\s*\(.*\)\s*$/, ''));
  if (ll) return point(source, ll, { name: name ?? /\(([^)]+)\)\s*$/.exec(text)?.[1]?.trim(), zoom });
  return null;
}

function google(url: URL): MapLink {
  const path = clean(url.pathname.replace(/\+/g, '%20')) ?? '';
  const raw = url.href;
  const p = url.searchParams;
  const name = /\/maps\/place\/([^/@]+)/.exec(url.pathname)?.[1];
  const placeName = name && !latLng(clean(name)) ? clean(name) : undefined;
  // Camera: /@32.08,34.78,15z (or 1234m in satellite view, ~zoom from metres).
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)([zm]))?/.exec(raw);
  let zoom: number | undefined;
  if (at?.[3]) zoom = at[4] === 'z' ? Number(at[3]) : Math.round(Math.log2(40_000_000 / Number(at[3])) + 1);
  // The place itself: !3d<lat>!4d<lng> in the data blob is more exact than the camera.
  const d = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(raw);
  if (d && valid(+d[1], +d[2])) return point('google', [+d[1], +d[2]], { zoom: zoom ?? 17, name: placeName });
  for (const key of ['q', 'query', 'll', 'center', 'destination', 'daddr', 'saddr', 'origin', 'viewpoint']) {
    const r = textOrPoint('google', clean(p.get(key)), placeName, zoom ?? (p.get('z') ? Number(p.get('z')) : undefined));
    if (r) return r;
  }
  // /maps/place/32.08,34.78 or /maps/dir//32.08,34.78
  const inPath = /\/(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)(?:\/|$)/.exec(path);
  if (inPath && valid(+inPath[1], +inPath[2])) return point('google', [+inPath[1], +inPath[2]], { zoom: zoom ?? 16, name: placeName });
  if (at && valid(+at[1], +at[2])) return point('google', [+at[1], +at[2]], { zoom, name: placeName });
  const searched = /\/maps\/search\/([^/@]+)/.exec(url.pathname)?.[1];
  const q = placeName ?? clean(searched) ?? clean(p.get('q') ?? p.get('query'));
  if (q) return { kind: 'query', source: 'google', query: q };
  return { kind: 'unknown', source: 'google' };
}

function waze(url: URL): MapLink {
  const p = url.searchParams;
  const zoom = p.get('z') ? Number(p.get('z')) : undefined;
  const hash = /\/ul\/h([0-9a-z]+)/i.exec(url.pathname)?.[1];
  if (hash) {
    const ll = decodeGeohash(hash);
    if (ll && valid(...ll)) return point('waze', ll, { zoom: zoom ?? 16 });
  }
  for (const key of ['ll', 'latlng', 'to', 'from']) {
    const v = clean(p.get(key))?.replace(/^ll\./, '');
    const ll = latLng(v);
    if (ll) return point('waze', ll, { zoom: zoom ?? 16 });
  }
  const q = clean(p.get('q'));
  if (q) return { kind: 'query', source: 'waze', query: q };
  return { kind: 'unknown', source: 'waze' };
}

function apple(url: URL): MapLink {
  const p = url.searchParams;
  const z = p.get('z') ? Number(p.get('z')) : undefined;
  const q = clean(p.get('q') ?? p.get('name'));
  const name = q && !latLng(q) ? q : undefined;
  for (const key of ['coordinate', 'll', 'daddr', 'sll', 'center', 'q']) {
    const r = textOrPoint('apple', clean(p.get(key)), name, z ?? 16);
    if (r) return r;
  }
  const address = clean(p.get('address'));
  if (name ?? address) return { kind: 'query', source: 'apple', query: (name ?? address)! };
  return { kind: 'unknown', source: 'apple' };
}

function osm(url: URL): MapLink {
  const p = url.searchParams;
  const ml = latLng(`${p.get('mlat')},${p.get('mlon')}`);
  const m = /map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
  if (ml) return point('osm', ml, { zoom: m ? Number(m[1]) : 16 });
  if (m && valid(+m[2], +m[3])) return point('osm', [+m[2], +m[3]], { zoom: Number(m[1]) });
  return { kind: 'unknown', source: 'osm' };
}

/** geo:32.08,34.78;u=10?z=15  or  geo:0,0?q=32.08,34.78(Name)  or  geo:0,0?q=Name */
function geo(text: string): MapLink {
  const m = /^geo:\s*([^?;]+)(?:;[^?]*)?(?:\?(.*))?$/i.exec(text);
  if (!m) return { kind: 'unknown', source: 'geo' };
  const params = new URLSearchParams(m[2] ?? '');
  const zoom = params.get('z') ? Number(params.get('z')) : undefined;
  const q = clean(params.get('q'));
  const fromQ = textOrPoint('geo', q, undefined, zoom ?? 16);
  if (fromQ) return fromQ;
  const ll = latLng(m[1]);
  if (ll) return point('geo', ll, { zoom: zoom ?? 16 });
  if (q) return { kind: 'query', source: 'geo', query: q };
  return { kind: 'unknown', source: 'geo' };
}

const GOOGLE_HOST = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/;

/**
 * Read a pasted map link. Returns null for ordinary search text, so the caller can just search.
 * Coordinates typed as "32.0853, 34.7818" count too.
 */
export function parseMapLink(input: string): MapLink | null {
  const text = input.trim();
  if (!text) return null;
  if (/^geo:/i.test(text)) return geo(text);
  const ll = latLng(text);
  if (ll && /\./.test(text)) return point('coords', ll, { zoom: 17 });
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (/\s/.test(text) || !url.hostname.includes('.')) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co') return { kind: 'short', source: 'google' };
  if (host === 'maps.apple' || host === 'apple.co') return { kind: 'short', source: 'apple' };
  if ((GOOGLE_HOST.test(host) && (host.startsWith('maps.') || url.pathname.startsWith('/maps'))) || host === 'maps.google.com') return google(url);
  if (host === 'waze.com' || host.endsWith('.waze.com')) return waze(url);
  if (host === 'maps.apple.com') return apple(url);
  if (host === 'openstreetmap.org' || host === 'osm.org' || host.endsWith('.openstreetmap.org')) return osm(url);
  return null;
}
