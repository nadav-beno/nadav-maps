import { batch, computed, signal, useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  bboxOf,
  droppedPin,
  formatArrival,
  formatClock,
  formatDistance,
  formatDuration,
  maneuverIcon,
  type DirectionsMode,
  type LngLat,
  type Place,
  type Route,
  type RouteTag,
  type TransitItinerary,
  type TravelMode,
  regionAt,
  trafficProvider,
} from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  cssVar,
  ensureLayer,
  EMPTY,
  elevationProfile,
  incognito,
  Icon,
  LineChip,
  lineColors,
  NEARBY_CHIPS,
  openNearbyResults,
  SendToPhone,
  type ElevationProfile,
  load,
  PlaceBadge,
  open,
  providers,
  region,
  requestLocation,
  save,
  setGeoJSON,
  toast,
  units,
  userLocation,
  type ViewProps,
} from '@nm/core/app';
import { categoryLabel, getDirections, reverseGeocode, searchNearby, searchPlaces, tools, trafficTravelTime, transitDirections } from '@nm/tools';

type Endpoint = { kind: 'me' } | { kind: 'place'; place: Place } | null;

const from = signal<Endpoint>(null);
const to = signal<Endpoint>(null);
const mode = signal<DirectionsMode>(load<DirectionsMode>('directions:mode', 'car'));
/** Stops on the way (car, walk and bike only). */
const vias = signal<Endpoint[]>([]);
/** Google allows 10 points: origin, destination and up to 8 stops on the way. */
const MAX_VIAS = 8;
/** When to travel by public transport; `at` is a local "YYYY-MM-DDTHH:mm". */
const when = signal<{ kind: 'now' | 'depart' | 'arrive'; at: string }>({ kind: 'now', at: '' });
const itineraries = signal<TransitItinerary[]>([]);
mode.subscribe((m) => save('directions:mode', m));

function persisted(key: string, initial: boolean) {
  const s = signal<boolean>(load(`directions:${key}`, initial));
  s.subscribe((v) => save(`directions:${key}`, v));
  return s;
}
const avoidTolls = persisted('avoidTolls', false);
const avoidHighways = persisted('avoidHighways', false);
const avoidFerries = persisted('avoidFerries', false);
const avoidUnpaved = persisted('avoidUnpaved', false);
const avoidStairs = persisted('avoidStairs', false);
const wheelchair = persisted('wheelchair', false);
const fewerTransfers = persisted('fewerTransfers', false);
const lessWalking = persisted('lessWalking', false);

/** Route options for a road mode, as get_directions takes them. */
function avoidFor(m: TravelMode) {
  const road = m === 'car' || m === 'motorcycle';
  return {
    avoidTolls: road && avoidTolls.value,
    avoidHighways: road && avoidHighways.value,
    avoidFerries: avoidFerries.value,
    avoidUnpaved: m !== 'walk' && avoidUnpaved.value,
    avoidStairs: m === 'walk' && avoidStairs.value,
  };
}
const transitPrefs = () => ({ wheelchair: wheelchair.value, fewerTransfers: fewerTransfers.value, lessWalking: lessWalking.value });

/** Routes planned lately, for the home screen (not kept in incognito). */
interface RecentRoute {
  from: { name: string; lng: number; lat: number } | 'me';
  to: { name: string; lng: number; lat: number };
  mode: DirectionsMode;
  at: number;
}
const recentRoutes = signal<RecentRoute[]>(load<RecentRoute[]>('directions:recent', []));
recentRoutes.subscribe((v) => save('directions:recent', v));

function rememberRoute() {
  const f = from.peek(), t = to.peek();
  if (incognito.peek() || t?.kind !== 'place' || !f) return;
  const pt = (p: Place) => ({ name: p.name, lng: p.lng, lat: p.lat });
  const entry: RecentRoute = { from: f.kind === 'me' ? 'me' : pt(f.place), to: pt(t.place), mode: mode.peek(), at: Date.now() };
  const same = (r: RecentRoute) => r.to.name === entry.to.name && Math.abs(r.to.lng - entry.to.lng) < 1e-4 && (r.from === 'me' ? entry.from === 'me' : entry.from !== 'me' && r.from.name === entry.from.name);
  recentRoutes.value = [entry, ...recentRoutes.peek().filter((r) => !same(r))].slice(0, 8);
}

const routes = signal<Route[]>([]);
const active = signal(0);
const loading = signal(false);
const error = signal<string | null>(null);
const haveLocation = computed(() => userLocation.value !== null);
/** Travel time per mode for the tabs, like Google ("רכב 12 דק׳ · הליכה 45 דק׳"). */
const modeTimes = signal<Partial<Record<DirectionsMode, number>>>({});
const profile = signal<ElevationProfile | null>(null);
/**
 * Car only, when a traffic key is set (HERE or TomTom, by region): the travel time with live
 * traffic for a route we show. Valhalla stays the route source; the traffic provider only times
 * that same line. Failures are silent.
 */
const trafficTimes = signal<Map<Route, number>>(new Map());

async function loadTrafficTime(r: Route) {
  const choice = trafficProvider(regionAt(r.geometry[0] ?? [0, 0]), providers.peek());
  if (!choice || r.mode !== 'car' || trafficTimes.peek().has(r) || r.geometry.length < 2) return;
  const seq = requestSeq;
  try {
    const t = await tools().call(trafficTravelTime, { waypoints: [r.geometry[0], ...viaCoords(), r.geometry[r.geometry.length - 1]], geometry: r.geometry });
    // Where the provider has no live traffic (TomTom in Israel) its time is only a historic
    // estimate: show it only when it reports an actual delay.
    const live = choice.live || (t?.delayS ?? 0) >= 60;
    if (t && live && seq === requestSeq) trafficTimes.value = new Map(trafficTimes.peek()).set(r, t.durationS);
  } catch {
    /* traffic is a bonus; the Valhalla time stands */
  }
}

let map: MapLibreMap;

function coordOf(e: Endpoint): LngLat | null {
  if (!e) return null;
  if (e.kind === 'me') {
    const u = userLocation.peek();
    return u ? [u.lng, u.lat] : null;
  }
  return [e.place.lng, e.place.lat];
}

