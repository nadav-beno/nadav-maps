import { dimensions, etaFromPacked, etaFromParts, type LngLat } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';
import { pagesToPhotos, type Photo } from './commons.ts';
import type { Box, ShipRow } from '../ships-relay.ts';

/**
 * Live ships (AIS). Two sources, merged by MMSI (newest position wins):
 * - our ships relay (`shipsUrl`, packages/tools/src/ships-relay.ts): aisstream.io worldwide,
 *   through one shared stream with the key kept server-side, cached in Postgres;
 * - Fintraffic Digitraffic (`digitrafficUrl`): the Baltic, straight from the browser (CORS open,
 *   no key, CC BY 4.0). The whole Baltic is read once, then only what changed.
 * Only the visible map box is sent to the relay; Digitraffic is asked for everything (no box).
 */

export interface Ship {
  mmsi: number;
  lngLat: LngLat;
  /** Speed over ground, knots. */
  sog: number | null;
  /** Course over ground, degrees. */
  cog: number | null;
  heading: number | null;
  /** AIS navigational status code. */
  nav: number | null;
  /** When this position was sent (ms). */
  at: number;
  name: string | null;
  callsign: string | null;
  imo: number | null;
  /** AIS ship type code. */
  type: number | null;
  length: number | null;
  beam: number | null;
  /** Metres. */
  draught: number | null;
  destination: string | null;
  /** ISO time, as typed in by the crew. */
  eta: string | null;
  source: 'aisstream' | 'digitraffic';
}

export interface LiveShips {
  ships: Ship[];
  /** Which sources answered. */
  sources: ('aisstream' | 'digitraffic')[];
  /** Our worldwide stream is on (the relay has its key). */
  live: boolean;
  /** Why some area may be empty. */
  note?: 'relay-off' | 'no-key' | 'relay-error';
}

/** Where Digitraffic has AIS coverage (the Baltic and its gulfs). */
export const BALTIC: Box = [9, 53, 31.5, 66.5];

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Ships stopped longer ago than this are no longer shown; moving ones sooner. */
const STOPPED_MAX_MS = 6 * 3600_000;
const MOVING_MAX_MS = 30 * 60_000;
export const isFresh = (s: Pick<Ship, 'at' | 'sog'>, now = Date.now()) => now - s.at < ((s.sog ?? 0) < 0.5 ? STOPPED_MAX_MS : MOVING_MAX_MS);

