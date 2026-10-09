import { batch, computed, signal, useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { bboxOf, droppedPin, formatArrival, formatDistance, formatDuration, maneuverIcon, type LngLat, type Place, type Route, type TravelMode } from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  ensureLayer,
  EMPTY,
  Icon,
  load,
  PlaceBadge,
  open,
  region,
  requestLocation,
  save,
  setGeoJSON,
  units,
  userLocation,
  type ViewProps,
} from '@nm/core/app';
import { categoryLabel, getDirections, reverseGeocode, searchPlaces, tools } from '@nm/tools';

type Endpoint = { kind: 'me' } | { kind: 'place'; place: Place } | null;

const from = signal<Endpoint>(null);
const to = signal<Endpoint>(null);
const mode = signal<TravelMode>(load<TravelMode>('directions:mode', 'car'));
mode.subscribe((m) => save('directions:mode', m));
const avoidTolls = signal(load('directions:avoidTolls', false));
const avoidHighways = signal(load('directions:avoidHighways', false));
avoidTolls.subscribe((v) => save('directions:avoidTolls', v));
avoidHighways.subscribe((v) => save('directions:avoidHighways', v));

const routes = signal<Route[]>([]);
const active = signal(0);
const loading = signal(false);
const error = signal<string | null>(null);
const haveLocation = computed(() => userLocation.value !== null);
/** Travel time per mode for the tabs, like Google ("רכב 12 דק׳ · הליכה 45 דק׳"). */
const modeTimes = signal<Partial<Record<TravelMode, number>>>({});

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
  if (t?.kind === 'place') pts.push([t.place.lng, t.place.lat]);
  return { route: pts, fromMe: f?.kind === 'me', mode: mode.value };
}

