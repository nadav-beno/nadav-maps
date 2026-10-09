import { signal, useSignal, useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { Map as MapLibreMap, LngLatBoundsLike } from 'maplibre-gl';
import { distance, formatDistance, type BBox, type Place } from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  ensureLayer,
  EMPTY,
  load,
  open,
  openPlace,
  save,
  setGeoJSON,
  units,
  userLocation,
  viewStack,
  type ViewProps,
} from '@nm/core/app';
import { CATEGORIES, categoryById, categoryLabel, placeIcon, searchNearby, searchPlaces, tools } from '@nm/tools';

let map: MapLibreMap;

const RECENT_KEY = 'search:recent';
const recent = signal<string[]>(load(RECENT_KEY, []));
function remember(q: string) {
  const next = [q, ...recent.value.filter((r) => r !== q)].slice(0, 8);
  recent.value = next;
  save(RECENT_KEY, next);
}

/** Map center + zoom bias, so "פיצה" finds pizza near where you're looking. */
function bias() {
  const c = map.getCenter();
  return { near: [c.lng, c.lat] as [number, number], zoom: map.getZoom() };
}

function origin(): [number, number] {
  const u = userLocation.value;
  if (u) return [u.lng, u.lat];
  const c = map.getCenter();
  return [c.lng, c.lat];
}

/** Results on the map: numbered-free dots with names, clickable. */
function showResults(places: Place[]) {
  const data = {
    type: 'FeatureCollection' as const,
    features: places.map((p, i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { id: p.id, name: p.name, i },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  };
  setGeoJSON(map, 'search-results', data);
}

function fitPlaces(places: Place[]) {
  if (!places.length) return;
  if (places.length === 1) {
    map.flyTo({ center: [places[0].lng, places[0].lat], zoom: Math.max(map.getZoom(), 15) });
    return;
  }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of places) {
    w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }
  map.fitBounds([[w, s], [e, n]] as LngLatBoundsLike, { padding: 60, maxZoom: 16, duration: 600 });
}

let lastResults: Place[] = [];

export function focusPlace(p: Place) {
  if (p.extent && (p.category?.key === 'place' || p.category?.key === 'boundary')) {
    const [w, s, e, n] = p.extent;
    map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 15, duration: 700 });
  } else {
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16), duration: 700 });
  }
}

function choose(p: Place) {
  setGeoJSON(map, 'search-results', EMPTY);
  focusPlace(p);
  openPlace(p);
}

async function runSearch(q: string, opts: { openView?: boolean } = {}): Promise<Place[]> {
  remember(q);
  const results = await tools().call(searchPlaces, { query: q, ...bias(), limit: 15 });
  lastResults = results;
  if (opts.openView !== false) {
    if (results.length === 1) {
      choose(results[0]);
    } else {
      open({ kind: 'results', props: { title: q, places: results, url: { q } } });
      showResults(results);
      fitPlaces(results.slice(0, 8));
    }
  }
  return results;
}

async function runCategory(id: string) {
  const cat = categoryById(id)!;
  open({ kind: 'results', props: { title: cat.label, category: id, loading: true } });
  const b = map.getBounds();
  // Overpass gets slow on big areas: clamp to ~20 km around the center.
  const c = map.getCenter();
  const dLat = Math.min((b.getNorth() - b.getSouth()) / 2, 0.09);
  const dLng = Math.min((b.getEast() - b.getWest()) / 2, 0.11);
  const bbox: BBox = [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat];
  try {
    const o = origin();
    const places = (await tools().call(searchNearby, { category: id as never, bbox, limit: 60 }))
      .sort((a, b2) => distance(o, [a.lng, a.lat]) - distance(o, [b2.lng, b2.lat]))
      .slice(0, 40);
    lastResults = places;
    open({ kind: 'results', props: { title: cat.label, category: id, places } }, { replace: true });
    showResults(places);
  } catch (e) {
    open({ kind: 'results', props: { title: cat.label, category: id, error: (e as Error).message } }, { replace: true });
  }
}

// ---------------------------------------------------------------------------