const etaIso = (eta: string | null, now: number) => {
  const m = eta && /^(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(eta);
  return m ? etaFromParts(+m[1], +m[2], +m[3], +m[4], now) : null;
};

export function rowToShip(r: ShipRow, now = Date.now()): Ship | null {
  const [mmsi, lng, lat, sog, cog, hdg, nav, at, name, type, length, beam, draught, dest, eta, imo, callsign] = r;
  if (typeof mmsi !== 'number' || typeof lng !== 'number' || typeof lat !== 'number' || typeof at !== 'number') return null;
  return {
    mmsi, lngLat: [lng, lat], sog, cog, heading: hdg, nav, at: at * 1000, name: name || null, callsign: callsign || null, imo: imo || null,
    type: type || null, length, beam, draught, destination: dest || null, eta: etaIso(eta, now), source: 'aisstream',
  };
}

// ---------- Digitraffic ----------

interface DtLocation {
  mmsi: number;
  geometry: { coordinates: [number, number] };
  properties: { sog?: number; cog?: number; heading?: number; navStat?: number; timestampExternal?: number };
}
interface DtVessel {
  mmsi: number;
  name?: string;
  callSign?: string;
  imo?: number;
  shipType?: number;
  draught?: number;
  destination?: string;
  eta?: number;
  referencePointA?: number;
  referencePointB?: number;
  referencePointC?: number;
  referencePointD?: number;
  timestamp?: number;
}

export function parseDtLocation(f: DtLocation): Pick<Ship, 'mmsi' | 'lngLat' | 'sog' | 'cog' | 'heading' | 'nav' | 'at'> | null {
  const c = f?.geometry?.coordinates;
  const p = f?.properties ?? {};
  if (!f?.mmsi || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || !p.timestampExternal) return null;
  return {
    mmsi: f.mmsi,
    lngLat: [c[0], c[1]],
    sog: p.sog === undefined || p.sog >= 102.3 ? null : p.sog,
    cog: p.cog === undefined || p.cog >= 360 ? null : p.cog,
    heading: p.heading === undefined || p.heading >= 360 ? null : p.heading,
    nav: p.navStat ?? null,
    at: p.timestampExternal,
  };
}

export function parseDtVessel(v: DtVessel, now = Date.now()): Partial<Ship> & { mmsi: number } {
  const d = dimensions(v.referencePointA, v.referencePointB, v.referencePointC, v.referencePointD);
  const clean = (s?: string) => (s ?? '').replace(/@+/g, ' ').replace(/\s+/g, ' ').trim() || null;
  return {
    mmsi: v.mmsi,
    name: clean(v.name),
    callsign: clean(v.callSign),
    imo: v.imo || null,
    type: v.shipType || null,
    // Digitraffic sends the draught in decimetres.
    draught: v.draught ? v.draught / 10 : null,
    destination: clean(v.destination),
    eta: etaFromPacked(v.eta, now),
    length: d.length,
    beam: d.beam,
  };
}

const dt = {
  positions: new Map<number, ReturnType<typeof parseDtLocation> & object>(),
  vessels: new Map<number, ReturnType<typeof parseDtVessel>>(),
  locFrom: 0,
  vesFrom: 0,
  lastAt: 0,
  loading: null as Promise<void> | null,
};

/** For tests. */
export function resetShipCaches() {
  dt.positions.clear();
  dt.vessels.clear();
  dt.locFrom = dt.vesFrom = dt.lastAt = 0;
  dt.loading = null;
}

async function refreshDigitraffic(ctx: ToolContext, now: number) {
  if (now - dt.lastAt < 10_000 && dt.positions.size) return;
  if (dt.loading) return dt.loading;
  const base = ctx.config.digitrafficUrl.replace(/\/$/, '');
  dt.loading = (async () => {
    const locFrom = dt.locFrom || now - MOVING_MAX_MS;
    const [loc, ves] = await Promise.all([
      getJson<{ features?: DtLocation[]; dataUpdatedTime?: string }>(ctx, `${base}/api/ais/v1/locations?from=${locFrom}`, {}, 'digitraffic', 25_000),
      // Names and voyage data: everything once, then what changed (with a margin).
      now - dt.vesFrom > 5 * 60_000 || !dt.vessels.size
        ? getJson<DtVessel[]>(ctx, `${base}/api/ais/v1/vessels${dt.vesFrom ? `?from=${dt.vesFrom - 60_000}` : ''}`, {}, 'digitraffic', 25_000).catch(() => null)
        : Promise.resolve(null),
    ]);
    for (const f of Array.isArray(loc?.features) ? loc.features : []) {
      const p = parseDtLocation(f);
      if (p && (dt.positions.get(p.mmsi)?.at ?? 0) <= p.at) dt.positions.set(p.mmsi, p);
    }
    const upd = Date.parse(loc.dataUpdatedTime ?? '');
    dt.locFrom = (Number.isFinite(upd) ? upd : now) - 15_000;
    if (Array.isArray(ves)) {
      for (const v of ves) if (v?.mmsi) dt.vessels.set(v.mmsi, parseDtVessel(v, now));
      dt.vesFrom = now;
    }
    for (const [k, p] of dt.positions) if (!isFresh(p, now)) dt.positions.delete(k);
    dt.lastAt = now;
  })().finally(() => {
    dt.loading = null;
  });
  return dt.loading;
}

function digitrafficShips(box: Box, now: number): Ship[] {
  const out: Ship[] = [];
  for (const p of dt.positions.values()) {
    const [lng, lat] = p.lngLat;
    if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3] || !isFresh(p, now)) continue;
    const v = dt.vessels.get(p.mmsi);
    out.push({
      name: null, callsign: null, imo: null, type: null, length: null, beam: null, draught: null, destination: null, eta: null,
      ...v,
      ...p,
      source: 'digitraffic',
    });
  }
  return out;
}

