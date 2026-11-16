import { computed, effect, signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  countryNameHe, destinationName, flagEmoji, flagOf, hazardOf, isStopped, navStatusName, SHIP_CATEGORIES, SHIP_SIZES, shipAlert, shipCategory, shipTypeName,
  formatArrival, type LngLat, type ShipCategory,
} from '@nm/core';
import { back, ensureLayer, EMPTY, Icon, isDark, load, open, providers, save, setGeoJSON, sheet, viewStack, type FeatureContext, type ViewProps } from '@nm/core/app';
import { BALTIC, isFresh, liveShipsTool, shipTrackTool, tools, vesselInfoTool, type LiveShips, type Ship, type VesselInfo } from '@nm/tools';
import { addShipIcons, shipIcon, shipPicture, stopIcon } from './icons.ts';
import { filters, isFiltered, NO_SHIP_FILTERS, passes, setFilters, tally } from './filters.ts';

/**
 * Live ships: every ship broadcasting AIS in the map area, up to the whole world, moving in real
 * time, each drawn as a silhouette of its kind (container ship, tanker, ferry, fishing boat, tug,
 * yacht, warship...) in the kind's colour, turned to its heading; anchored and moored ships are
 * round badges when zoomed out.
 * Positions come from our relay (aisstream.io, worldwide, one shared stream) and Digitraffic (Baltic).
 * Ships report every few seconds to minutes; between updates they glide on at their speed.
 * Only the visible map box is sent.
 */

export const SHIPS_VIEW = 'live-ships';
export const SHIP_VIEW = 'ship';

interface Feed extends LiveShips {
  receivedAt: number;
  box: [number, number, number, number];
}

export const feed = signal<Feed | null>(null);
export const feedState = signal<'idle' | 'loading' | 'ok' | 'error'>('idle');
export const selectedMmsi = signal<number | null>(null);
export const followSelected = signal(true);
const now = signal(Date.now());
const track = signal<{ mmsi: number; points: LngLat[] } | null>(null);
const info = signal<Record<number, VesselInfo | null>>({});
/** The full record of a ship the map only knows briefly (a wide view), by MMSI. */
const details = signal<Record<number, Ship | null>>({});

interface SavedShip {
  mmsi: number;
  name: string;
}
const SAVED_KEY = 'nm:ships:saved';
export const savedShips = signal<SavedShip[]>(load<SavedShip[]>(SAVED_KEY, []));
const isSaved = (mmsi: number) => savedShips.value.some((s) => s.mmsi === mmsi);
function toggleSaved(s: Ship) {
  const list = savedShips.peek();
  const next = list.some((x) => x.mmsi === s.mmsi) ? list.filter((x) => x.mmsi !== s.mmsi) : [{ mmsi: s.mmsi, name: s.name ?? String(s.mmsi) }, ...list].slice(0, 50);
  savedShips.value = next;
  // Saving is what the user asked for, so it is kept even in incognito (like saved places).
  save(SAVED_KEY, next);
}

export const isShipsOn = computed(() => viewStack.value.some((v) => v.kind === SHIPS_VIEW || v.kind === SHIP_VIEW));

/** Refresh: ships move slowly and report every 2 s to 3 min; a world of them less often. */
const EVERY_MS = 15_000;
const WIDE_EVERY_MS = 30_000;
/** Ships glide on for at most this long without news. */
const MAX_GLIDE_S = 600;

export function openShips(replace = false) {
  open({ kind: SHIPS_VIEW, props: { url: { panel: 'ships' } } }, { replace });
}

export function openShip(mmsi: number) {
  selectedMmsi.value = mmsi;
  followSelected.value = true;
  const top = viewStack.peek()[viewStack.peek().length - 1];
  open({ kind: SHIP_VIEW, props: { mmsi, url: { panel: 'ships', ship: mmsi } } }, { replace: top?.kind === SHIP_VIEW });
}

// ---------- motion ----------

