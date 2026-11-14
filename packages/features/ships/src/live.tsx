import { computed, effect, signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  countryNameHe, destinationName, flagEmoji, flagOf, hazardOf, isStopped, navStatusName, SHIP_CATEGORIES, shipCategory, shipTypeName,
  formatArrival, type LngLat, type ShipCategory,
} from '@nm/core';
import { back, ensureLayer, EMPTY, Icon, isDark, load, open, providers, save, setGeoJSON, sheet, viewStack, type FeatureContext, type ViewProps } from '@nm/core/app';
import { BALTIC, isFresh, liveShipsTool, shipTrackTool, tools, vesselInfoTool, type LiveShips, type Ship, type VesselInfo } from '@nm/tools';
import { addShipIcons, shipIcon, type Shape } from './icons.ts';

/**
 * Live ships: every ship broadcasting AIS in the map area, moving in real time, coloured by what
 * it is (cargo, tanker, passenger...), an arrow-like hull when under way and a dot when stopped.
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
/** Hidden categories, and "only under way". */
export const hidden = signal<ShipCategory[]>(load<ShipCategory[]>('nm:ships:hide', []));
export const movingOnly = signal(false);

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

/** Refresh: ships move slowly and report every 2 s to 3 min. */
const EVERY_MS = 15_000;
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

export const selected = computed<Ship | null>(() => {
  const m = selectedMmsi.value;
  const s = m ? feed.value?.ships.find((x) => x.mmsi === m) : undefined;
  return s ? { ...s, lngLat: glide(s, now.value) } : null;
});

const passes = (s: Ship) => !hidden.value.includes(shipCategory(s.type)) && (!movingOnly.value || !isStopped(s));

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
  timer = setTimeout(() => void refresh(), EVERY_MS);
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
function tick() {
  now.value = Date.now();
  // Ships are slow: redraw them all every few seconds, the picked one every second.
  if (++ticks % 4 === 0) render();
  else renderSelected();
  const s = selected.peek();
  if (s && followSelected.peek()) {
    const at = map.project(s.lngLat), c = map.project(map.getCenter());
    if (Math.hypot(at.x - c.x, at.y - c.y) > 2) map.easeTo({ center: s.lngLat, duration: 900, easing: (t) => t });
  }
}

// ---------- map ----------

const SRC = 'live-ships';
const SEL = 'live-ships-selected';
const LAYER = 'live-ships-icons';

export function shapeOf(s: Ship): Shape {
  if (isStopped(s)) return 'dot';
  const t = s.type ?? 0;
  if ((t >= 40 && t <= 49) || (s.sog ?? 0) > 25) return 'fast';
  return (s.length ?? 0) >= 150 ? 'big' : 'hull';
}
const iconOf = (s: Ship) => shipIcon(shipCategory(s.type), shapeOf(s));
const rotationOf = (s: Ship) => (isStopped(s) ? 0 : (s.heading ?? s.cog ?? 0));

function shipsData(): Parameters<typeof setGeoJSON>[2] {
  const f = feed.peek();
  if (!f || !isShipsOn.peek()) return EMPTY;
  const t = Date.now();
  const sel = selectedMmsi.peek();
  const features = [];
  for (const s of f.ships) {
    if (s.mmsi === sel || !passes(s)) continue;
    features.push({
      type: 'Feature' as const,
      properties: { m: s.mmsi, n: s.name ?? '', i: iconOf(s), r: rotationOf(s), k: isStopped(s) ? 0 : 1 },
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
  features.push({ type: 'Feature', properties: { kind: 'ship', m: s.mmsi, n: s.name ?? '', i: iconOf(s), r: rotationOf(s) }, geometry: { type: 'Point', coordinates: s.lngLat } });
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
      'icon-image': ['get', 'i'] as never,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.45, 6, 0.65, 10, 0.9, 14, 1.15] as never,
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
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.9, 12, 1.4] as never,
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
    void hidden.value;
    void movingOnly.value;
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

function FeedStatus() {
  const f = feed.value;
  const st = feedState.value;
  if (!f) return <p class="live-status" role="status">{st === 'error' ? 'לא הצלחנו לטעון ספינות כרגע. ננסה שוב בעוד רגע.' : 'טוענים את הספינות שבמפה…'}</p>;
  const shown = f.ships.filter(passes);
  const moving = shown.filter((s) => !isStopped(s)).length;
  const src = f.sources.map((x) => (x === 'aisstream' ? 'aisstream.io' : 'Digitraffic')).join(' · ');
  const filtered = hidden.value.length > 0 || movingOnly.value;
  return (
    <>
      <p class="live-status" role="status">
        <strong>{shown.length.toLocaleString('he-IL')}</strong> ספינות במפה
        <span class="muted">
          {' '}· {moving.toLocaleString('he-IL')} בתנועה{filtered && ' · מסונן'} · עודכן לפני {ago(now.value - f.receivedAt)}
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
      {f.live && f.ships.length === 0 && <p class="small live-note">אוספים את הספינות באזור הזה. ספינות בעוגן משדרות כל כמה דקות, אז המפה תתמלא בהדרגה.</p>}
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

/** What each colour means, and a tap hides or shows that kind. */
function Legend() {
  const h = hidden.value;
  const toggle = (id: ShipCategory) => {
    hidden.value = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
    save('nm:ships:hide', hidden.value);
  };
  return (
    <section class="ship-legend" aria-label="סוגי ספינות">
      <div class="chips">
        {SHIP_CATEGORIES.map((c) => (
          <button key={c.id} class="chip" aria-pressed={!h.includes(c.id)} onClick={() => toggle(c.id)}>
            <span class="ship-dot" style={{ background: c.color }} />
            {c.label}
          </button>
        ))}
      </div>
      <div class="chips">
        <button class="chip" aria-pressed={movingOnly.value} onClick={() => (movingOnly.value = !movingOnly.value)}>
          <Icon name="sailing" />
          רק בתנועה
        </button>
        {(h.length > 0 || movingOnly.value) && (
          <button class="chip" onClick={() => ((hidden.value = []), (movingOnly.value = false), save('nm:ships:hide', []))}>
            <Icon name="close" />
            הצגת הכול
          </button>
        )}
      </div>
      <p class="small muted ship-shapes">
        <span class="ship-shape-arrow" aria-hidden="true" /> בתנועה, לכיוון ההפלגה · <span class="ship-shape-dot" aria-hidden="true" /> עומדת (עוגן או רציף)
      </p>
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
      <FindShip />
      <Legend />
      <SavedList />
      <p class="muted small flight-privacy">
        הקישו על ספינה לפרטים, למסלול ולמעקב. הספינות משדרות את המיקום בעצמן (AIS) ונקלטות בתחנות חוף, ולכן הכיסוי טוב ליד החופים ודל בלב ים. נשלח רק אזור המפה שעל המסך, לא המיקום שלכם.
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

function VesselFacts({ imo }: { imo: number | null }) {
  const v = imo ? info.value[imo] : null;
  if (!v) return null;
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
      <VesselFacts imo={s.imo} />
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