// ---------- both ----------

export function clampBox([w, s, e, n]: Box): Box {
  if (e - w >= 360) return [-180, Math.max(-90, s), 180, Math.min(90, n)];
  return [Math.max(-180, w), Math.max(-90, s), Math.min(180, e), Math.min(90, n)];
}

export async function liveShips(ctx: ToolContext, bbox: Box, now = Date.now()): Promise<LiveShips> {
  const box = clampBox(bbox);
  const sources: LiveShips['sources'] = [];
  let note: LiveShips['note'];
  let live = false;
  const byMmsi = new Map<number, Ship>();
  const wantDt = !!ctx.config.digitrafficUrl && overlaps(box, BALTIC);
  const [relay, baltic] = await Promise.allSettled([
    ctx.config.shipsUrl
      ? getJson<{ ships?: ShipRow[]; live?: boolean }>(ctx, ctx.config.shipsUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ box }) }, 'ships', 20_000)
      : Promise.resolve(null),
    wantDt ? refreshDigitraffic(ctx, now) : Promise.resolve(),
  ]);
  if (relay.status === 'fulfilled' && relay.value) {
    sources.push('aisstream');
    live = !!relay.value.live;
    if (!live) note = 'no-key';
    for (const r of relay.value.ships ?? []) {
      const s = rowToShip(r, now);
      if (s && isFresh(s, now)) byMmsi.set(s.mmsi, s);
    }
  } else if (relay.status === 'rejected') {
    note = 'relay-error';
  } else {
    note = 'relay-off';
  }
  if (wantDt && (baltic.status === 'fulfilled' || dt.positions.size)) {
    sources.push('digitraffic');
    for (const s of digitrafficShips(box, now)) {
      const had = byMmsi.get(s.mmsi);
      if (!had) byMmsi.set(s.mmsi, s);
      else if (s.at > had.at) byMmsi.set(s.mmsi, { ...had, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null)), source: 'digitraffic' } as Ship);
    }
  }
  // Nothing answered that was asked: a real failure (with no relay configured, an empty map is the answer).
  if (!sources.length && (note === 'relay-error' || wantDt)) throw new ProviderError('ships unavailable', undefined, 'ships');
  return { ships: [...byMmsi.values()], sources, live, ...(note ? { note } : {}) };
}

/** Where the ship has been in the last hours (our relay keeps 12 h of moving ships). */
export async function shipTrack(ctx: ToolContext, mmsi: number): Promise<{ lngLat: LngLat; at: number }[]> {
  if (!ctx.config.shipsUrl) return [];
  const r = await getJson<{ track?: [number, number, number][] }>(ctx, ctx.config.shipsUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track: mmsi }) }, 'ships', 15_000);
  return (r.track ?? []).filter((p) => Array.isArray(p) && p.length === 3).map(([lng, lat, t]) => ({ lngLat: [lng, lat] as LngLat, at: t * 1000 }));
}

// ---------- what the open encyclopedias know about a ship ----------

export interface VesselInfo {
  wikidata: string | null;
  label: string | null;
  /** What it is, e.g. "ספינת מכולות". */
  kind: string | null;
  built: number | null;
  builder: string | null;
  grossTonnage: number | null;
  owner: string | null;
  operator: string | null;
  homeport: string | null;
  article: string | null;
  photo: Photo | null;
}

const WDQS = 'https://query.wikidata.org/sparql';

