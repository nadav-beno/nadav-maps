import { signal, useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import {
  distance,
  formatClock,
  formatDistance,
  formatDuration,
  incidentCategory,
  INCIDENT_CATEGORIES,
  INCIDENT_MAGNITUDE,
  TOMTOM_ATTRIBUTION,
  TOMTOM_FLOW_LAYER,
  TOMTOM_INCIDENT_POI_LAYER,
  tomtomFlowTiles,
  tomtomIncidentTiles,
  TRAFFIC_COLORS,
  type LngLat,
} from '@nm/core';
import { back, ICONS, Icon, isDark, load, open, providers, region, save, units, type FeatureContext, type ViewProps } from '@nm/core/app';
import { tools, trafficIncidents, type TrafficIncident } from '@nm/tools';

/**
 * Live traffic from TomTom, drawn in Google's colours under our labels, plus incident icons
 * you can tap. Exists only when a TomTom key is configured; otherwise nothing here runs.
 */
type MapT = FeatureContext['map'];

export const trafficOn = signal<boolean>(load('layers:traffic', false));
trafficOn.subscribe((v) => save('layers:traffic', v));

export const hasTraffic = () => !!providers.peek().tomtomKey;

const FLOW_SRC = 'tomtom-flow';
const INC_SRC = 'tomtom-incidents';
const FLOW_LAYERS = ['traffic-flow', 'traffic-closed'];
const INC_LAYER = 'traffic-incidents';

/** First layer that is a label or one of the app's own overlays (routes, pins): traffic goes under it. */
function beforeOverlays(m: MapT): string | undefined {
  const style = m.getStyle();
  return style?.layers?.find((l) => l.type === 'symbol' || ('source' in l && (style.sources[l.source as string] as { type?: string } | undefined)?.type === 'geojson'))?.id;
}

function incidentSvg(icon: string, color: string): string {
  const d = ICONS[icon] ?? ICONS.warning;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12.5" fill="${color}" stroke="#ffffff" stroke-width="2"/><svg x="6" y="6" width="16" height="16" viewBox="0 -960 960 960"><path d="${d}" fill="#ffffff"/></svg></svg>`;
}

async function addIncidentImages(m: MapT) {
  await Promise.all(
    Object.entries(INCIDENT_CATEGORIES).map(async ([n, c]) => {
      const id = `tt-inc-${n}`;
      if (m.hasImage(id)) return;
      const img = new Image(56, 56);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(incidentSvg(c.icon, c.color))}`;
      try {
        await img.decode();
      } catch {
        return;
      }
      if (!m.hasImage(id)) m.addImage(id, img, { pixelRatio: 2 });
    }),
  );
}

function removeTraffic(m: MapT) {
  for (const id of [...FLOW_LAYERS, INC_LAYER]) if (m.getLayer(id)) m.removeLayer(id);
  for (const id of [FLOW_SRC, INC_SRC]) if (m.getSource(id)) m.removeSource(id);
}

/** Adds (or removes) the traffic sources and layers to match the toggle. Runs after every style change. */
export function syncTraffic(m: MapT) {
  const key = providers.peek().tomtomKey;
  if (!key || !trafficOn.peek()) return removeTraffic(m);
  if (!m.getSource(FLOW_SRC)) {
    m.addSource(FLOW_SRC, { type: 'vector', tiles: [tomtomFlowTiles(key)], minzoom: 6, maxzoom: 18, attribution: TOMTOM_ATTRIBUTION });
  }
  if (!m.getSource(INC_SRC)) {
    m.addSource(INC_SRC, { type: 'vector', tiles: [tomtomIncidentTiles(key)], minzoom: 6, maxzoom: 18, attribution: TOMTOM_ATTRIBUTION });
  }
  const before = beforeOverlays(m);
  const level = ['to-number', ['get', 'traffic_level'], 1];
  // Lines for one direction sit on their side of the road, like Google's two-colour roads.
  const side = ['case', ['!=', ['get', 'traffic_road_coverage'], 'one_side'], 0, ['to-boolean', ['get', 'left_hand_traffic']], -1, 1];
  const width = (k: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 8, 1.2 * k, 12, 2.5 * k, 16, 5 * k, 18, 9 * k];
  const offset = ['interpolate', ['exponential', 1.5], ['zoom'], 8, ['*', side, 0.6], 12, ['*', side, 1.2], 16, ['*', side, 2.4], 18, ['*', side, 4]];
  if (!m.getLayer('traffic-flow')) {
    m.addLayer(
      {
        id: 'traffic-flow',
        type: 'line',
        source: FLOW_SRC,
        'source-layer': TOMTOM_FLOW_LAYER,
        filter: ['!', ['to-boolean', ['get', 'road_closure']]] as never,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['step', level, TRAFFIC_COLORS.jam, 0.25, TRAFFIC_COLORS.slow, 0.5, TRAFFIC_COLORS.medium, 0.75, TRAFFIC_COLORS.fast] as never,
          'line-width': width(1) as never,
          'line-offset': offset as never,
          'line-opacity': isDark.peek() ? 0.85 : 0.95,
        },
      },
      before,
    );
  }
  if (!m.getLayer('traffic-closed')) {
    m.addLayer(
      {
        id: 'traffic-closed',
        type: 'line',
        source: FLOW_SRC,
        'source-layer': TOMTOM_FLOW_LAYER,
        filter: ['to-boolean', ['get', 'road_closure']] as never,
        paint: { 'line-color': TRAFFIC_COLORS.closed, 'line-width': width(1) as never, 'line-dasharray': [1, 1] },
      },
      before,
    );
  }
  void addIncidentImages(m).then(() => {
    if (m.getLayer(INC_LAYER) || !m.getSource(INC_SRC)) return;
    m.addLayer({
      id: INC_LAYER,
      type: 'symbol',
      source: INC_SRC,
      'source-layer': TOMTOM_INCIDENT_POI_LAYER,
      minzoom: 9,
      layout: {
        'icon-image': ['concat', 'tt-inc-', ['to-string', ['coalesce', ['get', 'icon_category'], ['get', 'icon_category_0'], 0]]] as never,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 1] as never,
        'icon-allow-overlap': true,
        'icon-padding': 0,
        'symbol-sort-key': ['-', 0, ['to-number', ['get', 'magnitude'], 0]] as never,
      },
    });
  });
}

/** What the incident's map tile told us; the details screen fetches more (from/to, roads, end). */
type IncidentProps = {
  category: number;
  description?: string;
  delayS?: number;
  magnitude?: number;
  at: LngLat;
};

export function onTrafficClick(m: MapT, features: { layer: { id: string }; properties: Record<string, unknown>; geometry: { type: string; coordinates?: unknown } }[]): boolean | void {
  const f = features.find((x) => x.layer.id === INC_LAYER);
  if (!f) return;
  const p = f.properties;
  const at = (f.geometry.type === 'Point' ? f.geometry.coordinates : undefined) as LngLat | undefined;
  if (!at) return;
  if (p.clustered === true || p.clustered === 'true') {
    m.easeTo({ center: at, zoom: m.getZoom() + 2 });
    return true;
  }
  const props: IncidentProps = {
    category: Number(p.icon_category ?? p.icon_category_0 ?? 0),
    description: (p.description ?? p.description_0) as string | undefined,
    delayS: p.delay !== undefined ? Number(p.delay) : undefined,
    magnitude: p.magnitude !== undefined ? Number(p.magnitude) : undefined,
    at,
  };
  open({ kind: 'traffic-incident', props });
  return true;
}

export function TrafficIncidentView({ view }: ViewProps<IncidentProps>) {
  const p = view.props!;
  const cat = incidentCategory(p.category);
  const details = useSignal<TrafficIncident | null>(null);
  const loading = useSignal(true);
  useEffect(() => {
    const ac = new AbortController();
    const d = 0.004;
    const bbox: [number, number, number, number] = [p.at[0] - d, p.at[1] - d, p.at[0] + d, p.at[1] + d];
    tools()
      .call(trafficIncidents, { bbox, limit: 20 }, { signal: ac.signal })
      .then((list) => {
        const near = list.filter((x) => x.type === cat.id).sort((a, b) => distance(a.point, p.at) - distance(b.point, p.at))[0] ?? null;
        details.value = near;
      })
      .catch(() => {})
      .finally(() => (loading.value = false));
    return () => ac.abort();
  }, [p.at[0], p.at[1]]);
  const x = details.value;
  const delay = x?.delayS ?? p.delayS;
  const magnitude = x?.magnitude ?? p.magnitude;
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <span class="traffic-badge" style={{ background: cat.color }}>
          <Icon name={cat.icon} size={20} />
        </span>
        <h2>{cat.label}</h2>
      </header>
      <div class="traffic-incident">
        {(x?.description || p.description) && <p>{x?.description || p.description}</p>}
        {x && (x.from || x.to) && (
          <p class="muted">
            {x.roads.length ? `כביש ${x.roads.join(', ')} · ` : ''}
            {x.from && x.to ? `מ${x.from} עד ${x.to}` : x.from || x.to}
          </p>
        )}
        <ul class="traffic-facts">
          {delay ? <li>עיכוב: {formatDuration(delay)}</li> : magnitude !== undefined && magnitude > 0 ? <li>{INCIDENT_MAGNITUDE[magnitude]}</li> : null}
          {x?.lengthM ? <li>אורך: {formatDistance(x.lengthM, units.value)}</li> : null}
          {x?.end ? <li>צפוי להסתיים ב-{formatClock(x.end, region.value.timeZone)}</li> : null}
        </ul>
        {loading.value && <div class="spinner" role="progressbar" aria-label="טוען פרטים" />}
        <p class="muted small">מידע על תנועה: TomTom</p>
      </div>
    </div>
  );
}

/** The toggle in the layers screen (only rendered when a key exists). */
export function TrafficToggle({ onToggle }: { onToggle: () => void }) {
  return (
    <button class="layer-opt" aria-pressed={trafficOn.value} onClick={onToggle}>
      <span class="layer-thumb thumb-traffic" />
      תנועה
    </button>
  );
}