const R = 6371000;
export function glide(s: Ship, at: number): LngLat {
  if (isStopped(s) || s.cog === null || s.sog === null) return s.lngLat;
  const t = Math.min(MAX_GLIDE_S, Math.max(0, (at - s.at) / 1000));
  const d = s.sog * 0.514444 * t;
  const [lng, lat] = s.lngLat;
  const brg = (s.cog * Math.PI) / 180;
  const nlat = lat + ((d * Math.cos(brg)) / R) * (180 / Math.PI);
  const nlng = lng + ((d * Math.sin(brg)) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return [nlng, nlat];
}

/** A brief ship (wide view) with the rest of its record, once we have it; the newest position wins. */
function withDetails(s: Ship, d: Ship | null | undefined): Ship {
  if (!s.brief || !d) return s;
  const pos = d.at > s.at ? { lngLat: d.lngLat, sog: d.sog, cog: d.cog, heading: d.heading, nav: d.nav, at: d.at } : {};
  return { ...d, ...s, ...pos, imo: d.imo, callsign: d.callsign, beam: d.beam, draught: d.draught, destination: d.destination, eta: d.eta, brief: false };
}

export const selected = computed<Ship | null>(() => {
  const m = selectedMmsi.value;
  const raw = m ? feed.value?.ships.find((x) => x.mmsi === m) : undefined;
  const s = raw && withDetails(raw, details.value[raw.mmsi]);
  return s ? { ...s, lngLat: glide(s, now.value) } : null;
});

const shows = (s: Ship) => passes(s, filters.peek());

// ---------- fetching ----------

let map: MapLibreMap;
let timer: ReturnType<typeof setTimeout> | undefined;
let moveTimer: ReturnType<typeof setTimeout> | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let seq = 0;
let running = false;

function viewBox(): [number, number, number, number] {
  const b = map.getBounds();
  const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  const px = (e - w) * 0.15, py = (n - s) * 0.15;
  return [Math.max(-180, w - px), Math.max(-85, s - py), Math.min(180, e + px), Math.min(85, n + py)];
}

async function refresh() {
  clearTimeout(timer);
  if (!running || !map) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    timer = setTimeout(() => void refresh(), 5000);
    return;
  }
  const box = viewBox();
  const s = ++seq;
  feedState.value = 'loading';
  try {
    const res = await tools().call(liveShipsTool, { bbox: box }, { cache: false });
    if (s !== seq || !running) return;
    // Keep the picked ship even when the map has moved away from it.
    const prev = selected.peek();
    const ships = prev && !res.ships.some((x) => x.mmsi === prev.mmsi) && isFresh(prev) ? [...res.ships, feed.peek()!.ships.find((x) => x.mmsi === prev.mmsi)!].filter(Boolean) : res.ships;
    feed.value = { ...res, ships, receivedAt: Date.now(), box };
    feedState.value = 'ok';
  } catch {
    if (s !== seq || !running) return;
    feedState.value = 'error';
  }
  timer = setTimeout(() => void refresh(), isWide() ? WIDE_EVERY_MS : EVERY_MS);
}

const isWide = () => feed.peek()?.ships.some((x) => x.brief) ?? false;

/** A wide view sends ships briefly: ask for the picked one with a small box around it. */
async function loadDetails(s: Ship) {
  if (!s.brief || s.mmsi in details.peek()) return;
  details.value = { ...details.peek(), [s.mmsi]: null };
  const [lng, lat] = s.lngLat;
  try {
    const res = await tools().call(liveShipsTool, { bbox: [lng - 0.05, lat - 0.05, lng + 0.05, lat + 0.05] }, { cache: false });
    const full = res.ships.find((x) => x.mmsi === s.mmsi && !x.brief);
    if (full) details.value = { ...details.peek(), [s.mmsi]: full };
  } catch {
    /* the card shows what the map knows */
  }
}

async function loadTrack(mmsi: number) {
  if (track.peek()?.mmsi === mmsi) return;
  track.value = { mmsi, points: [] };
  if (!providers.peek().shipsUrl) return;
  try {
    const pts = await tools().call(shipTrackTool, { mmsi }, { cache: false });
    if (selectedMmsi.peek() === mmsi) track.value = { mmsi, points: pts.map((p) => p.lngLat) };
  } catch {
    /* the track is a bonus */
  }
}

async function loadInfo(imo: number | null) {
  if (!imo || imo < 1_000_000 || imo > 9_999_999 || imo in info.peek()) return;
  info.value = { ...info.peek(), [imo]: null };
  try {
    const v = await tools().call(vesselInfoTool, { imo });
    info.value = { ...info.peek(), [imo]: v };
  } catch {
    /* a bonus */
  }
}

function start() {
  running = true;
  try {
    addShipIcons(map, isDark.peek());
  } catch {
    // Style still loading: addLayers draws them.
  }
  void refresh();
  ticker = setInterval(tick, 1000);
  map.on('moveend', onMove);
  document.addEventListener('visibilitychange', onVisible);
}

function stop() {
  running = false;
  seq++;
  clearTimeout(timer);
  clearTimeout(moveTimer);
  clearInterval(ticker);
  map.off('moveend', onMove);
  document.removeEventListener('visibilitychange', onVisible);
  feed.value = null;
  feedState.value = 'idle';
  selectedMmsi.value = null;
  track.value = null;
  render();
}

const onMove = () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => void refresh(), 600);
};
const onVisible = () => {
  if (document.visibilityState === 'visible') void refresh();
};

let ticks = 0;
/**
 * Seconds between redraws of all ships. Ships are slow: every few seconds close up; with thousands
 * on a zoomed-out map (a ship moves less than a pixel a minute there) only now and then.
 */
