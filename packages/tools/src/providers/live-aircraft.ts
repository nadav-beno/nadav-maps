import { getJson, ProviderError, type ToolContext } from '../define.ts';
import { parseAdsb, type AircraftPosition } from './adsb.ts';

/**
 * Every aircraft in an area, for the live flights map.
 *
 * Two free sources, picked by the size of the area:
 * - Close up (the area fits in a few 250 NM circles): the readsb-style API in `flightsUrl`
 *   (adsb.lol by default, ODbL, no key), `GET /v2/point/{lat}/{lon}/{radius_nm}`, one call
 *   per circle. Fresh every few seconds, with type and registration.
 * - Further out, up to the whole world: OpenSky Network's `GET /states/all` with a bounding
 *   box (anonymous, no key; 400 credits a day per IP, 1-4 credits a call by area). Positions
 *   are 10 s old at most but have no type or registration.
 * Only the visible map area is sent, never the user's location.
 */

export type Bbox = [west: number, south: number, east: number, north: number];

export interface LiveAircraft {
  /** Which feed answered. */
  source: 'adsb' | 'opensky';
  aircraft: AircraftPosition[];
  /** When the feed says the positions are from, epoch ms. */
  at: number;
  /** True when the wide-area feed failed and only the middle of the area was filled in. */
  partial?: boolean;
  /** Hebrew note for the user when something is missing (rate limit, feed down). */
  note?: string;
}

const NM_KM = 1.852;
/** The readsb APIs' largest radius. */
export const MAX_RADIUS_NM = 250;
/** Close-up queries: at most this many circles, otherwise the wide feed is used. */
export const MAX_CIRCLES = 4;
const KM_PER_DEG = 111.32;

/** Clamps a map's bounds to valid lng/lat (maps report beyond ±180 when wrapped). */
export function clampBbox([w, s, e, n]: Bbox): Bbox {
  const lat = (v: number) => Math.max(-90, Math.min(90, v));
  if (e - w >= 360) return [-180, lat(s), 180, lat(n)];
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  let W = wrap(w), E = wrap(e);
  // Across the antimeridian: keep the larger side (good enough for a world map).
  if (E < W) {
    if (180 - W >= E + 180) E = 180;
    else W = -180;
  }
  return [W, lat(s), E, lat(n)];
}

/**
 * Circles (center + radius in NM) that cover the box, or null when more than `max` are needed.
 * The box is cut into a grid of cells whose half-diagonal fits in one circle.
 */
