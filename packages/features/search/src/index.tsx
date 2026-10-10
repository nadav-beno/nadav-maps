import { signal, useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { Map as MapLibreMap, LngLatBoundsLike } from 'maplibre-gl';
import {
  distance,
  droppedPin,
  filterOpenNow,
  formatCoords,
  formatDistance,
  matchLocalPlaces,
  mergeSuggestions,
  movedEnough,
  openNowStates,
  OVERTURE_SOURCE,
  parseMapLink,
  type BBox,
  type Camera,
  type LocalFeature,
  type MapLink,
  type Place,
  type WithHours,
} from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  directionsTo,
  ensureLayer,
  Icon,
  PlaceBadge,
  EMPTY,
  load,
  open,
  openPlace,
  save,
  selectedPlace,
  setGeoJSON,
  units,
  userLocation,
  viewStack,
  type ViewProps,
} from '@nm/core/app';
import { CATEGORIES, categoryById, categoryLabel, reverseGeocode, searchNearby, searchPlaces, tools } from '@nm/tools';

let map: MapLibreMap;

const RECENT_KEY = 'search:recent';
const recent = signal<string[]>(load(RECENT_KEY, []));
function remember(q: string) {
  const next = [q, ...recent.value.filter((r) => r !== q)].slice(0, 8);
  recent.value = next;
  save(RECENT_KEY, next);
}

const UNAVAILABLE = 'החיפוש לא זמין כרגע. בדקו את החיבור לאינטרנט.';

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

/** The visible map, clamped to ~20 km around the center (Overpass gets slow on big areas). */
function areaBBox(): BBox {
  const b = map.getBounds();
  const c = map.getCenter();
  const dLat = Math.min((b.getNorth() - b.getSouth()) / 2, 0.09);
  const dLng = Math.min((b.getEast() - b.getWest()) / 2, 0.11);
  return [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat];
}

/** The results source is added once the style is up (onStyle), which re-draws the last results. */
function setResults(data: Parameters<typeof setGeoJSON>[2]) {
  if (map.getSource('search-results')) setGeoJSON(map, 'search-results', data);
}

/** Results on the map: numbered-free dots with names, clickable. */
let lastShown: Place[] = [];
function showResults(places: Place[]) {
  lastShown = places;
  const data = {
    type: 'FeatureCollection' as const,
    features: places.map((p, i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { id: p.id, name: p.name, i },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  };
  setResults(data);
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

// ---------------------------------------------------------------------------
// "Search this area": once a result list is up and the map moves away from it, offer to
// run the same search again for what is on screen now.

const areaPill = signal(false);
let anchor: Camera | null = null;

function camera(): Camera {
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom() };
}

/** Remember where the results were shown (after any fit animation settles). */
function armArea() {
  areaPill.value = false;
  if (map.isMoving()) {
    anchor = null;
    map.once('moveend', () => (anchor = camera()));
  } else {
    anchor = camera();
  }
}

function checkArea() {
  if (currentView.value.kind !== 'results' || !anchor) return;
  const p = currentView.value.props as ResultsProps | undefined;
  if (!p || p.loading || (!p.category && !p.query)) return;
  // Only the part of the map that is not under the sheet / side panel counts.
  const el = map.getCanvas();
  const pad = map.getPadding();
  const width = Math.max(200, (el.clientWidth || 400) - (pad.left ?? 0) - (pad.right ?? 0));
  const height = Math.max(200, (el.clientHeight || 600) - (pad.top ?? 0) - (pad.bottom ?? 0));
  areaPill.value = movedEnough(anchor, camera(), { width, height });
}

function searchArea() {
  const p = currentView.value.props as ResultsProps | undefined;
  areaPill.value = false;
  if (!p) return;
  if (p.category) void runCategory(p.category, { filter: p.filter });
  else if (p.query) void runSearch(p.query, { area: true, filter: p.filter }).catch(() => openError(p.query!, p.filter));
}

// ---------------------------------------------------------------------------
// Businesses from the Overture tiles the map has loaded (Photon only knows OpenStreetMap).

function localMatches(text: string, existing: Place[], limit = 3): Place[] {
  if (!map.getSource(OVERTURE_SOURCE)) return [];
  let features: LocalFeature[];
  try {
    features = map
      .querySourceFeatures(OVERTURE_SOURCE, { sourceLayer: 'place' })
      .filter((f) => f.geometry.type === 'Point')
      .map((f) => {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        return { properties: f.properties ?? {}, lng, lat };
      });
  } catch {
    return [];
  }
  const c = map.getCenter();
  return matchLocalPlaces(features, text, [c.lng, c.lat], existing, limit);
}

// ---------------------------------------------------------------------------

export function focusPlace(p: Place) {
  if (p.extent && (p.category?.key === 'place' || p.category?.key === 'boundary')) {
    const [w, s, e, n] = p.extent;
    map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 15, duration: 700 });
  } else {
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16), duration: 700 });
  }
}