export function redrawSeconds(ships: number, zoom: number): number {
  if (ships < 1500 || zoom >= 8) return 4;
  if (zoom >= 5) return 10;
  return 30;
}
function tick() {
  now.value = Date.now();
  if (++ticks % redrawSeconds(feed.peek()?.ships.length ?? 0, map.getZoom()) === 0) render();
  else renderSelected();
  const s = selected.peek();
  // Keep a followed ship in view, but only nudge the camera once it has drifted well off centre:
  // re-centring every second keeps the map (and a phone's CPU) busy for nothing.
  if (s && followSelected.peek() && !map.isMoving()) {
    const at = map.project(s.lngLat), c = map.project(map.getCenter());
    if (Math.hypot(at.x - c.x, at.y - c.y) > 40) map.easeTo({ center: s.lngLat, duration: 900 });
  }
}

// ---------- map ----------

const SRC = 'live-ships';
const SEL = 'live-ships-selected';
const LAYER = 'live-ships-icons';

/**
 * The ship's images: `i` close up, `d` zoomed out (below zoom 11). Under way both are the
 * silhouette of its kind; stopped, a round badge when zoomed out, and close up the silhouette
 * turned to its heading (when it sends one).
 */
export function iconsOf(s: Ship): { i: string; d: string } {
  const c = shipCategory(s.type);
  if (!isStopped(s)) return { i: shipIcon(c), d: shipIcon(c) };
  return { i: s.heading === null ? stopIcon(c) : shipIcon(c), d: stopIcon(c) };
}
const rotationOf = (s: Ship) => (isStopped(s) ? (s.heading ?? 0) : (s.heading ?? s.cog ?? 0));
/** Bigger ships are drawn a little bigger. */
export function scaleOf(length: number | null): number {
  if (!length) return 1;
  if (length < 30) return 0.8;
  if (length < 100) return 0.95;
  if (length < 200) return 1.1;
  return 1.25;
}

function shipsData(): Parameters<typeof setGeoJSON>[2] {
  const f = feed.peek();
  if (!f || !isShipsOn.peek()) return EMPTY;
  const t = Date.now();
  const sel = selectedMmsi.peek();
  const features = [];
  for (const s of f.ships) {
    if (s.mmsi === sel || !shows(s)) continue;
    const ic = iconsOf(s);
    features.push({
      type: 'Feature' as const,
      // Short keys: tens of thousands of these go to the map worker on a world view.
      properties: { m: s.mmsi, n: s.name ?? '', i: ic.i, d: ic.d, r: Math.round(rotationOf(s)), z: scaleOf(s.length), k: isStopped(s) ? 0 : 1 },
      geometry: { type: 'Point' as const, coordinates: glide(s, t) },
    });
  }
  return { type: 'FeatureCollection', features } as Parameters<typeof setGeoJSON>[2];
}

function selectedData(): Parameters<typeof setGeoJSON>[2] {
  const s = isShipsOn.peek() ? selected.peek() : null;
  if (!s) return EMPTY;
  const features: unknown[] = [];
  const tr = track.peek();
  if (tr?.mmsi === s.mmsi && tr.points.length) {
    features.push({ type: 'Feature', properties: { kind: 'trail' }, geometry: { type: 'LineString', coordinates: [...tr.points, s.lngLat] } });
  }
  if (!isStopped(s) && s.sog && s.cog !== null) {
    // Where it will be in half an hour at this speed and course.
    const ahead = glide({ ...s, at: 0 }, Math.min(MAX_GLIDE_S, 1800) * 1000);
    const far = glide({ ...s, at: 0, lngLat: ahead }, 1200 * 1000);
    features.push({ type: 'Feature', properties: { kind: 'ahead' }, geometry: { type: 'LineString', coordinates: [s.lngLat, ahead, far] } });
  }
  // The picked ship is always its silhouette (pointing north when it sends no heading).
  features.push({ type: 'Feature', properties: { kind: 'ship', m: s.mmsi, n: s.name ?? '', i: shipIcon(shipCategory(s.type)), r: rotationOf(s), z: scaleOf(s.length) }, geometry: { type: 'Point', coordinates: s.lngLat } });
  return { type: 'FeatureCollection', features } as Parameters<typeof setGeoJSON>[2];
}

function render() {
  if (map?.getSource(SRC)) setGeoJSON(map, SRC, shipsData());
  renderSelected();
}
function renderSelected() {
  if (map?.getSource(SEL)) setGeoJSON(map, SEL, selectedData());
}