export function sparqlFor(imo: number): string {
  return `SELECT ?item ?itemLabel ?kindLabel ?inception ?service ?builderLabel ?gt ?ownerLabel ?operatorLabel ?homeLabel ?image ?he ?en WHERE {
  ?item wdt:P458 "${imo}" .
  OPTIONAL { ?item wdt:P31 ?kind . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P729 ?service . }
  OPTIONAL { ?item wdt:P176 ?builder . }
  OPTIONAL { ?item wdt:P1093 ?gt . }
  OPTIONAL { ?item wdt:P127 ?owner . }
  OPTIONAL { ?item wdt:P137 ?operator . }
  OPTIONAL { ?item wdt:P532 ?home . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?he schema:about ?item ; schema:isPartOf <https://he.wikipedia.org/> . }
  OPTIONAL { ?en schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "he,en". }
} LIMIT 4`;
}

type Binding = Record<string, { value: string } | undefined>;

export function parseVesselSparql(rows: Binding[]): Omit<VesselInfo, 'photo'> & { image: string | null } | null {
  if (!rows.length) return null;
  const first = (k: string) => rows.map((r) => r[k]?.value).find((v) => v && !/^Q\d+$/.test(v)) ?? null;
  const year = (v: string | null) => (v && /^[+-]?(\d{4})/.test(v) ? Number(/^[+-]?(\d{4})/.exec(v)![1]) : null);
  const gt = first('gt');
  return {
    wikidata: rows[0].item?.value.split('/').pop() ?? null,
    label: first('itemLabel'),
    kind: first('kindLabel'),
    built: year(first('inception')) ?? year(first('service')),
    builder: first('builderLabel'),
    grossTonnage: gt && Number.isFinite(Number(gt)) ? Math.round(Number(gt)) : null,
    owner: first('ownerLabel'),
    operator: first('operatorLabel'),
    homeport: first('homeLabel'),
    article: first('he') ?? first('en'),
    image: first('image'),
  };
}

async function commonsByImo(ctx: ToolContext, imo: number, file: string | null): Promise<Photo | null> {
  if (!ctx.config.photosUrl) return null;
  const q = new URLSearchParams({ action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '640', iiextmetadatafilter: 'Artist|LicenseShortName' });
  if (file) {
    q.set('titles', `File:${decodeURIComponent(file.split('/').pop() ?? '')}`);
  } else {
    // Ship photos on Commons are filed in a category per IMO number.
    q.set('generator', 'categorymembers');
    q.set('gcmtitle', `Category:IMO ${imo}`);
    q.set('gcmtype', 'file');
    q.set('gcmlimit', '3');
  }
  const data = await getJson<{ query?: { pages?: Record<string, Parameters<typeof pagesToPhotos>[0][number]> } }>(ctx, `${ctx.config.photosUrl}?${q}`, {}, 'commons');
  return pagesToPhotos(Object.values(data.query?.pages ?? {}))[0] ?? null;
}

/** Build year, builder, owner, tonnage and a photo for a ship by IMO number, when Wikidata/Commons know it. */
export async function vesselInfo(ctx: ToolContext, imo: number): Promise<VesselInfo> {
  const empty: VesselInfo = { wikidata: null, label: null, kind: null, built: null, builder: null, grossTonnage: null, owner: null, operator: null, homeport: null, article: null, photo: null };
  const wd = await getJson<{ results?: { bindings?: Binding[] } }>(ctx, `${WDQS}?format=json&query=${encodeURIComponent(sparqlFor(imo))}`, { headers: { accept: 'application/sparql-results+json' } }, 'wikidata', 12_000)
    .then((j) => parseVesselSparql(j.results?.bindings ?? []))
    .catch(() => null);
  const photo = await commonsByImo(ctx, imo, wd?.image ?? null).catch(() => null);
  if (!wd) return { ...empty, photo };
  const { image: _image, ...rest } = wd;
  return { ...rest, photo };
}