function choose(p: Place) {
  setResults(EMPTY);
  openPlace(p);
  afterPanelChange(() => focusPlace(p));
}

/** Opening a panel re-pads the map on the next frame, which would cut a camera animation short. */
function afterPanelChange(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function openError(title: string, filter?: string) {
  open({ kind: 'results', props: { title, query: title, error: UNAVAILABLE, filter, url: { q: title, filter } } });
}

async function runSearch(q: string, opts: { openView?: boolean; area?: boolean; filter?: string } = {}): Promise<Place[]> {
  remember(q);
  const remote = await tools().call(searchPlaces, { query: q, ...bias(), limit: 15, ...(opts.area ? { bbox: areaBBox() } : {}) });
  const results = mergeSuggestions(remote, localMatches(q, remote), q);
  lastResults = results;
  if (opts.openView !== false) {
    if (results.length === 1 && !opts.area) {
      choose(results[0]);
    } else {
      const filter = opts.filter;
      open({ kind: 'results', props: { title: q, query: q, places: results, filter, url: { q, filter } } });
      showResults(results);
      areaPill.value = false;
      anchor = null;
      afterPanelChange(() => {
        if (!opts.area) fitPlaces(results.slice(0, 8));
        armArea();
      });
    }
  }
  return results;
}

async function runCategory(id: string, opts: { filter?: string } = {}) {
  const cat = categoryById(id);
  if (!cat) return;
  const base = { title: cat.label, category: id, filter: opts.filter, url: { cat: id, filter: opts.filter } };
  areaPill.value = false;
  open({ kind: 'results', props: { ...base, loading: true } });
  try {
    const o = origin();
    const places = (await tools().call(searchNearby, { category: id as never, bbox: areaBBox(), limit: 60 }))
      .sort((a, b2) => distance(o, [a.lng, a.lat]) - distance(o, [b2.lng, b2.lat]))
      .slice(0, 40);
    lastResults = places;
    open({ kind: 'results', props: { ...base, places } }, { replace: true });
    showResults(places);
  } catch (e) {
    open({ kind: 'results', props: { ...base, error: (e as Error).message } }, { replace: true });
  }
  anchor = null;
  afterPanelChange(armArea);
}

/** A link from another map app: fly there and drop a pin, named after the address when we can. */
async function openLink(link: Extract<MapLink, { kind: 'point' }>) {
  const pin = droppedPin(link.lng, link.lat, link.name);
  setResults(EMPTY);
  // Jump rather than fly: the card is re-opened with the address in a moment, and the shell
  // re-pads the map on every panel change, which would stop an animation half-way.
  map.jumpTo({ center: [link.lng, link.lat], zoom: link.zoom ?? Math.max(map.getZoom(), 16) });
  openPlace(pin);
  if (link.name) return;
  try {
    const r = await tools().call(reverseGeocode, { lng: link.lng, lat: link.lat });
    if (r && selectedPlace.value?.id === pin.id) {
      const name = r.category?.key === 'highway' || r.category?.key === 'building' || r.category?.key === 'place' ? r.name : pin.name;
      openPlace({ ...pin, name, address: r.address ?? r.name, countryCode: r.countryCode }, { replace: true });
    }
  } catch {
    /* the coordinates alone are still useful */
  }
}

const SHORT_LINK_HELP = 'פתחו את הקישור בדפדפן, העתיקו את הכתובת המלאה משורת הכתובת והדביקו אותה כאן.';
const UNKNOWN_LINK = 'לא מצאנו מיקום בקישור הזה. נסו להעתיק את הקישור המלא של המקום.';

// ---------------------------------------------------------------------------

function SearchBar() {
  const q = useSignal('');
  const focused = useSignal(false);
  const remote = useSignal<Place[]>([]);
  const local = useSignal<Place[]>([]);
  const link = useSignal<MapLink | null>(null);
  const active = useSignal(-1);
  const loading = useSignal(false);
  const error = useSignal<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const suggestions = mergeSuggestions(remote.value, local.value, q.value);

  const suggest = (text: string) => {
    clearTimeout(timerRef.current);
    abortRef.current?.abort();
    error.value = null;
    active.value = -1;
    link.value = parseMapLink(text);
    if (link.value || text.trim().length < 2) {
      remote.value = [];
      local.value = [];
      loading.value = false;
      return;
    }
    // Businesses already on the map show up at once; the search engine follows.
    local.value = localMatches(text, remote.value);
    loading.value = true;
    timerRef.current = setTimeout(async () => {
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const r = await tools().call(searchPlaces, { query: text, ...bias(), limit: 7 }, { signal: ac.signal });
        remote.value = r;
        local.value = localMatches(text, r);
        active.value = -1;
      } catch {
        if (!ac.signal.aborted) {
          remote.value = [];
          if (!local.value.length) error.value = UNAVAILABLE;
        }
      } finally {
        if (abortRef.current === ac) loading.value = false;
      }
    }, 180);
  };

  const close = () => {
    inputRef.current?.blur();
    focused.value = false;
  };

  const followLink = (l: MapLink) => {
    if (l.kind === 'point') {
      close();
      link.value = null;
      void openLink(l);
    } else if (l.kind === 'query') {
      q.value = l.query;
      link.value = null;
      void submit();
    }
  };

  const submit = async () => {
    const text = q.value.trim();
    if (!text) return;
    const l = parseMapLink(text);
    if (l) {
      followLink(l);
      return;
    }
    if (active.value >= 0 && suggestions[active.value]) {
      pick(suggestions[active.value]);
      return;
    }
    close();
    try {
      const r = await runSearch(text);
      if (!r.length) open({ kind: 'results', props: { title: text, query: text, places: [], url: { q: text } } });
    } catch {
      openError(text);
    }
  };

  const pick = (p: Place) => {
    remember(q.value.trim() || p.name);
    q.value = p.name;
    close();
    choose(p);
  };

  const clear = () => {
    q.value = '';
    remote.value = [];
    local.value = [];
    link.value = null;
    setResults(EMPTY);
    if (viewStack.value.length) viewStack.value = [];
    inputRef.current?.focus();
  };

  const typed = q.value.trim().length >= 2 || !!link.value;
  const showDropdown = focused.value && (suggestions.length > 0 || !!link.value || (!typed && recent.value.length > 0) || !!error.value);

  const isHome = currentView.value.kind === 'home';
  const showBack = focused.value || !isHome;

  return (
    <div class={`search ${focused.value ? 'focused' : ''}`}>
      <form
        class="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {showBack ? (
          <button
            type="button"
            class="icon-btn"
            aria-label="חזרה"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (focused.value) {
                close();
              } else {
                setResults(EMPTY);
                back();
              }
            }}
          >
            <Icon name="arrow_back" />
          </button>
        ) : (
          <span class="search-logo" aria-hidden="true">
            <Icon name="location_on" size={26} />
          </span>
        )}
        <input
          ref={inputRef}
          class="search-input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
          placeholder="חיפוש כאן"
          aria-label="חיפוש מקום או כתובת"
          aria-expanded={showDropdown}
          aria-controls="search-suggestions"
          aria-activedescendant={active.value >= 0 ? `sugg-${active.value}` : undefined}
          value={q.value}
          onInput={(e) => {
            q.value = (e.target as HTMLInputElement).value;
            suggest(q.value);
          }}
          onPaste={(e) => {
            // A pasted map link opens right away; anything else is ordinary typing.
            const pasted = e.clipboardData?.getData('text') ?? '';
            const l = parseMapLink(pasted);
            if (l?.kind === 'point') {
              e.preventDefault();
              q.value = pasted.trim();
              followLink(l);
            }
          }}
          onFocus={() => {
            focused.value = true;
            if (q.value) suggest(q.value);
          }}
          onBlur={() => setTimeout(() => (focused.value = false), 150)}
          onKeyDown={(e) => {
            const n = suggestions.length;
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
        {q.value ? (
          <button type="button" class="icon-btn" aria-label="ניקוי" onMouseDown={(e) => e.preventDefault()} onClick={clear}>
            <Icon name="close" />
          </button>
        ) : (
          <button type="button" class="icon-btn" aria-label="תפריט" onClick={() => open({ kind: 'menu' })}>
            <span class="avatar" aria-hidden="true">
              <Icon name="person" size={20} />
            </span>
          </button>
        )}
      </form>
      {showDropdown && (
        <ul id="search-suggestions" class="suggestions" role="listbox" aria-label="הצעות חיפוש">
          {error.value && <li class="suggestion error">{error.value}</li>}
          {link.value && <LinkRow link={link.value} onFollow={followLink} />}
          {!typed
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
                    <span class="li-icon" aria-hidden="true">
                      <Icon name="history" size={20} />
                    </span>
                    <span class="li-title">{r}</span>
                  </button>
                </li>
              ))
            : suggestions.map((p, i) => (
                <li key={p.id} id={`sugg-${i}`} role="option" aria-selected={i === active.value}>
                  <button
                    class={`suggestion ${i === active.value ? 'active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                  >
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
      {isHome && !focused.value && (
        <div class="chips" role="toolbar" aria-label="חיפוש לפי קטגוריה">
          {CATEGORIES.slice(0, 9).map((c) => (
            <button key={c.id} class="chip" onClick={() => void runCategory(c.id)}>
              <Icon name={c.icon} size={18} />
              {c.label}
            </button>
          ))}
        </div>
      )}
      {currentView.value.kind === 'results' && areaPill.value && !focused.value && (
        <button class="area-pill" onClick={searchArea}>
          <Icon name="search" size={18} />
          חיפוש באזור הזה
        </button>
      )}
    </div>
  );
}

function LinkRow({ link, onFollow }: { link: MapLink; onFollow: (l: MapLink) => void }) {
  if (link.kind === 'short' || link.kind === 'unknown') {
    return (
      <li class="suggestion link-help" role="status">
        <span class="li-icon" aria-hidden="true">
          <Icon name="link" size={20} />
        </span>
        <span class="li-body">
          <span class="li-title">{link.kind === 'short' ? 'קישור מקוצר לא נפתח ישירות' : 'לא מצאנו מיקום בקישור'}</span>
          <span class="li-sub wrap">{link.kind === 'short' ? SHORT_LINK_HELP : UNKNOWN_LINK}</span>
        </span>
      </li>
    );
  }
  const title = link.kind === 'point' ? link.name ?? 'המיקום מהקישור' : `חיפוש: ${link.query}`;
  const sub = link.kind === 'point' ? formatCoords(link.lng, link.lat) : 'מהקישור שהודבק';
  return (
    <li role="option" aria-selected={false}>
      <button class="suggestion" onMouseDown={(e) => e.preventDefault()} onClick={() => onFollow(link)}>
        <span class="li-icon link" aria-hidden="true">
          <Icon name={link.kind === 'point' ? 'location_on' : 'search'} size={20} />
        </span>
        <span class="li-body">
          <span class="li-title">{title}</span>
          <span class="li-sub">{sub}</span>
        </span>
      </button>
    </li>
  );
}

interface ResultsProps {
  title: string;
  /** Text search (absent for a category search). */
  query?: string;
  places?: Place[];
  category?: string;
  /** "open" = only places open now. */
  filter?: string;
  loading?: boolean;
  error?: string;
  url?: Record<string, unknown>;
}

function hiddenNote(n: number): string {
  return n === 1 ? 'תוצאה אחת ללא שעות פתיחה ידועות הוסתרה' : `${n} תוצאות ללא שעות פתיחה ידועות הוסתרו`;
}

function ResultsView({ view }: ViewProps<ResultsProps>) {
  const p = view.props!;
  const o = origin();
  const openOnly = p.filter === 'open';
  const states = useSignal<Map<string, boolean | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    states.value = null;
    const list = (p.places ?? []) as (Place & WithHours)[];
    if (list.some((x) => x.openingHours)) void openNowStates(list).then((s) => !cancelled && (states.value = s));
    else states.value = new Map();
    return () => {
      cancelled = true;
    };
  }, [p.places]);

  const all = p.places ?? [];
  const hasHours = all.some((x) => (x as WithHours).openingHours);
  const filtered = openOnly && states.value ? filterOpenNow(all, states.value) : null;
  const shown = openOnly ? filtered?.places ?? [] : all;

  // The map shows what the list shows.
  useEffect(() => {
    if (currentView.peek().kind === 'results') showResults(shown);
  }, [shown.length, openOnly, states.value, p.places]);

  const toggleOpen = () => {
    const filter = openOnly ? undefined : 'open';
    open({ kind: 'results', props: { ...p, filter, url: { ...p.url, filter } } }, { replace: true });
  };

  return (
    <div class="view">
      <header class="view-header">
        <button
          class="icon-btn"
          aria-label="חזרה"
          onClick={() => {
            setResults(EMPTY);
            back();
          }}
        >
          <Icon name="arrow_back" />
        </button>
        <h2>{p.title}</h2>
      </header>
      {(hasHours || openOnly) && !p.loading && (
        <div class="chips result-filters" role="toolbar" aria-label="סינון תוצאות">
          <button class="chip" aria-pressed={openOnly} onClick={toggleOpen}>
            <Icon name={openOnly ? 'check' : 'schedule'} size={18} />
            פתוח עכשיו
          </button>
        </div>
      )}
      {p.loading && <div class="spinner" role="progressbar" aria-label="טוען" />}
      {p.error && <p class="error">{p.error}</p>}
      {openOnly && !states.value && all.length > 0 && <div class="spinner" role="progressbar" aria-label="טוען" />}
      {p.places && p.places.length === 0 && (
        <div class="muted">
          <p>לא מצאנו תוצאות.</p>
          <p class="small">נסו לכתוב אחרת, להוסיף עיר, או להזיז את המפה לאזור הנכון.</p>
        </div>
      )}
      {filtered && all.length > 0 && filtered.places.length === 0 && (
        <div class="muted">
          <p>אין כאן מקומות שפתוחים עכשיו.</p>
        </div>
      )}
      <ul class="list">
        {shown.map((pl) => {
          const state = states.value?.get(pl.id);
          return (
            <li key={pl.id}>
              <div class="result" role="button" tabIndex={0} onClick={() => choose(pl)} onKeyDown={(e) => e.key === 'Enter' && choose(pl)}>
                <div class="result-body">
                  <div class="result-title">{pl.name}</div>
                  <div class="result-sub">
                    {[categoryLabel(pl.category), formatDistance(distance(o, [pl.lng, pl.lat]), units.value)].filter(Boolean).join(' · ')}
                  </div>
                  {pl.address && <div class="result-sub">{pl.address}</div>}
                  {state != null && <div class={`result-sub ${state ? 'open-now' : 'closed-now'}`}>{state ? 'פתוח' : 'סגור'}</div>}
                  <div class="result-actions">
                    <button
                      class="action"
                      onClick={(e) => {
                        e.stopPropagation();
                        directionsTo(pl);
                      }}
                    >
                      <Icon name="directions" size={18} />
                      מסלול
                    </button>
                  </div>
                </div>
                <PlaceBadge place={pl} size={40} />
              </div>
            </li>
          );
        })}
      </ul>
      {filtered && filtered.unknown > 0 && <p class="muted small hidden-note">{hiddenNote(filtered.unknown)}</p>}
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
      if (currentView.value.kind === 'results') showResults(lastShown);
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

    ctx.map.on('moveend', checkArea);

    // Leaving the results screen clears its markers.
    let prev = currentView.value.kind;
    currentView.subscribe((v) => {
      if (prev === 'results' && v.kind === 'home') setResults(EMPTY);
      if (v.kind === 'results' && prev !== 'results' && prev !== 'place') showResults((v.props?.places as Place[]) ?? []);
      if (v.kind !== 'results') areaPill.value = false;
      prev = v.kind;
    });

    const { q, cat, filter } = ctx.initialUrl;
    if (!ctx.initialUrl.place && !ctx.initialUrl.route) {
      if (cat && categoryById(cat)) void runCategory(cat, { filter });
      else if (q) void runSearch(q, { filter }).catch(() => openError(q, filter));
    }
  },
});