export function coverCircles(box: Bbox, max = MAX_CIRCLES): { lat: number; lon: number; radiusNm: number }[] | null {
  const [w, s, e, n] = box;
  // Widest at the latitude closest to the equator.
  const midLat = s <= 0 && n >= 0 ? 0 : Math.min(Math.abs(s), Math.abs(n));
  const kmX = (e - w) * KM_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const kmY = (n - s) * KM_PER_DEG;
  const side = MAX_RADIUS_NM * NM_KM * Math.SQRT2;
  const nx = Math.max(1, Math.ceil(kmX / side));
  const ny = Math.max(1, Math.ceil(kmY / side));
  if (nx * ny > max) return null;
  const cellX = kmX / nx, cellY = kmY / ny;
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.max(5, Math.ceil(Math.hypot(cellX, cellY) / 2 / NM_KM)));
  const out: { lat: number; lon: number; radiusNm: number }[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      out.push({ lon: round(w + ((i + 0.5) * (e - w)) / nx), lat: round(s + ((j + 0.5) * (n - s)) / ny), radiusNm });
  return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** OpenSky's credit cost for a box (lat range × lon range in square degrees). */
export function openskyCredits([w, s, e, n]: Bbox): number {
  const area = (e - w) * (n - s);
  return area <= 25 ? 1 : area <= 100 ? 2 : area <= 400 ? 3 : 4;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * OpenSky state vectors: arrays of
 * [icao24, callsign, origin_country, time_position, last_contact, lon, lat, baro_altitude (m),
 *  on_ground, velocity (m/s), true_track, vertical_rate (m/s), sensors, geo_altitude (m), squawk, spi, position_source, category]
 */
export function parseOpenSky(json: unknown): { at: number; aircraft: AircraftPosition[] } {
  const root = (json ?? {}) as { time?: unknown; states?: unknown };
  const time = num(root.time);
  const states = Array.isArray(root.states) ? root.states : [];
  const out: AircraftPosition[] = [];
  for (const st of states) {
    if (!Array.isArray(st)) continue;
    const lon = num(st[5]), lat = num(st[6]);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const onGround = st[8] === true;
    const alt = num(st[13]) ?? num(st[7]);
    const v = num(st[9]);
    const track = num(st[10]);
    const tPos = num(st[3]);
    const vr = num(st[11]);
    out.push({
      callsign: typeof st[1] === 'string' ? st[1].trim() : '',
      hex: typeof st[0] === 'string' ? st[0].trim().toLowerCase() : '',
      lngLat: [lon, lat],
      altitudeM: onGround ? 0 : alt === null ? null : Math.round(alt),
      onGround,
      groundSpeedKmh: v === null ? null : Math.round(v * 3.6),
      track: track === null ? null : ((track % 360) + 360) % 360,
      ageS: time !== null && tPos !== null ? Math.max(0, time - tPos) : null,
      verticalRateMs: vr === null || onGround ? null : Math.round(vr * 10) / 10,
      country: typeof st[2] === 'string' && st[2] ? st[2] : undefined,
    });
  }
  return { at: time !== null ? time * 1000 : Date.now(), aircraft: out };
}

async function fromAdsb(ctx: ToolContext, circles: { lat: number; lon: number; radiusNm: number }[]): Promise<AircraftPosition[]> {
  const base = ctx.config.flightsUrl.replace(/\/$/, '');
  if (!base) throw new ProviderError('נתוני טיסות לא מוגדרים בשרת הזה.', undefined, 'flights');
  const results = await Promise.allSettled(
    circles.map((c) => getJson<unknown>(ctx, `${base}/v2/point/${c.lat}/${c.lon}/${c.radiusNm}`, {}, 'flights', 12000)),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled');
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  // Circles overlap: keep one entry per aircraft (the freshest, parseAdsb sorts by age).
  const seen = new Map<string, AircraftPosition>();
  for (const r of ok)
    for (const a of parseAdsb(r.value)) {
      const key = a.hex || `${a.callsign}@${a.lngLat.join()}`;
      const prev = seen.get(key);
      if (!prev || (a.ageS ?? 1e9) < (prev.ageS ?? 1e9)) seen.set(key, a);
    }
  return [...seen.values()];
}

/** Aircraft in the box from the best feed for its size. */
export async function liveAircraft(ctx: ToolContext, bbox: Bbox): Promise<LiveAircraft> {
  const box = clampBbox(bbox);
  const circles = ctx.config.flightsUrl ? coverCircles(box) : null;
  if (circles) return { source: 'adsb', aircraft: await fromAdsb(ctx, circles), at: Date.now() };

  const base = ctx.config.openskyUrl.replace(/\/$/, '');
  if (base) {
    const [w, s, e, n] = box;
    const world = e - w >= 359 && n - s >= 170;
    const q = world ? '' : `?lamin=${round(s)}&lomin=${round(w)}&lamax=${round(n)}&lomax=${round(e)}`;
    try {
      const json = await getJson<unknown>(ctx, `${base}/states/all${q}`, {}, 'opensky', 25000);
      return { source: 'opensky', ...parseOpenSky(json) };
    } catch (err) {
      if (!ctx.config.flightsUrl) throw err;
      const limited = err instanceof ProviderError && err.status === 429;
      const note = limited
        ? 'נגמרה המכסה היומית של מקור הטיסות העולמי (OpenSky). מוצגות רק הטיסות במרכז המפה; התקרבו כדי לראות הכול.'
        : 'מקור הטיסות העולמי (OpenSky) לא זמין כרגע. מוצגות רק הטיסות במרכז המפה; התקרבו כדי לראות הכול.';
      return { ...(await middleOnly(ctx, box)), note };
    }
  }
  return { ...(await middleOnly(ctx, box)), note: 'במבט רחוק מוצגות רק הטיסות במרכז המפה. התקרבו כדי לראות הכול.' };
}

/** The close-up feed around the middle of a box too big for it (one 250 NM circle). */
async function middleOnly(ctx: ToolContext, [w, s, e, n]: Bbox): Promise<LiveAircraft> {
  const circle = { lon: round((w + e) / 2), lat: round((s + n) / 2), radiusNm: MAX_RADIUS_NM };
  return { source: 'adsb', aircraft: await fromAdsb(ctx, [circle]), at: Date.now(), partial: true };
}
