import { getJson, ProviderError, type ToolContext } from '../define.ts';
import { aircraftKind, parseAdsb, type AircraftPosition } from './adsb.ts';
import type { Row, WorldAnswer } from '../world-cells.ts';

/**
 * Every aircraft in an area, for the live flights map.
 *
 * Two free sources, picked by the size of the area:
 * - Close up (the area fits in a few 250 NM circles): the readsb-style API in `flightsUrl`
 *   (adsb.lol by default, ODbL, no key), `GET /v2/point/{lat}/{lon}/{radius_nm}`, one call
 *   per circle. Fresh every few seconds, with type and registration.
 * - Further out, up to the whole world, with our relay (`flightsRelayUrl`): the relay's shared
 *   world cells (world-cells.ts), the same feeds cached per 250 NM cell for every viewer.
 * - Further out without the relay: OpenSky Network's `GET /states/all` with a bounding
 *   box (anonymous, no key; 400 credits a day per IP, 1-4 credits a call by area). Positions
 *   are 10 s old at most but have no type or registration.
 * Only the visible map area is sent, never the user's location.
 */

export type Bbox = [west: number, south: number, east: number, north: number];

export interface LiveAircraft {
  /** Which feed answered. */
  source: 'adsb' | 'opensky' | 'world';
  aircraft: AircraftPosition[];
  /** When the feed says the positions are from, epoch ms. */
  at: number;
  /** True when the wide-area feed failed and only the middle of the area was filled in. */
  partial?: boolean;
  /** Hebrew note for the user when something is missing (rate limit, feed down). */
  note?: string;
  /** World cells in the area not fetched yet: ask again soon. */
  pending?: number;
}

/** A world-cell row (see world-cells.ts) as an aircraft. */
export function fromRow(r: Row): AircraftPosition {
  const [hex, cs, lon, lat, alt, trk, gs, age, cat, type, reg, squawk, rate, flags] = r;
  const onGround = alt === -1;
  return {
    callsign: cs ?? '',
    hex,
    registration: reg ?? undefined,
    type: type ?? undefined,
    lngLat: [lon, lat],
    altitudeM: onGround ? 0 : alt === null ? null : Math.round(alt * 0.3048),
    onGround,
    groundSpeedKmh: gs === null ? null : Math.round(gs * 1.852),
    track: trk,
    ageS: age,
    verticalRateMs: onGround || rate === null ? null : Math.round(rate * 0.00508 * 10) / 10,
    kind: aircraftKind(cat, type ?? undefined),
    squawk: squawk ?? undefined,
    military: flags !== null && (flags & 1) === 1 ? true : undefined,
  };
}

/** World cells are refreshed in turn (busiest and oldest first), so a quiet area can be minutes old. */
const WORLD_MAX_AGE_S = 900;

async function fromWorld(ctx: ToolContext, box: Bbox): Promise<LiveAircraft> {
  const json = await getJson<WorldAnswer>(
    ctx,
    ctx.config.flightsRelayUrl,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ world: box }) },
    'flights-world',
    20000,
  );
  const aircraft = (Array.isArray(json?.ac) ? json.ac : []).filter((r) => Array.isArray(r) && r[7] <= WORLD_MAX_AGE_S).map(fromRow).filter((a) => a.kind !== null);
  return { source: 'world', aircraft, at: typeof json.at === 'number' ? json.at : Date.now(), pending: json.pending || undefined };
}

const NM_KM = 1.852;
/** Positions older than this are not "live": the aircraft has left coverage or landed. */
export const MAX_AGE_S = 60;

/** Only real aircraft with a fresh position. */
export function liveOnly(list: AircraftPosition[]): AircraftPosition[] {
  return list.filter((a) => a.kind !== null && (a.ageS === null || a.ageS <= MAX_AGE_S));
}
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
      kind: aircraftKind(num(st[17])),
      squawk: typeof st[14] === 'string' && st[14] ? st[14] : undefined,
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

/**
 * After OpenSky fails we stop asking it for a while: a rate limit lasts until its reset (or an
 * hour), anything else (down, blocked, no CORS) ten minutes. Each call would cost a 25 s wait.
 */
const LIMITED_MS = 3600_000;
const DOWN_MS = 600_000;
let openskyPause: { until: number; limited: boolean } | null = null;

/** For tests: forget an earlier OpenSky failure. */
export function resetOpenSkyPause(): void {
  openskyPause = null;
}

