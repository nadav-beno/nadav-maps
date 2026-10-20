import type { DirectionsMode, LngLat } from './types.ts';

/**
 * Everything worth sharing lives in the URL, so any screen can be linked to:
 *   #15/31.77650/35.23460          map view (zoom/lat/lng, OSM style)
 *   ?place=osm:n123                 open place card
 *   ?q=פיצה                         search
 *   ?route=lng,lat;lng,lat&mode=walk  directions (first = origin, last = destination)
 *   ?list=<base64 GeoJSON>          shared list (no account needed)
 *   ?panel=timeline&day=2026-10-10  a screen by name, and the day it shows
 *   ?embed=1                        inside an iframe on another site: map and card only
 */
export interface UrlState {
  view?: { zoom: number; center: LngLat; bearing?: number; pitch?: number };
  place?: string;
  q?: string;
  /** Category search ("cafe"), see CATEGORIES in @nm/tools. */
  cat?: string;
  /** Result filters, comma separated ("open" = open now, "access" = wheelchair, "near" = by distance, "auto" = follow the map, "c-pizza" = a cuisine). */
  filter?: string;
  route?: LngLat[];
  /** route starts at the user's current location ("route=me;lng,lat"). */
  fromMe?: boolean;
  mode?: DirectionsMode;
  list?: string;
  panel?: string;
  /** A calendar day for screens that show one (timeline), "YYYY-MM-DD". */
  day?: string;
  /** Shown inside another site's iframe ("?embed=1"): just the map and the card. */
  embed?: boolean;
}

const MODES: DirectionsMode[] = ['car', 'walk', 'bike', 'transit', 'motorcycle'];

export function parseUrl(href: string): UrlState {
  const url = new URL(href);
  const out: UrlState = {};
  const hash = url.hash.replace(/^#/, '');
  const parts = hash.split('/').map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
    const [zoom, lat, lng, bearing, pitch] = parts;
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && zoom >= 0 && zoom <= 24) {
      out.view = { zoom, center: [lng, lat] };
      if (Number.isFinite(bearing)) out.view.bearing = bearing;
      if (Number.isFinite(pitch)) out.view.pitch = pitch;
    }
  }
  const p = url.searchParams;
  const place = p.get('place');
  if (place) out.place = place;
  const q = p.get('q');
  if (q) out.q = q;
  const cat = p.get('cat');
  if (cat && /^[a-z_]{1,32}$/.test(cat)) out.cat = cat;
  const filter = p.get('filter');
  if (filter && /^[a-z_,-]{1,64}$/.test(filter)) out.filter = filter;
  const route = p.get('route');
  if (route) {
    const tokens = route.split(';');
    if (tokens[0] === 'me') {
      out.fromMe = true;
      tokens.shift();
    }
    const pts = tokens
      .map((s) => s.split(',').map(Number) as LngLat)
      .filter((pt) => pt.length === 2 && pt.every(Number.isFinite));
    if (pts.length >= (out.fromMe ? 1 : 2)) out.route = pts;
    else delete out.fromMe;
  }
  const mode = p.get('mode') as DirectionsMode | null;
  if (mode && MODES.includes(mode)) out.mode = mode;
  const list = p.get('list');
  if (list) out.list = list;
  const panel = p.get('panel');
  if (panel) out.panel = panel;
  const day = p.get('day');
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) out.day = day;
  if (p.get('embed') === '1') out.embed = true;
  return out;
}

const round = (n: number, d: number) => Number(n.toFixed(d));

export function viewHash(zoom: number, center: LngLat, bearing = 0, pitch = 0): string {
  const z = round(zoom, 2);
  const dec = Math.max(2, Math.min(6, Math.ceil(z / 3) + 1));
  let h = `#${z}/${round(center[1], dec)}/${round(center[0], dec)}`;
  if (Math.round(bearing) || Math.round(pitch)) h += `/${Math.round(bearing)}/${Math.round(pitch)}`;
  return h;
}

/** Build a URL from state, keeping the current origin/path. */
export function buildUrl(base: string, s: UrlState): string {
  const url = new URL(base);
  url.search = '';
  const p = url.searchParams;
  if (s.place) p.set('place', s.place);
  if (s.q) p.set('q', s.q);
  if (s.cat) p.set('cat', s.cat);
  if (s.filter) p.set('filter', s.filter);
  if (s.route && s.route.length >= (s.fromMe ? 1 : 2)) {
    const pts = s.route.map(([x, y]) => `${round(x, 6)},${round(y, 6)}`);
    p.set('route', (s.fromMe ? ['me', ...pts] : pts).join(';'));
  }
  if (s.mode && s.mode !== 'car') p.set('mode', s.mode);
  if (s.list) p.set('list', s.list);
  if (s.panel) p.set('panel', s.panel);
  if (s.day) p.set('day', s.day);
  if (s.embed) p.set('embed', '1');
  url.hash = s.view ? viewHash(s.view.zoom, s.view.center, s.view.bearing, s.view.pitch) : url.hash;
  // URLSearchParams encodes ';' and ','; keep them readable.
  return url.toString().replace(/%3B/g, ';').replace(/%2C/g, ',').replace(/%3A/g, ':');
}