function addLayers(m: MapLibreMap) {
  const dark = isDark.peek();
  if (isShipsOn.peek()) addShipIcons(m, dark);
  setGeoJSON(m, SRC, shipsData());
  setGeoJSON(m, SEL, selectedData());
  const accent = dark ? '#a8c7fa' : '#0b57d0';
  const kind = (k: string) => ['==', ['get', 'kind'], k] as never;
  ensureLayer(m, {
    id: LAYER,
    type: 'symbol',
    source: SRC,
    layout: {
      'icon-image': ['step', ['zoom'], ['get', 'd'], 11, ['get', 'i']] as never,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 1, ['*', 0.34, ['get', 'z']], 4, ['*', 0.48, ['get', 'z']], 7, ['*', 0.68, ['get', 'z']], 11, ['*', 0.9, ['get', 'z']], 15, ['*', 1.3, ['get', 'z']]] as never,
      'icon-rotate': ['get', 'r'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // Ships under way draw over the ones at anchor.
      'symbol-sort-key': ['get', 'k'] as never,
    },
  }, null);
  ensureLayer(m, {
    id: 'live-ships-labels',
    type: 'symbol',
    source: SRC,
    minzoom: 11,
    layout: { 'text-field': ['get', 'n'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'], 'text-optional': true },
    paint: { 'text-color': dark ? '#e8eaed' : '#3c4043', 'text-halo-color': dark ? '#1f1f1f' : '#ffffff', 'text-halo-width': 1.5 },
  }, null);
  ensureLayer(m, {
    id: 'live-ships-trail',
    type: 'line',
    source: SEL,
    filter: kind('trail'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': accent, 'line-width': 3, 'line-opacity': 0.9 },
  }, null);
  ensureLayer(m, {
    id: 'live-ships-ahead',
    type: 'line',
    source: SEL,
    filter: kind('ahead'),
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [1.5, 2], 'line-opacity': 0.8 },
  }, null);
  ensureLayer(m, {
    id: 'live-ships-halo',
    type: 'circle',
    source: SEL,
    filter: kind('ship'),
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 12, 12, 22] as never, 'circle-color': accent, 'circle-opacity': 0.2, 'circle-stroke-color': accent, 'circle-stroke-width': 2 },
  }, null);
  ensureLayer(m, {
    id: 'live-ships-picked',
    type: 'symbol',
    source: SEL,
    filter: kind('ship'),
    layout: {
      'icon-image': ['get', 'i'] as never,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, ['*', 0.85, ['get', 'z']], 12, ['*', 1.4, ['get', 'z']]] as never,
      'icon-rotate': ['get', 'r'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['get', 'n'],
      'text-size': 12,
      'text-font': ['Noto Sans Bold'],
      'text-offset': [0, 1.8],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': accent, 'text-halo-color': dark ? '#1f1f1f' : '#ffffff', 'text-halo-width': 2 },
  }, null);
}

export function setupShips(ctx: FeatureContext) {
  map = ctx.map;
  ctx.onStyle(addLayers);
  let was = false;
  effect(() => {
    const on = isShipsOn.value;
    if (on === was) return;
    was = on;
    if (on) start();
    else stop();
  });
  effect(() => {
    void feed.value;
    void selectedMmsi.value;
    void track.value;
    void filters.value;
    render();
  });
  ctx.onMapClick((_e, features) => {
    if (!isShipsOn.peek()) return;
    const f = features.find((x) => x.layer.id === LAYER || x.layer.id === 'live-ships-picked');
    const m = Number(f?.properties?.m);
    if (!m) return;
    openShip(m);
    return true;
  }, 89);
  map.on('dragstart', () => {
    if (selectedMmsi.peek()) followSelected.value = false;
  });
}

// ---------- screens ----------

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} שנ׳`;
  if (s < 3600) return `${Math.round(s / 60)} דק׳`;
  return `${Math.round(s / 3600)} שע׳`;
}

const inBaltic = (b: [number, number, number, number]) => b[0] <= BALTIC[2] && b[2] >= BALTIC[0] && b[1] <= BALTIC[3] && b[3] >= BALTIC[1];

/** Center the map on a ship and open its card. */
function pickShip(s: Ship) {
  map.easeTo({ center: s.lngLat, zoom: Math.max(map.getZoom(), 10), duration: 800 });
  openShip(s.mmsi);
}

function FeedStatus() {
  const f = feed.value;
  const st = feedState.value;
  if (!f) return <p class="live-status" role="status">{st === 'error' ? 'לא הצלחנו לטעון ספינות כרגע. ננסה שוב בעוד רגע.' : 'טוענים את הספינות שבמפה…'}</p>;
  const flt = filters.value;
  const shown = isFiltered(flt) ? f.ships.filter((s) => passes(s, flt)) : f.ships;
  const moving = shown.filter((s) => !isStopped(s)).length;
  const src = f.sources.map((x) => (x === 'aisstream' ? 'aisstream.io' : 'Digitraffic')).join(' · ');
  const sos = f.ships.filter((s) => shipAlert(s));
  const wide = f.ships.some((s) => s.brief);
  return (
    <>
      <p class="live-status" role="status">
        <strong>{shown.length.toLocaleString('he-IL')}</strong> ספינות במפה
        <span class="muted">
          {' '}· {moving.toLocaleString('he-IL')} בתנועה{isFiltered(flt) && ' · מסונן'} · עודכן לפני {ago(now.value - f.receivedAt)}
          {src && ` · ${src}`}
        </span>
        {st === 'error' && <span class="flight-error"> · העדכון האחרון נכשל</span>}
      </p>
      {!f.live && !inBaltic(f.box) && (
        <p class="small live-note">
          {f.note === 'relay-error'
            ? 'שירות הספינות העולמי לא זמין כרגע. ננסה שוב.'
            : 'כרגע מוצגות ספינות רק בים הבלטי. ספינות בישראל ובשאר העולם יופיעו כשיחובר מקור הנתונים העולמי.'}
        </p>
      )}
      {f.live && f.ships.length < (wide ? 200 : 1) && (
        <p class="small live-note">אוספים את הספינות מכל העולם. ספינות בתנועה משדרות כל כמה שניות ובעוגן כל כמה דקות, אז המפה תתמלא בדקה-שתיים הקרובות.</p>
      )}
      {sos.length > 0 && (
        <button class="live-emergency live-sos" onClick={() => pickShip(sos[0])}>
          <Icon name="warning" size={18} />
          {sos.length === 1 ? shipAlert(sos[0]) : `${sos.length.toLocaleString('he-IL')} ספינות במצוקה או בבעיה`}
          <span dir="ltr"> · {sos[0].name || sos[0].mmsi}</span>
        </button>
      )}
    </>
  );
}

function FindShip() {
  const [q, setQ] = useState('');
  const f = feed.value;
  const needle = q.trim().toUpperCase();
  const list =
    needle.length >= 2 && f
      ? f.ships
          .filter((s) => (s.name ?? '').toUpperCase().includes(needle) || String(s.mmsi).startsWith(needle) || (s.imo && String(s.imo).startsWith(needle)) || (s.callsign ?? '').toUpperCase() === needle)
          .slice(0, 8)
      : [];
  return (
    <form class="live-find" onSubmit={(e) => (e.preventDefault(), list[0] && openShip(list[0].mmsi))}>
      <input class="flight-input" dir="ltr" placeholder="שם ספינה, MMSI או IMO" aria-label="חיפוש ספינה" maxLength={30} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {list.length > 0 && (
        <ul class="flight-results" aria-label="ספינות">
          {list.map((s) => (
            <li key={s.mmsi}>
              <button type="button" class="flight-result" onClick={() => openShip(s.mmsi)}>
                <span class="ship-dot" style={{ background: SHIP_CATEGORIES.find((c) => c.id === shipCategory(s.type))!.color }} />
                <span class="flight-result-name" dir="ltr">{s.name || s.mmsi}</span>
                <span class="small muted">{shipTypeName(s.type)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle.length >= 2 && !list.length && <p class="small muted">לא נמצאה ספינה כזאת באזור שעל המפה.</p>}
    </form>
  );
}

/** A small upright silhouette of the kind, for the chips. */
function KindIcon({ cat }: { cat: ShipCategory }) {
  const src = shipPicture(cat, isDark.value, 'thumb');
  return src ? <img class="ship-kind-icon" src={src} alt="" aria-hidden="true" /> : <span class="ship-dot" style={{ background: SHIP_CATEGORIES.find((c) => c.id === cat)!.color }} />;
}

/** The kinds of ships (each with its silhouette and how many are on the map; a tap hides or shows it) and the filters. */
function Legend() {
  const flt = filters.value;
  const f = feed.value;
  const [more, setMore] = useState(false);
  const t = tally(f?.ships ?? []);
  const toggle = (id: ShipCategory) => setFilters({ hide: flt.hide.includes(id) ? flt.hide.filter((x) => x !== id) : [...flt.hide, id] });
  const flags = t.flags.slice(0, 40);
  if (flt.flag && !flags.some(([iso]) => iso === flt.flag)) flags.unshift([flt.flag, 0]);
  return (
    <section class="ship-legend" aria-label="סוגי ספינות">
      <div class="chips ship-kinds">
        {SHIP_CATEGORIES.map((c) => (
          <button key={c.id} class="chip" aria-pressed={!flt.hide.includes(c.id)} onClick={() => toggle(c.id)}>
            <KindIcon cat={c.id} />
            {c.label}
            {f && <span class="ship-count">{(t.byCat[c.id] ?? 0).toLocaleString('he-IL')}</span>}
          </button>
        ))}
      </div>
      <div class="chips">
        <button class="chip" aria-pressed={flt.moving} onClick={() => setFilters({ moving: !flt.moving })}>
          <Icon name="sailing" />
          רק בתנועה
        </button>
        <button class="chip" aria-pressed={flt.alerts} onClick={() => setFilters({ alerts: !flt.alerts })}>
          <Icon name="warning" />
          רק במצוקה
        </button>
        <button class="chip" aria-expanded={more} aria-pressed={!!flt.flag || flt.minLen > 0} onClick={() => setMore(!more)}>
          <Icon name="tune" />
          דגל וגודל
        </button>
        {isFiltered(flt) && (
          <button class="chip" onClick={() => setFilters(NO_SHIP_FILTERS)}>
            <Icon name="close" />
            הצגת הכול
          </button>
        )}
      </div>
      {more && (
        <div class="live-filter-panel" role="group" aria-label="סינון לפי דגל וגודל">
          <label class="live-filter-row">
            <span>דגל</span>
            <select value={flt.flag} onChange={(e) => setFilters({ flag: (e.target as HTMLSelectElement).value })}>
              <option value="">כל הדגלים</option>
              {flags.map(([iso, n]) => (
                <option key={iso} value={iso}>
                  {flagEmoji(iso)} {countryNameHe(iso)}
                  {n ? ` (${n.toLocaleString('he-IL')})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label class="live-filter-row">
            <span>אורך</span>
            <select value={String(flt.minLen)} onChange={(e) => setFilters({ minLen: Number((e.target as HTMLSelectElement).value) })}>
              {SHIP_SIZES.map((z) => (
                <option key={z.id} value={String(z.minM)}>
                  {z.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p class="small muted ship-shapes">כל סוג בצורה ובצבע משלו, מופנה לכיוון ההפלגה · <span class="ship-shape-dot" aria-hidden="true" /> במבט רחוק: עומדת בעוגן או ברציף</p>
    </section>
  );
}

function SavedList() {
  const list = savedShips.value;
  const f = feed.value;
  if (!list.length) return null;
  return (
    <section class="live-saved" aria-label="הספינות שלי">
      <h3 class="small muted">הספינות שלי</h3>
      <ul class="flight-results">
        {list.map((s) => {
          const live = f?.ships.find((x) => x.mmsi === s.mmsi);
          return (
            <li key={s.mmsi}>
              <button type="button" class="flight-result" disabled={!live} onClick={() => live && (map.easeTo({ center: live.lngLat, zoom: Math.max(map.getZoom(), 10) }), openShip(s.mmsi))}>
                <Icon name="bookmark" size={20} />
                <span class="flight-result-name" dir="ltr">{s.name}</span>
                {live ? <span class="live-dot" aria-label="במפה" /> : <span class="small muted">לא באזור שעל המפה</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LiveShipsView(_: ViewProps) {
  useEffect(() => {
    if (sheet.peek() === 'full') sheet.value = 'half';
  }, []);
  return (
    <div class="view flight live-flights live-ships">
      <div class="flight-head">
        <Icon name="directions_boat" class="flight-logo" />
        <h2>ספינות בזמן אמת</h2>
        <button class="icon-btn" aria-label="סגירה" title="סגירה" onClick={back}>
          <Icon name="close" />
        </button>
      </div>
      <FeedStatus />
      <div class="chips flight-chips">
        <button class="chip" onClick={() => map.easeTo({ center: [20, 25], zoom: 1.3, bearing: 0, pitch: 0, duration: 900 })}>
          <Icon name="public" />
          כל העולם
        </button>
      </div>
      <FindShip />
      <Legend />
      <SavedList />
      <p class="muted small flight-privacy">
        הקישו על ספינה לפרטים, למסלול ולמעקב. מוצגות כל הספינות שנקלטו בעולם, עד כל העולם בבת אחת. הספינות משדרות את המיקום בעצמן (AIS) ונקלטות בתחנות חוף, ולכן הכיסוי טוב ליד החופים ודל בלב ים. נשלח רק אזור המפה שעל המסך, לא המיקום שלכם.
        נתונים: aisstream.io, ו-Fintraffic / digitraffic.fi (CC BY 4.0).
      </p>
    </div>
  );
}

function Stat({ icon, label, value, unit, sub }: { icon: string; label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div class="flight-stat">
      <div class="flight-stat-label">
        <Icon name={icon} size={16} />
        {label}
      </div>
      <div class="flight-stat-value">
        <span dir="ltr">{value}</span>
        {unit && <span class="flight-unit">{unit}</span>}
      </div>
      {sub && <div class="flight-stat-sub">{sub}</div>}
    </div>
  );
}

const COMPASS = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

/** Until (or unless) there is a photo of the ship itself: a big picture of its kind. */
function KindPicture({ cat }: { cat: ShipCategory }) {
  const src = shipPicture(cat, isDark.value, 'side');
  if (!src) return null;
  const color = SHIP_CATEGORIES.find((c) => c.id === cat)!.color;
  return (
    <figure class="ship-picture" style={{ '--ship': color } as Record<string, string>}>
      <img src={src} alt="" aria-hidden="true" />
      <figcaption class="small muted">{SHIP_CATEGORIES.find((c) => c.id === cat)!.label} · אין עדיין תמונה של הספינה הזאת</figcaption>
    </figure>
  );
}

function VesselFacts({ imo, cat }: { imo: number | null; cat: ShipCategory }) {
  const v = imo ? info.value[imo] : null;
  if (!v) return <KindPicture cat={cat} />;
  const rows: [string, string | number][] = (
    [
      ['מה זה', v.kind],
      ['שנת בנייה', v.built],
      ['מספנה', v.builder],
      ['טונאז׳ (GT)', v.grossTonnage?.toLocaleString('he-IL')],
      ['בעלים', v.owner],
      ['מפעיל', v.operator],
      ['נמל רישום', v.homeport],
    ] as [string, string | number | null | undefined][]
  ).filter((r): r is [string, string | number] => r[1] !== null && r[1] !== undefined && r[1] !== '');
  return (
    <>
      {!v.photo && <KindPicture cat={cat} />}
      {v.photo && (
        <figure class="live-photo">
          <a href={v.photo.pageUrl} target="_blank" rel="noopener">
            <img src={v.photo.thumbUrl} width={v.photo.width ?? 640} height={v.photo.height ?? 420} alt="תמונה של הספינה" loading="lazy" />
          </a>
          <figcaption class="small muted">
            {v.photo.author && <span dir="auto">{v.photo.author}</span>}
            {v.photo.license && ` · ${v.photo.license}`} · ויקישיתוף
          </figcaption>
        </figure>
      )}
      {rows.length > 0 && (
        <section class="ship-facts" aria-label="על הספינה">
          <h3 class="small muted">על הספינה</h3>
          <dl>
            {rows.map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd dir="auto">{val}</dd>
              </div>
            ))}
          </dl>
          {v.article && (
            <a class="small" href={v.article} target="_blank" rel="noopener">
              הערך בוויקיפדיה
            </a>
          )}
          <p class="small muted">מתוך ויקינתונים</p>
        </section>
      )}
    </>
  );
}

export function ShipView({ view }: ViewProps<{ mmsi: number }>) {
  const mmsi = Number(view.props?.mmsi ?? 0);
  const s = selected.value;
  useEffect(() => {
    if (selectedMmsi.peek() !== mmsi) selectedMmsi.value = mmsi;
    void loadTrack(mmsi);
    if (sheet.peek() === 'peek') sheet.value = 'half';
    return () => {
      if (selectedMmsi.peek() === mmsi) selectedMmsi.value = null;
      if (track.peek()?.mmsi === mmsi) track.value = null;
    };
  }, [mmsi]);
  useEffect(() => {
    if (s?.imo) void loadInfo(s.imo);
  }, [s?.imo]);
  useEffect(() => {
    if (s?.brief) void loadDetails(s);
  }, [s?.mmsi, s?.brief]);
  const [copied, setCopied] = useState(false);
  if (!s) {
    return (
      <div class="view flight live-flights live-ships">
        <div class="flight-head">
          <Icon name="directions_boat" class="flight-logo" />
          <h2 dir="ltr">{mmsi || ''}</h2>
          <button class="icon-btn" aria-label="סגירה" title="סגירה" onClick={back}>
            <Icon name="close" />
          </button>
        </div>
        <p class="live-status">{feed.value ? 'הספינה לא נקלטה באזור שעל המפה בדקות האחרונות. אולי תיקלט שוב בעדכון הבא.' : 'טוענים…'}</p>
      </div>
    );
  }
  const cat = shipCategory(s.type);
  const color = SHIP_CATEGORIES.find((c) => c.id === cat)!.color;
  const flag = flagOf(s.mmsi);
  const dest = destinationName(s.destination);
  const nav = navStatusName(s.nav);
  const stopped = isStopped(s);
  const hazard = hazardOf(s.type);
  const alert = shipAlert(s);
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: s.name ?? 'ספינה', url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <div class="view flight live-flights live-ships">
      <div class="flight-head">
        <span class="ship-badge" style={{ background: color }} aria-hidden="true">
          <Icon name={cat === 'pleasure' ? 'sailing' : 'directions_boat'} size={20} />
        </span>
        <h2 dir="ltr" class="live-callsign">{s.name || s.mmsi}</h2>
        <button class="icon-btn" aria-label="סגירה" title="סגירה" onClick={back}>
          <Icon name="close" />
        </button>
      </div>
      <p class="ship-sub">
        {flag && (
          <span title={countryNameHe(flag)}>
            {flagEmoji(flag)} {countryNameHe(flag)} ·{' '}
          </span>
        )}
        {shipTypeName(s.type)}
        {nav && <> · {nav}</>}
      </p>
      {(dest.raw || s.eta) && (
        <div class="flight-dest">
          <Icon name="location_on" />
          <div class="flight-dest-body">
            <div class="flight-dest-name">
              {stopped && !s.sog ? 'יעד מוצהר: ' : 'בדרך ל'}
              {dest.port ?? <span dir="ltr">{dest.raw}</span>}
              {dest.port && dest.raw && <span class="flight-code" dir="ltr">{dest.raw}</span>}
            </div>
            {s.eta && (
              <div class="flight-dest-line">
                הגעה משוערת <span dir="ltr">{formatArrival((Date.parse(s.eta) - Date.now()) / 1000)}</span> ·{' '}
                {new Date(s.eta).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
              </div>
            )}
            <div class="flight-dest-line small muted">לפי מה שהצוות הזין במערכת</div>
          </div>
        </div>
      )}
      {alert && (
        <p class="live-emergency live-sos" role="status">
          <Icon name="warning" size={18} />
          {alert}
        </p>
      )}
      {hazard && (
        <p class="live-emergency" role="status">
          <Icon name="warning" size={18} />
          {hazard}
        </p>
      )}
      <div class="flight-grid">
        <Stat icon="speed" label="מהירות" value={s.sog === null ? '—' : s.sog.toFixed(1)} unit="קשר" sub={s.sog ? `${(s.sog * 1.852).toFixed(0)} קמ״ש` : undefined} />
        <Stat icon="explore" label="כיוון" value={s.cog === null ? '—' : `${Math.round(s.cog)}°`} sub={s.cog === null ? undefined : compass(s.cog)} />
        <Stat icon="water" label="שוקע" value={s.draught ? s.draught.toFixed(1) : '—'} unit={s.draught ? 'מ׳' : undefined} />
        <Stat icon="straighten" label="אורך × רוחב" value={s.length ? `${s.length}×${s.beam ?? '?'}` : '—'} unit={s.length ? 'מ׳' : undefined} />
      </div>
      <VesselFacts imo={s.imo} cat={cat} />
      <section class="ship-facts" aria-label="מזהים">
        <h3 class="small muted">מזהים</h3>
        <dl>
          <div>
            <dt>MMSI</dt>
            <dd dir="ltr">{s.mmsi}</dd>
          </div>
          {s.imo && (
            <div>
              <dt>IMO</dt>
              <dd dir="ltr">{s.imo}</dd>
            </div>
          )}
          {s.callsign && (
            <div>
              <dt>אות קריאה</dt>
              <dd dir="ltr">{s.callsign}</dd>
            </div>
          )}
          <div>
            <dt>נקלט</dt>
            <dd>
              לפני {ago(now.value - s.at)} · {s.source === 'aisstream' ? 'aisstream.io' : 'Digitraffic'}
            </dd>
          </div>
        </dl>
      </section>
      <div class="chips flight-chips">
        <button
          class="chip"
          aria-pressed={followSelected.value}
          onClick={() => {
            followSelected.value = !followSelected.value;
          }}
        >
          <Icon name="my_location" />
          {followSelected.value ? 'המפה עוקבת' : 'מעקב כבוי'}
        </button>
        <button class="chip" aria-pressed={isSaved(s.mmsi)} onClick={() => toggleSaved(s)}>
          <Icon name={isSaved(s.mmsi) ? 'bookmark' : 'bookmark_outline'} />
          {isSaved(s.mmsi) ? 'שמורה' : 'שמירת הספינה'}
        </button>
        <button class="chip" onClick={() => void share()}>
          <Icon name="share" />
          {copied ? 'הקישור הועתק' : 'שיתוף'}
        </button>
      </div>
      <p class="muted small flight-privacy">
        הקו הכחול הוא הדרך שהספינה עשתה בשעות האחרונות (כשנקלטה), והקו המקווקו הוא לאן תגיע בחצי השעה הקרובה במהירות ובכיוון הנוכחיים. יעד, זמן הגעה ושוקע מוזנים בידי הצוות ולפעמים לא מעודכנים.
      </p>
    </div>
  );
}

/** The round map button under the planes button: every ship, one tap. */
export function ShipsButton() {
  const on = isShipsOn.value;
  return (
    <button
      class={`ctrl live-ctrl ships-ctrl${on ? ' on' : ''}`}
      aria-label={on ? 'הסתרת הספינות' : 'ספינות בזמן אמת'}
      title={on ? 'הסתרת הספינות' : 'ספינות בזמן אמת'}
      aria-pressed={on}
      onClick={() => {
        if (!on) return openShips();
        const stack = viewStack.peek();
        let n = 0;
        for (let i = stack.length - 1; i >= 0 && (stack[i].kind === SHIPS_VIEW || stack[i].kind === SHIP_VIEW); i--) n++;
        if (n) for (let i = 0; i < n; i++) back();
        else openShips();
      }}
    >
      <Icon name="directions_boat" size={22} />
    </button>
  );
}

/** Opened from a shared link: the ships map, then the ship once it shows up. */
export function openFromUrl(mmsi?: number) {
  openShips();
  if (!mmsi) return;
  const stop = effect(() => {
    const f = feed.value;
    if (!f) return;
    queueMicrotask(() => stop());
    if (f.ships.some((s) => s.mmsi === mmsi)) openShip(mmsi);
  });
}