const NOTE_WORLD_DOWN = 'התצוגה של כל העולם לא זמינה כרגע. מוצגות רק הטיסות באזור מרכז המפה; התקרבו כדי לראות הכול.';
const NOTE_LIMITED = 'נגמרה המכסה היומית של מקור הטיסות העולמי (OpenSky). מוצגות רק הטיסות באזור מרכז המפה; התקרבו כדי לראות הכול.';
const NOTE_DOWN = 'מקור הטיסות העולמי (OpenSky) לא זמין כרגע. מוצגות רק הטיסות באזור מרכז המפה; התקרבו כדי לראות הכול.';

/** Aircraft in the box from the best feed for its size. */
export async function liveAircraft(ctx: ToolContext, bbox: Bbox): Promise<LiveAircraft> {
  const box = clampBbox(bbox);
  const circles = ctx.config.flightsUrl ? coverCircles(box) : null;
  if (circles) return { source: 'adsb', aircraft: liveOnly(await fromAdsb(ctx, circles)), at: Date.now() };
  if (ctx.config.flightsRelayUrl) {
    try {
      return await fromWorld(ctx, box);
    } catch (err) {
      if (ctx.signal?.aborted || !ctx.config.flightsUrl) throw err;
      return { ...(await middleOnly(ctx, box)), note: NOTE_WORLD_DOWN };
    }
  }

  const base = ctx.config.openskyUrl.replace(/\/$/, '');
  const paused = openskyPause && Date.now() < openskyPause.until ? openskyPause : null;
  if (base && !paused) {
    const [w, s, e, n] = box;
    const world = e - w >= 359 && n - s >= 170;
    const q = world ? '' : `?lamin=${round(s)}&lomin=${round(w)}&lamax=${round(n)}&lomax=${round(e)}`;
    try {
      // extended=1 adds the emitter category (light, heavy, rotorcraft…) at no extra cost.
      const json = await getJson<unknown>(ctx, `${base}/states/all${q ? `${q}&` : '?'}extended=1`, {}, 'opensky', 25000);
      openskyPause = null;
      const parsed = parseOpenSky(json);
      return { source: 'opensky', at: parsed.at, aircraft: liveOnly(parsed.aircraft) };
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      const limited = err instanceof ProviderError && err.status === 429;
      openskyPause = { until: Date.now() + (limited ? LIMITED_MS : DOWN_MS), limited };
      if (!ctx.config.flightsUrl) throw err;
      return { ...(await middleOnly(ctx, box)), note: limited ? NOTE_LIMITED : NOTE_DOWN };
    }
  }
  if (paused && !ctx.config.flightsUrl) throw new ProviderError(paused.limited ? NOTE_LIMITED : NOTE_DOWN, undefined, 'opensky');
  return { ...(await middleOnly(ctx, box)), note: paused ? (paused.limited ? NOTE_LIMITED : NOTE_DOWN) : 'במבט רחוק מוצגות רק הטיסות באזור מרכז המפה. התקרבו כדי לראות הכול.' };
}

/**
 * The close-up feed around the middle of a box too big for it: a 2 x 2 block of 250 NM
 * circles (about 1,300 km across), clipped to the box.
 */
export function middleCircles([w, s, e, n]: Bbox): { lat: number; lon: number; radiusNm: number }[] {
  const lon = (w + e) / 2, lat = Math.max(-80, Math.min(80, (s + n) / 2));
  // Half a cell (a square inside one circle) from the middle, in each direction.
  const halfKm = (MAX_RADIUS_NM * NM_KM) / Math.SQRT2;
  const dLat = halfKm / KM_PER_DEG;
  const dLon = halfKm / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180));
  const out: { lat: number; lon: number; radiusNm: number }[] = [];
  for (const y of [-dLat, dLat])
    for (const x of [-dLon, dLon]) {
      const cx = lon + x, cy = lat + y;
      if (cx >= w && cx <= e && cy >= s && cy <= n) out.push({ lon: round(cx), lat: round(cy), radiusNm: MAX_RADIUS_NM });
    }
  return out.length ? out : [{ lon: round(lon), lat: round(lat), radiusNm: MAX_RADIUS_NM }];
}

async function middleOnly(ctx: ToolContext, box: Bbox): Promise<LiveAircraft> {
  return { source: 'adsb', aircraft: liveOnly(await fromAdsb(ctx, middleCircles(box))), at: Date.now(), partial: true };
}