function labelOf(e: Endpoint): string {
  if (!e) return '';
  return e.kind === 'me' ? 'המיקום שלי' : e.place.name;
}

function urlFor(): Record<string, unknown> {
  const pts: LngLat[] = [];
  const f = from.value, t = to.value;
  if (f?.kind === 'place') pts.push([f.place.lng, f.place.lat]);
  if (mode.value !== 'transit') for (const v of vias.value) if (v?.kind === 'place') pts.push([v.place.lng, v.place.lat]);
  if (t?.kind === 'place') pts.push([t.place.lng, t.place.lat]);
  return { route: pts, fromMe: f?.kind === 'me', mode: mode.value };
}

let requestSeq = 0;

function viaCoords(): LngLat[] {
  return vias.value.map(coordOf).filter((x): x is LngLat => !!x);
}

function whenIso(): { time?: string; arriveBy?: boolean } {
  const w = when.value;
  if (w.kind === 'now' || !w.at) return {};
  const d = new Date(w.at);
  return Number.isNaN(d.getTime()) ? {} : { time: d.toISOString(), arriveBy: w.kind === 'arrive' };
}

async function compute() {
  const a = coordOf(from.value);
  const b = coordOf(to.value);
  profile.value = null;
  if (!a || !b) {
    batch(() => {
      routes.value = [];
      itineraries.value = [];
    });
    drawRoutes();
    return;
  }
  const seq = ++requestSeq;
  const m = mode.value;
  batch(() => {
    loading.value = true;
    error.value = null;
  });
  try {
    if (m === 'transit') {
      const its = await tools().call(transitDirections, { from: a, to: b, ...whenIso(), ...transitPrefs() });
      if (seq !== requestSeq) return;
      batch(() => {
        itineraries.value = its;
        routes.value = [];
        active.value = 0;
        if (!its.length) error.value = 'לא מצאנו נסיעה בתחבורה ציבורית בזמן הזה. נסו שעה אחרת.';
        modeTimes.value = its[0] ? { transit: its[0].durationS } : {};
      });
    } else {
      const rs = await tools().call(getDirections, {
        waypoints: [a, ...viaCoords(), b],
        mode: m,
        alternatives: vias.value.length ? 0 : 2,
        ...avoidFor(m),
      });
      if (seq !== requestSeq) return;
      batch(() => {
        routes.value = rs;
        trafficTimes.value = new Map();
        itineraries.value = [];
        active.value = 0;
        if (!rs.length) error.value = 'לא מצאנו מסלול בין הנקודות האלה.';
        modeTimes.value = rs[0] ? { [m]: rs[0].durationS } : {};
      });
      if (rs[0] && m !== 'car') void loadProfile(rs[0], seq);
      if (rs[0] && m === 'car') void loadTrafficTime(rs[0]);
      if (rs[0]) rememberRoute();
    }
    if (m === 'transit') drawRoutes();
    else animateRoutes();
    fitRoutes();
    // The other modes' times, without geometry, for the mode tabs.
    for (const other of MODES.map((x) => x.id).filter((x) => x !== m)) {
      const p =
        other === 'transit'
          ? tools().call(transitDirections, { from: a, to: b, maxItineraries: 1, ...whenIso(), ...transitPrefs() }).then((r) => r[0]?.durationS)
          : tools().call(getDirections, { waypoints: [a, ...viaCoords(), b], mode: other, alternatives: 0, includeGeometry: false, ...avoidFor(other) }).then((r) => r[0]?.durationS);
      p.then((t) => {
        if (seq === requestSeq && t !== undefined) modeTimes.value = { ...modeTimes.value, [other]: t };
      }).catch(() => {});
    }
  } catch {
    if (seq !== requestSeq) return;
    batch(() => {
      routes.value = [];
      itineraries.value = [];
      error.value = m === 'transit' ? 'שירות התחבורה הציבורית לא זמין כרגע. נסו שוב בעוד רגע.' : 'חישוב המסלול נכשל. בדקו את החיבור ונסו שוב.';
    });
    drawRoutes();
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

async function loadProfile(r: Route, seq: number) {
  const p = await elevationProfile(r.geometry).catch(() => null);
  if (seq === requestSeq && routes.value[active.value] === r) profile.value = p;
}

const inDirections = () => currentView.peek().kind === 'directions';

let drawAnim = 0;

/** Draw the chosen route from origin to destination over ~0.6 s, like Google (not with reduced motion). */
function animateRoutes() {
  const r = routes.peek()[active.peek()];
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !r || r.geometry.length < 3 || typeof requestAnimationFrame !== 'function') return drawRoutes();
  const id = ++drawAnim;
  const t0 = performance.now();
  const step = (t: number) => {
    if (id !== drawAnim) return;
    const k = Math.min(1, (t - t0) / 600);
    drawRoutes(1 - (1 - k) ** 3);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function drawRoutes(progress = 1) {
  if (progress === 1) drawAnim++;
  if (!map?.getSource('routes')) return;
  const rs = inDirections() ? routes.value : [];
  setGeoJSON(map, 'routes', {
    type: 'FeatureCollection',
    // Active route last so it draws on top.
    features: rs
      .map((r, i) => ({
        type: 'Feature' as const,
        properties: { idx: i, active: i === active.value },
        geometry: { type: 'LineString' as const, coordinates: i === active.value && progress < 1 ? r.geometry.slice(0, Math.max(2, Math.ceil(r.geometry.length * progress))) : r.geometry },
      }))
      .sort((x, y) => Number(x.properties.active) - Number(y.properties.active)),
  });
  const it = inDirections() && mode.value === 'transit' ? itineraries.value[active.value] : undefined;
  setGeoJSON(map, 'transit-legs', {
    type: 'FeatureCollection',
    features: (it?.legs ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { walk: l.kind === 'walk', color: l.kind === 'ride' ? lineColors(l.mode ?? 'other', l.color).bg : '#5f6368' },
      geometry: { type: 'LineString' as const, coordinates: l.geometry },
    })),
  });
  setGeoJSON(map, 'transit-stops', {
    type: 'FeatureCollection',
    features: (it?.legs ?? [])
      .filter((l) => l.kind === 'ride')
      .flatMap((l) => [l.from, l.to])
      .map((p) => ({ type: 'Feature' as const, properties: { name: p.name }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
  });
  const pts = inDirections() ? [coordOf(from.value), ...(mode.value === 'transit' ? [] : vias.value.map(coordOf)), coordOf(to.value)] : [];
  setGeoJSON(map, 'route-ends', {
    type: 'FeatureCollection',
    features: pts
      .map((p, i) => (p ? { type: 'Feature' as const, properties: { end: i === pts.length - 1, via: i > 0 && i < pts.length - 1 }, geometry: { type: 'Point' as const, coordinates: p } } : null))
      .filter((x): x is NonNullable<typeof x> => !!x),
  });
}

function fitRoutes() {
  const line = mode.value === 'transit' ? (itineraries.value[active.value]?.legs ?? []).flatMap((l) => l.geometry) : routes.value.flatMap((x) => x.geometry);
  if (line.length < 2) return;
  const [w, s, e, n] = bboxOf(line);
  map.fitBounds([[w, s], [e, n]], { padding: { top: 80, bottom: 80, left: 60, right: 60 }, duration: 700, maxZoom: 17 });
}

function swap() {
  batch(() => {
    const f = from.value;
    from.value = to.value;
    to.value = f;
    vias.value = [...vias.value].reverse();
  });
  open({ kind: 'directions', props: { url: urlFor() } }, { replace: true });
  void compute();
}

// ---------------------------------------------------------------------------

function PointInput({ label, value, onChange, autoFocus }: { label: string; value: Endpoint; onChange: (e: Endpoint) => void; autoFocus?: boolean }) {
  const text = useSignal<string | null>(null);
  const sugg = useSignal<Place[]>([]);
  const focused = useSignal(false);
  const ref = useRef<HTMLInputElement>(null);
  const ac = useRef<AbortController | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onInput = (v: string) => {
    text.value = v;
    clearTimeout(timer);
    ac.current?.abort();
    if (v.trim().length < 2) {
      sugg.value = [];
      return;
    }
    timer = setTimeout(async () => {
      const c = map.getCenter();
      const ctrl = new AbortController();
      ac.current = ctrl;
      try {
        sugg.value = await tools().call(searchPlaces, { query: v, near: [c.lng, c.lat], zoom: map.getZoom(), limit: 6 }, { signal: ctrl.signal });
      } catch {
        /* keep previous suggestions */
      }
    }, 200);
  };

  const choose = (e: Endpoint) => {
    text.value = null;
    sugg.value = [];
    focused.value = false;
    ref.current?.blur();
    onChange(e);
  };

  return (
    <div class="point-input">
      <input
        ref={ref}
        class="input"
        aria-label={label}
        placeholder={label}
        autoFocus={autoFocus}
        value={text.value ?? labelOf(value)}
        onFocus={(e) => {
          focused.value = true;
          (e.target as HTMLInputElement).select();
        }}
        onBlur={() => setTimeout(() => (focused.value = false), 150)}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && sugg.value[0]) choose({ kind: 'place', place: sugg.value[0] });
        }}
      />
      {focused.value && (
        <ul class="suggestions inline" role="listbox">
          {value?.kind !== 'me' && (
            <li>
              <button class="suggestion" onMouseDown={(e) => e.preventDefault()} onClick={() => choose({ kind: 'me' })}>
                <span class="li-icon" aria-hidden="true">
                  <Icon name="my_location" size={20} style={{ color: 'var(--accent)' }} />
                </span>
                <span class="li-title">המיקום שלי</span>
              </button>
            </li>
          )}
          {sugg.value.map((p) => (
            <li key={p.id}>
              <button class="suggestion" onMouseDown={(e) => e.preventDefault()} onClick={() => choose({ kind: 'place', place: p })}>
                <PlaceBadge place={p} size={32} />
                <span class="li-body">
                  <span class="li-title">{p.name}</span>
                  <span class="li-sub">{[categoryLabel(p.category), p.address].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MODES: { id: DirectionsMode; label: string; icon: string }[] = [
  { id: 'car', label: 'רכב', icon: 'directions_car' },
  { id: 'transit', label: 'תחבורה ציבורית', icon: 'directions_bus' },
  { id: 'walk', label: 'הליכה', icon: 'directions_walk' },
  { id: 'bike', label: 'אופניים', icon: 'directions_bike' },
  { id: 'motorcycle', label: 'אופנוע', icon: 'two_wheeler' },
];

const TAG_LABELS: Record<RouteTag, { label: string; icon: string }> = {
  toll: { label: 'כביש אגרה', icon: 'toll' },
  ferry: { label: 'מעבורת', icon: 'directions_boat' },
  highway: { label: 'כביש מהיר', icon: 'add_road' },
};

/**
 * Google's one line on why a route is worth choosing: "המסלול הכי מהיר · חוסך 6 דק׳" for the
 * best one, "ארוך ב-4 דק׳ · בלי כביש אגרה" for the others.
 */
export function routeContext(rs: Route[], i: number, fastest: number, time: (r: Route) => number): string {
  const r = rs[i];
  if (!r) return '';
  const best = rs[fastest];
  const has = (x: Route, t: RouteTag) => !!x.tags?.includes(t);
  const parts: string[] = [];
  if (i === fastest) {
    if (rs.length < 2) return '';
    const second = Math.min(...rs.filter((_, j) => j !== i).map(time));
    const saves = Math.round((second - time(r)) / 60);
    parts.push('המסלול הכי מהיר');
    if (saves >= 2) parts.push(`חוסך ${saves} דק׳`);
  } else {
    const more = Math.round((time(r) - time(best)) / 60);
    parts.push(more >= 1 ? `ארוך ב-${more} דק׳` : 'זמן דומה');
    if (r.distanceM < best.distanceM * 0.9) parts.push('מסלול קצר יותר');
    if (has(best, 'toll') && !has(r, 'toll')) parts.push('בלי כביש אגרה');
    if (has(best, 'ferry') && !has(r, 'ferry')) parts.push('בלי מעבורת');
    if (has(best, 'highway') && !has(r, 'highway')) parts.push('בלי כבישים מהירים');
  }
  return parts.join(' · ');
}

function Steps({ route }: { route: Route }) {
  return (
    <ol class="steps">
      {route.steps.map((s, i) => (
        <li key={i} class="step">
          <span class="step-icon">
            <Icon name={maneuverIcon(s.type)} />
          </span>
          <span class="step-body">
            <span>{s.instruction}</span>
            {s.distanceM > 0 && <span class="muted small"> · {formatDistance(s.distanceM, units.value)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const clock = (iso: string) => formatClock(iso, region.value.timeZone);

/** The row of chips Google shows for a transit option: walk › 18 › walk › רכבת. */
function LegChips({ it }: { it: TransitItinerary }) {
  const legs = it.legs.filter((l) => l.kind === 'ride' || (l.distanceM ?? 0) > 80);
  return (
    <span class="tr-legs">
      {legs.map((l, i) => (
        <span key={i} class="tr-leg">
          {i > 0 && <Icon name="chevron_right" size={16} class="tr-sep" />}
          {l.kind === 'walk' ? (
            <span class="tr-walk">
              <Icon name="directions_walk" size={18} />
              {legs.length <= 3 && <span class="small">{formatDuration((new Date(l.end).getTime() - new Date(l.start).getTime()) / 1000)}</span>}
            </span>
          ) : (
            <LineChip mode={l.mode ?? 'other'} line={l.line} color={l.color} textColor={l.textColor} />
          )}
        </span>
      ))}
    </span>
  );
}

function TransitOption({ it, i }: { it: TransitItinerary; i: number }) {
  const firstRide = it.legs.find((l) => l.kind === 'ride');
  const sub = [
    firstRide ? `יציאה ב-${clock(firstRide.start)} מ${firstRide.from.name}` : 'הליכה בלבד',
    it.walkM > 0 ? `הליכה ${formatDistance(it.walkM, units.value)}` : '',
    it.transfers ? (it.transfers === 1 ? 'החלפה אחת' : `${it.transfers} החלפות`) : '',
  ].filter(Boolean);
  return (
    <button
      class={`route-option transit-option ${i === active.value ? 'active' : ''}`}
      aria-pressed={i === active.value}
      onClick={() => {
        active.value = i;
        drawRoutes();
        fitRoutes();
      }}
    >
      <span class="tr-span" dir="ltr">
        {clock(it.start)} – {clock(it.end)}
      </span>
      <span class="route-time">{formatDuration(it.durationS)}</span>
      <LegChips it={it} />
      <span class="route-sub muted small">
        {firstRide?.realtime && (
          <span class="live">
            <Icon name="rss_feed" size={13} /> בזמן אמת ·{' '}
          </span>
        )}
        {sub.join(' · ')}
      </span>
    </button>
  );
}

/** Step-by-step for a transit journey: walk to the stop, ride N stops, get off, walk. */
function TransitSteps({ it }: { it: TransitItinerary }) {
  return (
    <ol class="tr-steps">
      {it.legs.map((l, i) =>
        l.kind === 'walk' ? (
          <li key={i} class="tr-step walk">
            <span class="tr-rail walk" />
            <span class="tr-step-body">
              <span class="tr-step-title">
                <Icon name="directions_walk" size={18} /> הליכה {formatDuration((new Date(l.end).getTime() - new Date(l.start).getTime()) / 1000)}
                {l.distanceM ? ` (${formatDistance(l.distanceM, units.value)})` : ''}
              </span>
              <span class="muted small">{i === it.legs.length - 1 ? 'אל היעד' : `אל ${l.to.name}`}</span>
            </span>
          </li>
        ) : (
          <li key={i} class="tr-step ride">
            <span class="tr-rail" style={{ background: lineColors(l.mode ?? 'other', l.color).bg }} />
            <span class="tr-step-body">
              <span class="tr-stop">
                <strong>{clock(l.start)}</strong> {l.from.name}
                {l.from.track && <span class="muted small"> · רציף {l.from.track}</span>}
              </span>
              <span class="tr-ride">
                <LineChip mode={l.mode ?? 'other'} line={l.line} color={l.color} textColor={l.textColor} />
                <span>{l.headsign ? `לכיוון ${l.headsign}` : ''}</span>
              </span>
              <span class="muted small">
                {[l.stops ? (l.stops === 1 ? 'תחנה אחת' : `${l.stops} תחנות`) : '', formatDuration((new Date(l.end).getTime() - new Date(l.start).getTime()) / 1000), l.agency].filter(Boolean).join(' · ')}
                {l.realtime && <span class="live"> · בזמן אמת</span>}
              </span>
              <span class="tr-stop">
                <strong>{clock(l.end)}</strong> {l.to.name}
              </span>
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

function localNow(): string {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/** "Leave now / Depart at / Arrive by", like Google's transit time picker. */
function WhenPicker() {
  const w = when.value;
  const set = (v: typeof w) => {
    when.value = v;
    void compute();
  };
  return (
    <div class="when-picker">
      <select
        class="input select"
        aria-label="מתי"
        value={w.kind}
        onChange={(e) => {
          const kind = (e.target as HTMLSelectElement).value as typeof w.kind;
          set({ kind, at: kind === 'now' ? '' : w.at || localNow() });
        }}
      >
        <option value="now">יציאה עכשיו</option>
        <option value="depart">יציאה ב…</option>
        <option value="arrive">הגעה עד…</option>
      </select>
      {w.kind !== 'now' && (
        <input
          class="input"
          type="datetime-local"
          aria-label="שעה"
          value={w.at}
          onChange={(e) => set({ kind: w.kind, at: (e.target as HTMLInputElement).value })}
        />
      )}
    </div>
  );
}

/** Climb chart for walking and cycling routes. */
function Elevation({ p }: { p: ElevationProfile }) {
  const W = 320, H = 72;
  const total = p.points[p.points.length - 1].d || 1;
  const span = Math.max(10, p.max - p.min);
  const x = (d: number) => (d / total) * W;
  const y = (h: number) => H - 4 - ((h - p.min) / span) * (H - 12);
  const line = p.points.map((q, i) => `${i ? 'L' : 'M'}${x(q.d).toFixed(1)},${y(q.h).toFixed(1)}`).join(' ');
  return (
    <section class="elevation" aria-label="פרופיל גובה">
      <div class="elevation-head">
        <span>
          <Icon name="trending_up" size={18} /> עלייה {p.up} מ׳
        </span>
        <span>
          <Icon name="trending_down" size={18} /> ירידה {p.down} מ׳
        </span>
        <span class="muted small">
          {Math.round(p.min)}–{Math.round(p.max)} מ׳ מעל פני הים
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="elevation-chart" aria-hidden="true">
        <path d={`${line} L${W},${H} L0,${H} Z`} class="elev-fill" />
        <path d={line} class="elev-line" />
      </svg>
    </section>
  );
}

/** Hand the route to another app, as the catalog promised until our own navigation covers everything. */
function OtherApps({ dest }: { dest: LngLat }) {
  const [lng, lat] = dest;
  const m = mode.value;
  const g = { car: 'driving', motorcycle: 'driving', walk: 'walking', bike: 'bicycling', transit: 'transit' }[m];
  const apple = { car: 'd', motorcycle: 'd', walk: 'w', bike: 'c', transit: 'r' }[m];
  return (
    <div class="other-apps">
      <span class="muted small">פתיחה באפליקציה אחרת:</span>
      <a class="chip" href={`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`} target="_blank" rel="noopener noreferrer">
        Waze
      </a>
      <a class="chip" href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${g}`} target="_blank" rel="noopener noreferrer">
        Google Maps
      </a>
      <a class="chip" href={`https://maps.apple.com/?daddr=${lat},${lng}&dirflg=${apple}`} target="_blank" rel="noopener noreferrer">
        Apple Maps
      </a>
    </div>
  );
}

/** Google's "מה יש באזור <יעד>": category searches around the destination. */
function AroundDestination({ dest }: { dest: LngLat }) {
  const t = to.value;
  const name = t?.kind === 'place' && !t.place.id.startsWith('pt:') ? t.place.name : null;
  return (
    <section class="around-dest" aria-labelledby="around-title">
      <h3 id="around-title">{name ? `מה יש באזור ${name}` : 'מה יש באזור היעד'}</h3>
      <div class="chips">
        {NEARBY_CHIPS.slice(0, 5).map((c) => (
          <button
            key={c.id}
            class="chip"
            onClick={() =>
              void openNearbyResults({
                title: `${c.label} ליד ${name ?? 'היעד'}`,
                category: c.id,
                center: dest,
                map,
                fetch: (bbox) => tools().call(searchNearby, { category: c.id as never, bbox, limit: 60 }),
              })
            }
          >
            <Icon name={c.icon} size={18} />
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Index of the quickest option, by traffic-aware time where we have one. */
function fastestIndex(rs: Route[], traffic: Map<Route, number>): number {
  let best = 0;
  rs.forEach((x, i) => {
    if ((traffic.get(x) ?? x.durationS) < (traffic.get(rs[best]) ?? rs[best].durationS)) best = i;
  });
  return best;
}

type Toggle = { label: string; value: typeof avoidTolls };

function optionsFor(m: DirectionsMode): Toggle[] {
  if (m === 'transit')
    return [
      { label: 'נגיש לכיסא גלגלים', value: wheelchair },
      { label: 'פחות החלפות', value: fewerTransfers },
      { label: 'פחות הליכה', value: lessWalking },
    ];
  if (m === 'walk')
    return [
      { label: 'בלי מדרגות (עגלה, כיסא גלגלים)', value: avoidStairs },
      { label: 'בלי מעבורות', value: avoidFerries },
    ];
  if (m === 'bike')
    return [
      { label: 'בלי דרכי עפר', value: avoidUnpaved },
      { label: 'בלי מעבורות', value: avoidFerries },
    ];
  return [
    { label: 'בלי כבישי אגרה (כביש 6)', value: avoidTolls },
    { label: 'בלי כבישים מהירים', value: avoidHighways },
    { label: 'בלי מעבורות', value: avoidFerries },
    { label: 'בלי דרכי עפר', value: avoidUnpaved },
  ];
}

function RouteOptions({ m }: { m: DirectionsMode }) {
  return (
    <div class="option-list">
      {optionsFor(m).map((o) => (
        <label key={o.label}>
          <input
            type="checkbox"
            checked={o.value.value}
            onChange={(e) => {
              o.value.value = (e.target as HTMLInputElement).checked;
              void compute();
            }}
          />{' '}
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Move the stop at `from` to position `to` in [origin, ...stops, destination]. */
export function moveStop<T>(list: T[], fromIdx: number, toIdx: number): T[] {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= list.length || toIdx >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, x);
  return next;
}

/**
 * Origin, stops and destination; with stops on the way each row gets a handle to drag it
 * to another place in the order (or move it with the arrow keys), like Google.
 */
function StopList({ transit, onChange }: { transit: boolean; onChange: () => void }) {
  const drag = useSignal<{ from: number; over: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stops: Endpoint[] = [from.value, ...(transit ? [] : vias.value), to.value];
  const last = stops.length - 1;
  const reorderable = !transit && vias.value.length > 0;

  const apply = (list: Endpoint[]) => {
    batch(() => {
      from.value = list[0];
      to.value = list[list.length - 1];
      vias.value = list.slice(1, -1);
    });
    if (from.value?.kind === 'me' || to.value?.kind === 'me' || vias.value.some((v) => v?.kind === 'me')) if (!userLocation.peek()) requestLocation();
    onChange();
  };
  const set = (i: number, e: Endpoint) => {
    if (e?.kind === 'me' && !userLocation.value) requestLocation();
    if (i === 0) from.value = e;
    else if (i === last) to.value = e;
    else {
      const next = [...vias.value];
      if (e) next[i - 1] = e;
      else next.splice(i - 1, 1);
      vias.value = next;
    }
    onChange();
  };
  const rowAt = (y: number) => {
    const rows = [...(listRef.current?.querySelectorAll('.stop-row') ?? [])];
    const idx = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    return idx < 0 ? rows.length - 1 : idx;
  };

  return (
    <div class="endpoint-fields" ref={listRef}>
      {stops.map((v, i) => {
        const label = i === 0 ? 'נקודת מוצא' : i === last ? 'לאן?' : `עצירה ${i}`;
        const d = drag.value;
        return (
          <div key={i} class={`stop-row ${i > 0 && i < last ? 'via-row' : ''} ${d?.from === i ? 'dragging' : ''} ${d && d.over === i && d.from !== i ? 'drop-target' : ''}`}>
            {reorderable && (
              <button
                class="icon-btn small drag-handle"
                aria-label={`שינוי סדר: ${labelOf(v) || label}`}
                title="גררו כדי לשנות את הסדר"
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  drag.value = { from: i, over: i };
                }}
                onPointerMove={(e) => {
                  if (drag.value) drag.value = { ...drag.value, over: rowAt(e.clientY) };
                }}
                onPointerUp={() => {
                  const dd = drag.value;
                  drag.value = null;
                  if (dd && dd.over !== dd.from) apply(moveStop(stops, dd.from, dd.over));
                }}
                onPointerCancel={() => (drag.value = null)}
                onKeyDown={(e) => {
                  const to_ = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
                  if (to_ < 0 || to_ > last) return;
                  e.preventDefault();
                  apply(moveStop(stops, i, to_));
                }}
              >
                <Icon name="drag_indicator" size={20} />
              </button>
            )}
            <PointInput label={label} value={v} onChange={(e) => set(i, e)} autoFocus={i === last ? !to.value : i > 0 && !v} />
            {i > 0 && i < last && (
              <button class="icon-btn small" aria-label={`הסרת עצירה ${i}`} onClick={() => set(i, null)}>
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Google's "Best" tab: the quickest way to go right now, when it isn't the mode shown. */
function BestMode({ onPick }: { onPick: (m: DirectionsMode) => void }) {
  const times = Object.entries(modeTimes.value) as [DirectionsMode, number][];
  if (times.length < 2) return null;
  const [best, t] = times.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (best === mode.value) return null;
  const m = MODES.find((x) => x.id === best)!;
  return (
    <button class="best-mode chip" onClick={() => onPick(best)}>
      <Icon name="bolt" size={18} />
      הכי מהיר עכשיו: {m.label}, {formatDuration(t)}
    </button>
  );
}

function RecentRoutes() {
  const list = recentRoutes.value;
  if (!list.length || incognito.value) return null;
  const go = (r: RecentRoute) => {
    batch(() => {
      from.value = r.from === 'me' ? { kind: 'me' } : { kind: 'place', place: droppedPin(r.from.lng, r.from.lat, r.from.name) };
      to.value = { kind: 'place', place: { ...droppedPin(r.to.lng, r.to.lat, r.to.name), name: r.to.name } };
      vias.value = [];
      mode.value = r.mode;
    });
    if (r.from === 'me' && !userLocation.peek()) requestLocation();
    open({ kind: 'directions', props: { url: urlFor() } });
    void compute();
  };
  return (
    <section class="home-section recent-routes" aria-labelledby="recent-routes-title">
      <h3 id="recent-routes-title">מסלולים אחרונים</h3>
      <ul class="list">
        {list.slice(0, 3).map((r, i) => (
          <li key={i}>
            <button class="list-item" onClick={() => go(r)}>
              <span class="li-icon" aria-hidden="true">
                <Icon name={MODES.find((m) => m.id === r.mode)?.icon ?? 'directions'} size={20} />
              </span>
              <span class="li-body">
                <span class="li-title">{r.to.name}</span>
                <span class="li-sub">מ{r.from === 'me' ? 'המיקום שלי' : r.from.name}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        class="link-like small"
        onClick={() => {
          const old = recentRoutes.peek();
          recentRoutes.value = [];
          toast('המסלולים האחרונים נמחקו', { label: 'ביטול', run: () => (recentRoutes.value = old) });
        }}
      >
        ניקוי
      </button>
    </section>
  );
}

function DirectionsView(_: ViewProps) {
  const showSteps = useSignal(false);
  const showOptions = useSignal(false);
  const phoneOpen = useSignal(false);
  const transit = mode.value === 'transit';
  const rs = routes.value;
  const r = transit ? undefined : rs[active.value];
  const its = itineraries.value;
  const it = transit ? its[active.value] : undefined;
  const startable = from.value?.kind === 'me' && !!r;
  const dest = coordOf(to.value);
  const fastest = fastestIndex(rs, trafficTimes.value);

  const reroute = () => {
    open({ kind: 'directions', props: { url: urlFor() } }, { replace: true });
    void compute();
  };
  const set = (which: 'from' | 'to', e: Endpoint) => {
    if (which === 'from') from.value = e;
    else to.value = e;
    if (e?.kind === 'me' && !userLocation.value) requestLocation();
    reroute();
  };
  const destination = to.value?.kind === 'place' ? to.value.place : null;

  return (
    <div class="view directions">
      <div class="endpoints">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <div class="endpoint-dots" aria-hidden="true">
          <span class="from-dot" />
          {[...Array(3 + (transit ? 0 : vias.value.length * 4))].map((_, i) => (
            <span key={i} class="dot-line" />
          ))}
          <Icon name="location_on" size={18} class="to-dot" />
        </div>
        <StopList transit={transit} onChange={reroute} />
        <button class="icon-btn" aria-label="החלפת מוצא ויעד" onClick={swap}>
          <Icon name="swap_vert" />
        </button>
      </div>
      <div class="mode-tabs" role="group" aria-label="אמצעי תחבורה">
        {MODES.map((m) => {
          const t = modeTimes.value[m.id];
          return (
            <button
              key={m.id}
              class="mode-tab"
              aria-pressed={mode.value === m.id}
              aria-label={m.label}
              onClick={() => {
                mode.value = m.id;
                showSteps.value = false;
                reroute();
              }}
            >
              <Icon name={m.icon} size={20} />
              {t !== undefined ? formatDuration(t) : m.id === 'transit' ? 'תח״צ' : m.label}
            </button>
          );
        })}
      </div>
      <BestMode
        onPick={(m) => {
          mode.value = m;
          showSteps.value = false;
          reroute();
        }}
      />
      {transit && <WhenPicker />}
      <div class="options">
        {!transit && vias.value.length < MAX_VIAS && (
          <button class="link-like small" onClick={() => (vias.value = [...vias.value, null])}>
            <Icon name="add" size={18} /> הוספת עצירה
          </button>
        )}
        <button class="link-like small" aria-expanded={showOptions.value} onClick={() => (showOptions.value = !showOptions.value)}>
          <Icon name="tune" size={18} /> {transit ? 'העדפות נסיעה' : 'אפשרויות מסלול'}
          {optionsFor(mode.value).some((o) => o.value.value) && <span class="dot-badge" aria-label="יש אפשרויות פעילות" />}
        </button>
        {showOptions.value && <RouteOptions m={mode.value} />}
      </div>

      {from.value?.kind === 'me' && !haveLocation.value && <p class="muted small">ממתין למיקום שלך…</p>}
      {loading.value && (
        <ul class="route-options skeleton-list" role="progressbar" aria-label="מחשב מסלול">
          {[0, 1].map((i) => (
            <li key={i} class="skeleton route-skeleton" />
          ))}
        </ul>
      )}
      {error.value && !loading.value && <p class="error">{error.value}</p>}

      {!loading.value && !transit && rs.length > 0 && (
        <ul class="route-options">
          {rs.map((x, i) => (
            <li key={i}>
              <button
                class={`route-option ${i === active.value ? 'active' : ''}`}
                aria-pressed={i === active.value}
                onClick={() => {
                  active.value = i;
                  profile.value = null;
                  drawRoutes();
                  if (mode.value !== 'car') void loadProfile(x, requestSeq);
                  else void loadTrafficTime(x);
                }}
              >
                <span class="route-time">
                  {formatDuration(x.durationS)}
                  {trafficTimes.value.has(x) && (
                    <span
                      class={`route-traffic ${trafficTimes.value.get(x)! > x.durationS * 1.15 ? 'slow' : 'ok'}`}
                      title={`תנועה © ${trafficProvider(regionAt(x.geometry[0]), providers.value)?.id === 'here' ? 'HERE' : 'TomTom'}`}
                    >עם תנועה: {formatDuration(trafficTimes.value.get(x)!)}</span>
                  )}
                </span>
                <span class="route-dist">{formatDistance(x.distanceM, units.value)}</span>
                <span class="route-sub muted small">
                  {x.summary ? `דרך ${x.summary} · ` : ''}הגעה ב-{formatArrival(x.durationS, Date.now(), region.value.timeZone)}
                </span>
                {rs.length > 1 && <span class="route-context small">{routeContext(rs, i, fastest, (y) => trafficTimes.value.get(y) ?? y.durationS)}</span>}
                {!!x.tags?.filter((t) => t !== 'highway').length && (
                  <span class="route-tags">
                    {x.tags
                      .filter((t) => t !== 'highway')
                      .map((t) => (
                        <span key={t} class="route-tag">
                          <Icon name={TAG_LABELS[t].icon} size={14} />
                          {TAG_LABELS[t].label}
                        </span>
                      ))}
                  </span>
                )}
                {rs.length > 1 && i === fastest && <span class="route-badge">המסלול הכי מהיר</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading.value && transit && its.length > 0 && (
        <ul class="route-options">
          {its.map((x, i) => (
            <li key={i}>
              <TransitOption it={x} i={i} />
            </li>
          ))}
        </ul>
      )}

      {r && profile.value && <Elevation p={profile.value} />}

      {(r || it) && (
        <div class="route-actions">
          {r &&
            (startable ? (
              <button class="btn primary big" onClick={() => open({ kind: 'navigate', props: { route: r, destination, waypoints: [coordOf(from.value), ...viaCoords(), coordOf(to.value)].filter(Boolean) } })}>
                <Icon name="navigation" size={20} />
                יציאה לדרך
              </button>
            ) : (
              <button class="btn primary big" onClick={() => set('from', { kind: 'me' })}>
                <Icon name="navigation" size={20} />
                ניווט מהמיקום שלי
              </button>
            ))}
          {r && (
            <button class="btn big" onClick={() => open({ kind: 'navigate', props: { route: r, destination, simulate: true } })}>
              <Icon name="play_arrow" size={20} />
              תצוגה מקדימה
            </button>
          )}
          <button class={`btn big ${it ? 'primary' : ''}`} aria-expanded={showSteps.value} onClick={() => (showSteps.value = !showSteps.value)}>
            <Icon name="route" size={20} />
            {showSteps.value ? 'הסתרת השלבים' : 'שלבים'}
          </button>
        </div>
      )}
      {(r || it) && (
        <button class="link-like small send-phone" onClick={() => (phoneOpen.value = true)}>
          <Icon name="mobile_arrow_right" size={18} />
          שליחת המסלול לטלפון
        </button>
      )}
      {phoneOpen.value && (
        <SendToPhone
          title={to.value?.kind === 'place' ? `מסלול אל ${to.value.place.name}` : 'המסלול'}
          url={location.href}
          onClose={() => (phoneOpen.value = false)}
        />
      )}
      {r && showSteps.value && <Steps route={r} />}
      {it && showSteps.value && <TransitSteps it={it} />}
      {transit && its.length > 0 && <p class="muted tiny">לוחות זמנים וזמני אמת: Transitous ומשרד התחבורה. כדאי לוודא בתחנה.</p>}
      {(mode.value === 'walk' || mode.value === 'bike') && r && <p class="muted small">מסלולי הליכה ואופניים בשלב ניסיוני. שימו לב לשילוט בדרך.</p>}
      {dest && (r || it) && <AroundDestination dest={dest} />}
      {dest && (r || it) && <OtherApps dest={dest} />}
    </div>
  );
}

/** Google's blue "directions" button over the map: open the planner with an empty destination. */
function DirectionsFab() {
  if (currentView.value.kind !== 'home') return null;
  return (
    <button
      class="fab primary"
      aria-label="מסלול"
      title="מסלול"
      onClick={() => {
        batch(() => {
          from.value = { kind: 'me' };
          to.value = null;
          routes.value = [];
          itineraries.value = [];
          vias.value = [];
          modeTimes.value = {};
        });
        if (!userLocation.peek()) requestLocation();
        open({ kind: 'directions', props: { url: urlFor() } });
      }}
    >
      <Icon name="directions" size={26} />
    </button>
  );
}

export default defineFeature({
  id: 'directions',
  title: 'מסלולים',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('directions', DirectionsView, { hideTop: true });
    ctx.registerFab({ id: 'directions', order: 1, Component: DirectionsFab });
    ctx.registerHomeSection({ id: 'recent-routes', order: 20, Component: RecentRoutes });

    ctx.onStyle((m) => {
      setGeoJSON(m, 'routes', EMPTY);
      setGeoJSON(m, 'route-ends', EMPTY);
      setGeoJSON(m, 'transit-legs', EMPTY);
      setGeoJSON(m, 'transit-stops', EMPTY);
      const notActive = ['!', ['get', 'active']] as unknown as ['!', unknown];
      // Google-style route: blue with a darker blue edge; alternatives grey with a grey edge.
      const routeColor = cssVar('--route', '#4285f4');
      const routeCasing = cssVar('--route-casing', '#1967d2');
      ensureLayer(m, { id: 'route-alt-casing', type: 'line', source: 'routes', filter: notActive as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': cssVar('--route-alt-casing', '#80868b'), 'line-width': 9 } });
      ensureLayer(m, { id: 'route-alt', type: 'line', source: 'routes', filter: notActive as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': cssVar('--route-alt', '#bdc1c6'), 'line-width': 6 } });
      ensureLayer(m, { id: 'route-casing', type: 'line', source: 'routes', filter: ['get', 'active'] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': routeCasing, 'line-width': 10 } });
      ensureLayer(m, { id: 'route-line', type: 'line', source: 'routes', filter: ['get', 'active'] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': routeColor, 'line-width': 7 } });
      // Transit: rides in the line's colour, walks as grey dots, stops as white rings.
      ensureLayer(m, { id: 'transit-ride-casing', type: 'line', source: 'transit-legs', filter: ['!', ['get', 'walk']] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
      ensureLayer(m, { id: 'transit-ride', type: 'line', source: 'transit-legs', filter: ['!', ['get', 'walk']] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'] as never, 'line-width': 7 } });
      ensureLayer(m, { id: 'transit-walk', type: 'line', source: 'transit-legs', filter: ['get', 'walk'] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#5f6368', 'line-width': 5, 'line-dasharray': [0.1, 1.8] } });
      ensureLayer(m, { id: 'transit-stops', type: 'circle', source: 'transit-stops', paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#202124', 'circle-stroke-width': 2 } });
      ensureLayer(m, {
        id: 'route-ends',
        type: 'circle',
        source: 'route-ends',
        paint: {
          'circle-radius': ['case', ['get', 'via'], 6, 7],
          'circle-color': ['case', ['get', 'end'], '#ea4335', ['get', 'via'], '#fbbc04', '#ffffff'],
          'circle-stroke-color': ['case', ['get', 'end'], '#a50e0e', '#202124'],
          'circle-stroke-width': 3,
        },
      }, null);
      drawRoutes();
    });

    // Tap an alternative route on the map to pick it.
    ctx.onMapClick((_e, features) => {
      const f = features.find((x) => x.layer.id === 'route-alt' || x.layer.id === 'route-alt-casing');
      if (!f) return;
      active.value = Number(f.properties.idx);
      drawRoutes();
      return true;
    }, 50);

    // Opening the screen with a destination (from a place card, or a link).
    currentView.subscribe((v) => {
      if (v.kind === 'directions') {
        const p = v.props as { to?: Place; from?: Place; mode?: DirectionsMode } | undefined;
        if (p?.to) {
          batch(() => {
            if (p.mode) mode.value = p.mode;
            to.value = { kind: 'place', place: p.to! };
            from.value = p.from ? { kind: 'place', place: p.from } : { kind: 'me' };
          });
          if (!p.from && !userLocation.peek()) requestLocation();
          open({ kind: 'directions', props: { url: urlFor() } }, { replace: true });
          void compute();
        }
      }
      drawRoutes();
    });

    // When the location arrives and we were waiting for it, route.
    haveLocation.subscribe((has) => {
      if (has && from.peek()?.kind === 'me' && to.peek() && !routes.peek().length && currentView.peek().kind === 'directions') void compute();
    });

    const u = ctx.initialUrl;
    if (u.route) {
      if (u.mode) mode.value = u.mode;
      const pts = u.route;
      const dest = pts[pts.length - 1];
      const middle = pts.slice(u.fromMe ? 0 : 1, -1).slice(0, MAX_VIAS);
      batch(() => {
        to.value = { kind: 'place', place: droppedPin(dest[0], dest[1], 'יעד') };
        from.value = u.fromMe ? { kind: 'me' } : { kind: 'place', place: droppedPin(pts[0][0], pts[0][1], 'מוצא') };
        vias.value = middle.map((p, i) => ({ kind: 'place' as const, place: droppedPin(p[0], p[1], `עצירה ${i + 1}`) }));
      });
      if (u.fromMe) requestLocation();
      open({ kind: 'directions', props: { url: urlFor() } });
      void compute();
      // Links carry only coordinates; look up readable names for the fields.
      for (const which of [from, to]) {
        const e = which.peek();
        if (e?.kind !== 'place') continue;
        tools()
          .call(reverseGeocode, { lng: e.place.lng, lat: e.place.lat })
          .then((r) => {
            const cur = which.peek();
            if (r && cur?.kind === 'place' && cur.place.id === e.place.id) which.value = { kind: 'place', place: { ...cur.place, name: r.name, address: r.address } };
          })
          .catch(() => {});
      }
      vias.peek().forEach((v, i) => {
        if (v?.kind !== 'place') return;
        tools()
          .call(reverseGeocode, { lng: v.place.lng, lat: v.place.lat })
          .then((r) => {
            const cur = vias.peek();
            const c = cur[i];
            if (r && c?.kind === 'place' && c.place.id === v.place.id) vias.value = cur.map((x, j) => (j === i ? { kind: 'place', place: { ...c.place, name: r.name, address: r.address } } : x));
          })
          .catch(() => {});
      });
    }
  },
});
