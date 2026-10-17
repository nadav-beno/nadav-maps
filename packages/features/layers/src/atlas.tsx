import { signal } from '@preact/signals';
import {
  ATLAS_FLOW_LAYER,
  ATLAS_MAXZOOM,
  ATLAS_MINZOOM,
  ATLAS_POLL_MS,
  ATLAS_SPEED_BANDS,
  atlasCovers,
  atlasFlowTiles,
  atlasRetryDelay,
  atlasStatusUrl,
  atlasUsable,
  formatClock,
  parseAtlasStatus,
  type AtlasStatus,
  type BBox,
} from '@nm/core';
import { isDark, providers, type FeatureContext } from '@nm/core/app';

/**
 * Atlas, Nadav's own traffic service: measured speeds in km/h as vector tiles (Hong Kong today).
 * We read its public status about once a minute while the traffic layer is on and the page is
 * visible, and draw the tiles only from a fresh, healthy snapshot, only where its coverage is on
 * screen. Inside Atlas coverage it replaces HERE/TomTom flow, our own data first.
 */
type MapT = FeatureContext['map'];

export type AtlasState =
  | { kind: 'loading' }
  | { kind: 'ok'; status: AtlasStatus }
  | { kind: 'stale'; status: AtlasStatus }
  | { kind: 'unavailable' }
  /** The key or our origin was refused (401/403): retrying won't help, so we stop. */
  | { kind: 'denied' };

export const atlasState = signal<AtlasState>({ kind: 'loading' });
/** Atlas coverage is on screen (only meaningful while the status is ok). */
export const atlasInView = signal(false);

export const atlasConfigured = () => !!(providers.peek().atlasKey && providers.peek().atlasUrl);

const SRC = 'atlas-flow';
export const ATLAS_LAYER = 'atlas-flow';

let resync: () => void = () => {};
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: AbortController | undefined;
let attempt = 0;
/** After a 429 on tiles, Atlas stays off until then (no retry storm). */
let tilesBlockedUntil = 0;
let tileVersion: string | null = null;

function schedule(ms: number) {
  clearTimeout(timer);
  if (running && document.visibilityState === 'visible') timer = setTimeout(() => void readStatus(), ms);
}

function setState(s: AtlasState) {
  const prev = atlasState.peek();
  atlasState.value = s;
  const version = (x: AtlasState) => ('status' in x ? `${x.kind}:${x.status.tilesVersion}` : x.kind);
  if (version(prev) !== version(s)) resync();
}

