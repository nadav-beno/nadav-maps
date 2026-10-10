import { signal } from '@preact/signals';
import { back, defineFeature, Icon, mapLayers, mapType, open, region, type FeatureContext, type MapLayers, type MapTypePref, type ViewProps } from '@nm/core/app';
import { hasTraffic, onTrafficClick, syncTraffic, TrafficIncidentView, trafficOn, TrafficToggle } from './traffic.tsx';

let map: FeatureContext['map'];
const bearing = signal(0);
const pitch = signal(0);

const TYPES: { id: MapTypePref; label: string }[] = [
  { id: 'default', label: 'ברירת מחדל' },
  { id: 'satellite', label: 'לוויין' },
  { id: 'terrain', label: 'פני שטח' },
];

const DETAILS: { id: keyof MapLayers; label: string; thumb: string }[] = [
  { id: 'transit', label: 'תחבורה ציבורית', thumb: 'transit' },
  { id: 'bike', label: 'רכיבה על אופניים', thumb: 'bike' },
  { id: 'buildings3d', label: 'תלת־ממד', thumb: '3d' },
];

function toggle(id: keyof MapLayers) {
  const on = !mapLayers.value[id];
  mapLayers.value = { ...mapLayers.value, [id]: on };
  // Like Google: turning 3D on tilts the map, turning it off flattens it.
  if (id === 'buildings3d') map.easeTo({ pitch: on ? 55 : 0, zoom: on ? Math.max(map.getZoom(), 16) : map.getZoom(), duration: 600 });
}

function LayersView(_: ViewProps) {
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>שכבות</h2>
      </header>
      <h3 class="section-title">סוג מפה</h3>
      <div class="layer-grid" role="radiogroup" aria-label="סוג מפה">
        {TYPES.map((t) => (
          <button key={t.id} class="layer-opt" role="radio" aria-checked={mapType.value === t.id} aria-pressed={mapType.value === t.id} onClick={() => (mapType.value = t.id)}>
            <span class={`layer-thumb thumb-${t.id}`} />
            {t.label}
          </button>
        ))}
      </div>
      <h3 class="section-title">פרטי מפה</h3>
      <div class="layer-grid">
        {DETAILS.map((d) => (
          <button key={d.id} class="layer-opt" aria-pressed={mapLayers.value[d.id]} onClick={() => toggle(d.id)}>
            <span class={`layer-thumb thumb-${d.thumb}`} />
            {d.label}
          </button>
        ))}
        {hasTraffic() && (
          <TrafficToggle
            onToggle={() => {
              trafficOn.value = !trafficOn.value;
              syncTraffic(map);
            }}
          />
        )}
      </div>
      {hasTraffic() && trafficOn.value && (
        <p class="muted small">
          תנועה בזמן אמת מ-TomTom: ירוק זורם, כתום ואדום איטי, אדום כהה פקק. הקישו על סמל של אירוע לפרטים.
          {region.value.bbox && !region.value.coverage.traffic && ` ל-TomTom אין עדיין נתוני תנועה בזמן אמת ב${region.value.name}, אז ייתכן שלא יופיע כאן כלום.`}
        </p>
      )}
      {mapType.value === 'satellite' && (
        <p class="muted small">
          תצלומי לוויין Sentinel-2 (רזולוציה של 10 מטר לפיקסל): מתאימים למבט על אזורים, לא לזיהוי בתים. תצלומים מפורטים יותר דורשים רישיון בתשלום.
        </p>
      )}
      {mapType.value === 'terrain' && <p class="muted small">הצללת תבליט וקווי גובה כל 10 עד 100 מטר, לפי רמת הזום.</p>}
    </div>
  );
}

function LayersButton() {
  return (
    <button class="ctrl" aria-label="שכבות" title="שכבות" onClick={() => open({ kind: 'layers' })}>
      <Icon name="layers" size={22} />
    </button>
  );
}

/** Appears when the map is rotated or tilted; tap to face north and flatten, like Google. */
function Compass() {
  if (Math.abs(bearing.value) < 1 && pitch.value < 1) return null;
  return (
    <button class="ctrl" aria-label="צפון למעלה" title="צפון למעלה" onClick={() => map.easeTo({ bearing: 0, pitch: 0, duration: 500 })}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-bearing.value}deg)` }}>
        <path d="M12 2 7.5 12h9z" fill="#ea4335" />
        <path d="M12 22 7.5 12h9z" fill="currentColor" />
      </svg>
    </button>
  );
}

export default defineFeature({
  id: 'layers',
  title: 'שכבות',
  description: 'סוג מפה (לוויין, פני שטח) ושכבות: תחבורה ציבורית, אופניים, תלת־ממד ותנועה',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('layers', LayersView);
    ctx.registerSlot('controls', LayersButton, 0);
    ctx.registerSlot('controls', Compass, 10);
    if (hasTraffic()) {
      ctx.registerView('traffic-incident', TrafficIncidentView);
      ctx.onStyle(syncTraffic);
      ctx.onMapClick((_e, features) => onTrafficClick(ctx.map, features as never), 60);
    }
    const sync = () => {
      bearing.value = ctx.map.getBearing();
      pitch.value = ctx.map.getPitch();
    };
    ctx.map.on('rotate', sync);
    ctx.map.on('pitch', sync);
    sync();
    if (ctx.initialUrl.panel === 'layers') open({ kind: 'layers' });
  },
});