let requestSeq = 0;
async function compute() {
  const a = coordOf(from.value);
  const b = coordOf(to.value);
  if (!a || !b) {
    routes.value = [];
    drawRoutes();
    return;
  }
  const seq = ++requestSeq;
  batch(() => {
    loading.value = true;
    error.value = null;
  });
  try {
    const rs = await tools().call(getDirections, {
      waypoints: [a, b],
      mode: mode.value,
      alternatives: 2,
      avoidTolls: mode.value === 'car' && avoidTolls.value,
      avoidHighways: mode.value === 'car' && avoidHighways.value,
    });
    if (seq !== requestSeq) return;
    batch(() => {
      routes.value = rs;
      active.value = 0;
      if (!rs.length) error.value = 'לא מצאנו מסלול בין הנקודות האלה.';
      modeTimes.value = rs[0] ? { [mode.value]: rs[0].durationS } : {};
    });
    drawRoutes();
    fitRoutes();
    // The other modes' times, without geometry, for the mode tabs.
    for (const m of MODES.map((x) => x.id).filter((x) => x !== mode.value)) {
      tools()
        .call(getDirections, { waypoints: [a, b], mode: m, alternatives: 0, includeGeometry: false })
        .then((r) => {
          if (seq === requestSeq && r[0]) modeTimes.value = { ...modeTimes.value, [m]: r[0].durationS };
        })
        .catch(() => {});
    }
  } catch {
    if (seq !== requestSeq) return;
    batch(() => {
      routes.value = [];
      error.value = 'חישוב המסלול נכשל. בדקו את החיבור ונסו שוב.';
    });
    drawRoutes();
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

function drawRoutes() {
  if (!map?.getSource('routes')) return;
  const rs = currentView.peek().kind === 'directions' ? routes.value : [];
  setGeoJSON(map, 'routes', {
    type: 'FeatureCollection',
    // Active route last so it draws on top.
    features: rs
      .map((r, i) => ({
        type: 'Feature' as const,
        properties: { idx: i, active: i === active.value },
        geometry: { type: 'LineString' as const, coordinates: r.geometry },
      }))
      .sort((x, y) => Number(x.properties.active) - Number(y.properties.active)),
  });
  const pts = [coordOf(from.value), coordOf(to.value)];
  setGeoJSON(map, 'route-ends', {
    type: 'FeatureCollection',
    features: currentView.peek().kind === 'directions'
      ? pts
          .map((p, i) => (p ? { type: 'Feature' as const, properties: { end: i === 1 }, geometry: { type: 'Point' as const, coordinates: p } } : null))
          .filter((x): x is NonNullable<typeof x> => !!x)
      : [],
  });
}

function fitRoutes() {
  const r = routes.value[active.value];
  if (!r || r.geometry.length < 2) return;
  const [w, s, e, n] = bboxOf(routes.value.flatMap((x) => x.geometry));
  map.fitBounds([[w, s], [e, n]], { padding: { top: 80, bottom: 80, left: 60, right: 60 }, duration: 700, maxZoom: 17 });
}

function swap() {
  batch(() => {
    const f = from.value;
    from.value = to.value;
    to.value = f;
  });
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

const MODES: { id: TravelMode; label: string; icon: string }[] = [
  { id: 'car', label: 'רכב', icon: 'directions_car' },
  { id: 'walk', label: 'הליכה', icon: 'directions_walk' },
  { id: 'bike', label: 'אופניים', icon: 'directions_bike' },
];

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

function DirectionsView(_: ViewProps) {
  const showSteps = useSignal(false);
  const showOptions = useSignal(false);
  const rs = routes.value;
  const r = rs[active.value];
  const startable = from.value?.kind === 'me' && !!r;

  const set = (which: 'from' | 'to', e: Endpoint) => {
    if (which === 'from') from.value = e;
    else to.value = e;
    if (e?.kind === 'me' && !userLocation.value) requestLocation();
    open({ kind: 'directions', props: { url: urlFor() } }, { replace: true });
    void compute();
  };

  return (
    <div class="view directions">
      <div class="endpoints">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <div class="endpoint-dots" aria-hidden="true">
          <span class="from-dot" />
          <span class="dot-line" />
          <span class="dot-line" />
          <span class="dot-line" />
          <Icon name="location_on" size={18} class="to-dot" />
        </div>
        <div class="endpoint-fields">
          <PointInput label="נקודת מוצא" value={from.value} onChange={(e) => set('from', e)} />
          <PointInput label="לאן?" value={to.value} onChange={(e) => set('to', e)} autoFocus={!to.value} />
        </div>
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
                open({ kind: 'directions', props: { url: urlFor() } }, { replace: true });
                void compute();
              }}
            >
              <Icon name={m.icon} size={20} />
              {t !== undefined ? formatDuration(t) : m.label}
            </button>
          );
        })}
      </div>
      {mode.value === 'car' && (
        <div class="options">
          <button class="link-like small" aria-expanded={showOptions.value} onClick={() => (showOptions.value = !showOptions.value)}>
            אפשרויות מסלול
          </button>
          {showOptions.value && (
            <div class="option-list">
              <label>
                <input
                  type="checkbox"
                  checked={avoidTolls.value}
                  onChange={(e) => {
                    avoidTolls.value = (e.target as HTMLInputElement).checked;
                    void compute();
                  }}
                />{' '}
                בלי כבישי אגרה (כביש 6)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={avoidHighways.value}
                  onChange={(e) => {
                    avoidHighways.value = (e.target as HTMLInputElement).checked;
                    void compute();
                  }}
                />{' '}
                בלי כבישים מהירים
              </label>
            </div>
          )}
        </div>
      )}

      {from.value?.kind === 'me' && !haveLocation.value && <p class="muted small">ממתין למיקום שלך…</p>}
      {loading.value && <div class="spinner" role="progressbar" aria-label="מחשב מסלול" />}
      {error.value && !loading.value && <p class="error">{error.value}</p>}

      {!loading.value && rs.length > 0 && (
        <ul class="route-options">
          {rs.map((x, i) => (
            <li key={i}>
              <button
                class={`route-option ${i === active.value ? 'active' : ''}`}
                aria-pressed={i === active.value}
                onClick={() => {
                  active.value = i;
                  drawRoutes();
                }}
              >
                <span class="route-time">{formatDuration(x.durationS)}</span>
                <span class="route-dist">{formatDistance(x.distanceM, units.value)}</span>
                <span class="route-sub muted small">
                  {x.summary ? `דרך ${x.summary} · ` : ''}הגעה ב-{formatArrival(x.durationS, Date.now(), region.value.timeZone)}
                  {i === 0 && rs.length > 1 ? ' · המהיר ביותר' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {r && (
        <div class="route-actions">
          {startable ? (
            <button class="btn primary big" onClick={() => open({ kind: 'navigate', props: { route: r, destination: to.value?.kind === 'place' ? to.value.place : null } })}>
              <Icon name="navigation" size={20} />
              יציאה לדרך
            </button>
          ) : (
            <button class="btn primary big" onClick={() => set('from', { kind: 'me' })}>
              <Icon name="navigation" size={20} />
              ניווט מהמיקום שלי
            </button>
          )}
          <button class="btn big" aria-expanded={showSteps.value} onClick={() => (showSteps.value = !showSteps.value)}>
            <Icon name="route" size={20} />
            {showSteps.value ? 'הסתרת השלבים' : 'שלבים'}
          </button>
        </div>
      )}
      {r && showSteps.value && <Steps route={r} />}
      {mode.value !== 'car' && r && <p class="muted small">מסלולי הליכה ואופניים בשלב ניסיוני. שימו לב לשילוט בדרך.</p>}
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

    ctx.onStyle((m) => {
      setGeoJSON(m, 'routes', EMPTY);
      setGeoJSON(m, 'route-ends', EMPTY);
      const notActive = ['!', ['get', 'active']] as unknown as ['!', unknown];
      ensureLayer(m, { id: 'route-alt-casing', type: 'line', source: 'routes', filter: notActive as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#6e7378', 'line-width': 9 } });
      ensureLayer(m, { id: 'route-alt', type: 'line', source: 'routes', filter: notActive as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#bdc1c6', 'line-width': 6 } });
      ensureLayer(m, { id: 'route-casing', type: 'line', source: 'routes', filter: ['get', 'active'] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0d47a1', 'line-width': 10 } });
      ensureLayer(m, { id: 'route-line', type: 'line', source: 'routes', filter: ['get', 'active'] as never, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 7 } });
      ensureLayer(m, {
        id: 'route-ends',
        type: 'circle',
        source: 'route-ends',
        paint: {
          'circle-radius': 7,
          'circle-color': ['case', ['get', 'end'], '#ea4335', '#ffffff'],
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
        const p = v.props as { to?: Place; from?: Place } | undefined;
        if (p?.to) {
          batch(() => {
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
      batch(() => {
        to.value = { kind: 'place', place: droppedPin(dest[0], dest[1], 'יעד') };
        from.value = u.fromMe ? { kind: 'me' } : { kind: 'place', place: droppedPin(pts[0][0], pts[0][1], 'מוצא') };
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
    }
  },
});