async function readStatus() {
  if (!running || atlasState.peek().kind === 'denied') return;
  inflight?.abort();
  const ac = (inflight = new AbortController());
  const timeout = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch(atlasStatusUrl(providers.peek().atlasUrl), { credentials: 'omit', signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      setState({ kind: 'unavailable' });
      return schedule(res.status === 429 || res.status >= 500 ? atlasRetryDelay(attempt++, res.headers.get('Retry-After')) : ATLAS_POLL_MS);
    }
    const s = parseAtlasStatus(await res.json());
    attempt = 0;
    setState(atlasUsable(s) ? { kind: 'ok', status: s } : s && (s.stale || s.sourceStatus === 'stale') ? { kind: 'stale', status: s } : { kind: 'unavailable' });
    schedule(ATLAS_POLL_MS);
  } catch {
    // Aborted because the page was hidden or traffic turned off: nothing to report.
    if (!running || document.visibilityState !== 'visible') return;
    setState({ kind: 'unavailable' });
    schedule(atlasRetryDelay(attempt++, null));
  } finally {
    clearTimeout(timeout);
    if (inflight === ac) inflight = undefined;
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible') void readStatus();
  else {
    clearTimeout(timer);
    inflight?.abort();
  }
}

/** Starts or stops reading Atlas status (with the traffic toggle). */
export function setAtlasRunning(on: boolean) {
  if (on === running || !atlasConfigured()) return;
  running = on;
  if (on) {
    document.addEventListener('visibilitychange', onVisibility);
    void readStatus();
  } else {
    document.removeEventListener('visibilitychange', onVisibility);
    clearTimeout(timer);
    inflight?.abort();
  }
}

/** Wires Atlas to the map: `sync` re-adds all traffic layers (it calls syncAtlas). */
export function initAtlas(m: MapT, sync: () => void) {
  resync = () => {
    try {
      sync();
    } catch {
      /* style still loading: onStyle will add the layers */
    }
  };
  // Coverage coming into view or leaving it switches provider; otherwise panning changes nothing.
  m.on('moveend', () => {
    const s = atlasState.peek();
    if (s.kind === 'ok' && viewCovered(m, s.status) !== atlasInView.peek()) resync();
  });
  m.on('error', (ev) => {
    const e = ev as unknown as { sourceId?: string; error?: { status?: number } };
    if (e.sourceId !== SRC) return;
    const status = e.error?.status;
    if (status === 401 || status === 403) {
      running = false;
      clearTimeout(timer);
      setState({ kind: 'denied' });
    } else if (status === 429 || (status && status >= 500)) {
      if (Date.now() < tilesBlockedUntil) return;
      const wait = atlasRetryDelay(attempt++, null);
      tilesBlockedUntil = Date.now() + wait;
      resync();
      setTimeout(resync, wait + 50);
    } else if (status === 404 || status === 410) {
      // An old snapshot version: ask for the current one.
      void readStatus();
    }
  });
}

function viewCovered(m: MapT, s: AtlasStatus): boolean {
  const b = m.getBounds();
  const view: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  return atlasCovers(s, view);
}

const escape = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function attributionHtml(s: AtlasStatus): string {
  const terms = s.termsUrl ? ` <a href="${escape(s.termsUrl)}" target="_blank" rel="noopener noreferrer">תנאי שימוש</a>` : '';
  return `Atlas: ${escape(s.attribution)}${terms}`;
}

export function removeAtlas(m: MapT) {
  if (m.getLayer(ATLAS_LAYER)) m.removeLayer(ATLAS_LAYER);
  if (m.getSource(SRC)) m.removeSource(SRC);
  tileVersion = null;
}

const width = ['interpolate', ['exponential', 1.5], ['zoom'], 8, 1.2, 12, 2.5, 16, 5, 18, 9];

/**
 * Adds, updates or removes the Atlas layer. Returns true when Atlas is drawing, so the caller
 * leaves HERE/TomTom flow off there.
 */
export function syncAtlas(m: MapT, on: boolean, before: string | undefined): boolean {
  const st = atlasState.peek();
  const status = st.kind === 'ok' && atlasUsable(st.status) ? st.status : null;
  atlasInView.value = !!status && viewCovered(m, status);
  if (!on || !status || !atlasInView.peek() || Date.now() < tilesBlockedUntil) {
    removeAtlas(m);
    return false;
  }
  const { atlasUrl, atlasKey } = providers.peek();
  const tiles = [atlasFlowTiles(atlasUrl, atlasKey, status.tilesVersion)];
  const src = m.getSource(SRC) as { setTiles?: (t: string[]) => unknown } | undefined;
  if (!src) {
    m.addSource(SRC, {
      type: 'vector',
      tiles,
      minzoom: ATLAS_MINZOOM,
      maxzoom: ATLAS_MAXZOOM,
      bounds: status.coverage.bbox,
      attribution: attributionHtml(status),
    });
  } else if (tileVersion !== status.tilesVersion) {
    // A new snapshot: same source, new template (the version is part of the tile URL).
    src.setTiles?.(tiles);
  }
  tileVersion = status.tilesVersion;
  if (!m.getLayer(ATLAS_LAYER)) {
    const speed = ['to-number', ['get', 'speed_kph'], 0];
    const color = ['step', speed, ATLAS_SPEED_BANDS[0].color, ...ATLAS_SPEED_BANDS.slice(1).flatMap((b) => [b.from, b.color])];
    m.addLayer(
      {
        id: ATLAS_LAYER,
        type: 'line',
        source: SRC,
        'source-layer': ATLAS_FLOW_LAYER,
        // Cached tiles from an older snapshot may say stale: never show those as current.
        filter: ['==', ['get', 'stale'], false] as never,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color as never, 'line-width': width as never, 'line-opacity': isDark.peek() ? 0.85 : 0.95 },
      },
      before,
    );
  }
  return true;
}

const clock = (epochS: number | null) => (epochS ? formatClock(new Date(epochS * 1000).toISOString()) : '');

/** Atlas state and legend in the layers screen. */
export function AtlasNote() {
  const s = atlasState.value;
  if (s.kind === 'loading') return <p class="muted small atlas-note">בודק את Atlas…</p>;
  if (s.kind === 'denied') return <p class="muted small atlas-note">Atlas דחה את הבקשה (המפתח או האתר לא מורשים), ולכן הוא כבוי.</p>;
  if (s.kind === 'unavailable') return <p class="muted small atlas-note">Atlas לא זמין כרגע, ולכן הנתונים שלו לא מוצגים.</p>;
  if (s.kind === 'stale') {
    const at = clock(s.status.observedAt);
    return <p class="muted small atlas-note">הנתונים של Atlas לא עדכניים{at ? ` (המדידה האחרונה ב-${at})` : ''}, ולכן הם מוסתרים.</p>;
  }
  if (!atlasInView.value) return <p class="muted small atlas-note">אין כיסוי של Atlas באזור הזה</p>;
  return (
    <div class="atlas-note">
      <p class="muted small">
        Atlas: מהירות נמדדת בקמ״ש{s.status.observedAt ? ` · נמדד ב-${clock(s.status.observedAt)}` : ''}
      </p>
      <ul class="atlas-legend" aria-label="מהירות נמדדת בקמ״ש">
        {ATLAS_SPEED_BANDS.map((b, i) => {
          const next = ATLAS_SPEED_BANDS[i + 1];
          return (
            <li key={b.from}>
              <span class="atlas-swatch" style={{ background: b.color }} />
              {next ? `${b.from}–${next.from}` : `${b.from}+`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