function SearchBar() {
  const q = useSignal('');
  const focused = useSignal(false);
  const suggestions = useSignal<Place[]>([]);
  const active = useSignal(-1);
  const loading = useSignal(false);
  const error = useSignal<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reflect the current screen in the box (e.g. a place name), like Google Maps.
  useSignalEffect(() => {
    const v = currentView.value;
    if (focused.peek()) return;
    if (v.kind === 'results') q.value = String(v.props?.title ?? '');
    else if (v.kind === 'place') q.value = (v.props?.place as Place | undefined)?.name ?? '';
    else if (v.kind === 'home') q.value = '';
  });

  // "/" focuses search, like most map sites.
  useSignalEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(t.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const suggest = (text: string) => {
    clearTimeout(timer);
    abortRef.current?.abort();
    error.value = null;
    if (text.trim().length < 2) {
      suggestions.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    timer = setTimeout(async () => {
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        suggestions.value = await tools().call(searchPlaces, { query: text, ...bias(), limit: 7 }, { signal: ac.signal });
        active.value = -1;
      } catch (e) {
        if (!ac.signal.aborted) error.value = 'החיפוש לא זמין כרגע. בדקו את החיבור לאינטרנט.';
      } finally {
        if (abortRef.current === ac) loading.value = false;
      }
    }, 180);
  };

  const submit = async () => {
    const text = q.value.trim();
    if (!text) return;
    if (active.value >= 0 && suggestions.value[active.value]) {
      pick(suggestions.value[active.value]);
      return;
    }
    inputRef.current?.blur();
    focused.value = false;
    try {
      const r = await runSearch(text);
      if (!r.length) open({ kind: 'results', props: { title: text, places: [], url: { q: text } } });
    } catch {
      open({ kind: 'results', props: { title: text, error: 'החיפוש לא זמין כרגע. בדקו את החיבור לאינטרנט.' } });
    }
  };

  const pick = (p: Place) => {
    remember(q.value.trim() || p.name);
    q.value = p.name;
    focused.value = false;
    inputRef.current?.blur();
    choose(p);
  };

  const clear = () => {
    q.value = '';
    suggestions.value = [];
    setGeoJSON(map, 'search-results', EMPTY);
    if (viewStack.value.length) viewStack.value = [];
    inputRef.current?.focus();
  };

  const showDropdown = focused.value && (suggestions.value.length > 0 || (q.value.trim().length < 2 && recent.value.length > 0) || !!error.value);
  const isHome = currentView.value.kind === 'home';

  return (
    <div class="search">
      <form
        class="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <button type="button" class="icon-btn" aria-label="תפריט" onClick={() => open({ kind: 'menu' })}>
          ☰
        </button>
        <input
          ref={inputRef}
          class="search-input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
          placeholder="חיפוש מקום או כתובת"
          aria-label="חיפוש מקום או כתובת"
          aria-expanded={showDropdown}
          aria-controls="search-suggestions"
          aria-activedescendant={active.value >= 0 ? `sugg-${active.value}` : undefined}
          value={q.value}
          onInput={(e) => {
            q.value = (e.target as HTMLInputElement).value;
            suggest(q.value);
          }}
          onFocus={() => {
            focused.value = true;
            if (q.value) suggest(q.value);
          }}
          onBlur={() => setTimeout(() => (focused.value = false), 150)}
          onKeyDown={(e) => {
            const n = suggestions.value.length;
            if (e.key === 'ArrowDown' && n) {
              e.preventDefault();
              active.value = (active.value + 1) % n;
            } else if (e.key === 'ArrowUp' && n) {
              e.preventDefault();
              active.value = (active.value - 1 + n) % n;
            } else if (e.key === 'Escape') {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {loading.value && <span class="search-spinner" aria-hidden="true" />}
        {q.value && (
          <button type="button" class="icon-btn" aria-label="ניקוי" onClick={clear}>
            ✕
          </button>
        )}
      </form>
      {showDropdown && (
        <ul id="search-suggestions" class="suggestions" role="listbox">
          {error.value && <li class="suggestion error">{error.value}</li>}
          {q.value.trim().length < 2
            ? recent.value.map((r) => (
                <li key={r} role="option" aria-selected={false}>
                  <button
                    class="suggestion"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      q.value = r;
                      void submit();
                    }}
                  >
                    <span class="li-icon" aria-hidden="true">🕘</span>
                    <span class="li-title">{r}</span>
                  </button>
                </li>
              ))
            : suggestions.value.map((p, i) => (
                <li key={p.id} id={`sugg-${i}`} role="option" aria-selected={i === active.value}>
                  <button
                    class={`suggestion ${i === active.value ? 'active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                  >
                    <span class="li-icon" aria-hidden="true">{placeIcon(p)}</span>
                    <span class="li-body">
                      <span class="li-title">{p.name}</span>
                      <span class="li-sub">{[categoryLabel(p.category), p.address].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
        </ul>
      )}
      {isHome && !focused.value && (
        <div class="chips" role="toolbar" aria-label="חיפוש לפי קטגוריה">
          {CATEGORIES.slice(0, 8).map((c) => (
            <button key={c.id} class="chip" onClick={() => void runCategory(c.id)}>
              <span aria-hidden="true">{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ResultsProps {
  title: string;
  places?: Place[];
  category?: string;
  loading?: boolean;
  error?: string;
}

function ResultsView({ view }: ViewProps<ResultsProps>) {
  const p = view.props!;
  const o = origin();
  return (
    <div class="view">
      <header class="view-header">
        <button
          class="icon-btn"
          aria-label="חזרה"
          onClick={() => {
            setGeoJSON(map, 'search-results', EMPTY);
            back();
          }}
        >
          →
        </button>
        <h2>{p.title}</h2>
        {p.category && (
          <button class="btn small" onClick={() => void runCategory(p.category!)}>
            חיפוש באזור הזה
          </button>
        )}
      </header>
      {p.loading && <div class="spinner" role="progressbar" aria-label="טוען" />}
      {p.error && <p class="error">{p.error}</p>}
      {p.places && p.places.length === 0 && (
        <div class="muted">
          <p>לא מצאנו תוצאות.</p>
          <p class="small">נסו לכתוב אחרת, להוסיף עיר, או להזיז את המפה לאזור הנכון.</p>
        </div>
      )}
      <ul class="list">
        {p.places?.map((pl) => (
          <li key={pl.id}>
            <button class="list-item" onClick={() => choose(pl)}>
              <span class="li-icon" aria-hidden="true">{placeIcon(pl)}</span>
              <span class="li-body">
                <div class="li-title">{pl.name}</div>
                <div class="li-sub">{[categoryLabel(pl.category), pl.address].filter(Boolean).join(' · ')}</div>
              </span>
              <span class="li-end">{formatDistance(distance(o, [pl.lng, pl.lat]), units.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default defineFeature({
  id: 'search',
  title: 'חיפוש',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerSlot('top', SearchBar, 0);
    ctx.registerView('results', ResultsView);

    ctx.onStyle((m) => {
      setGeoJSON(m, 'search-results', EMPTY);
      ensureLayer(m, {
        id: 'search-results-dot',
        type: 'circle',
        source: 'search-results',
        paint: {
          'circle-radius': 7,
          'circle-color': '#ea4335',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      }, null);
      ensureLayer(m, {
        id: 'search-results-label',
        type: 'symbol',
        source: 'search-results',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 10,
          'text-optional': true,
        },
        paint: { 'text-color': '#c5221f', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      }, null);
      if (currentView.value.kind === 'results') showResults(lastResults);
    });

    ctx.onMapClick((_e, features) => {
      const hit = features.find((f) => f.layer.id === 'search-results-dot' || f.layer.id === 'search-results-label');
      if (!hit) return;
      const p = lastResults.find((r) => r.id === hit.properties.id);
      if (p) {
        openPlace(p);
        return true;
      }
    }, 100);

    // Leaving the results screen clears its markers.
    let prev = currentView.value.kind;
    currentView.subscribe((v) => {
      if (prev === 'results' && v.kind === 'home') setGeoJSON(ctx.map, 'search-results', EMPTY);
      if (v.kind === 'results' && prev !== 'results' && prev !== 'place') showResults((v.props?.places as Place[]) ?? []);
      prev = v.kind;
    });

    const q = ctx.initialUrl.q;
    if (q && !ctx.initialUrl.place && !ctx.initialUrl.route) {
      void runSearch(q).catch(() => open({ kind: 'results', props: { title: q, error: 'החיפוש לא זמין כרגע. בדקו את החיבור לאינטרנט.' } }));
    }
  },
});
