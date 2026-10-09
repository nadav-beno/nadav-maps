import { computed, signal, useSignal } from '@preact/signals';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { back, currentView, defineFeature, ensureLayer, EMPTY, load, open, save, setGeoJSON, toast, type ViewProps } from '@nm/core/app';
import { importFiles } from './import.ts';
import { loadAll, loaded, photos, put, remove, removeAll, type PhotoRec } from './store.ts';
import { groupTrips } from './trips.ts';

let map: MapLibreMap;
const showOnMap = signal<boolean>(load('photos:showOnMap', false));
showOnMap.subscribe((v) => save('photos:showOnMap', v));
const year = signal<number | null>(null);
const viewer = signal<PhotoRec | null>(null);
const placing = signal<PhotoRec | null>(null);
const progress = signal<{ done: number; total: number } | null>(null);

const visible = computed(() => {
  const y = year.value;
  return photos.value.filter((p) => p.lng !== null && (y === null || (p.takenAt !== null && new Date(p.takenAt).getFullYear() === y)));
});
const years = computed(() => {
  const s = new Set<number>();
  for (const p of photos.value) if (p.takenAt) s.add(new Date(p.takenAt).getFullYear());
  return [...s].sort((a, b) => b - a);
});

const urls = new Map<string, string>();
function thumbUrl(p: PhotoRec): string | null {
  if (!p.thumb) return null;
  let u = urls.get(p.id);
  if (!u) {
    u = URL.createObjectURL(p.thumb);
    urls.set(p.id, u);
  }
  return u;
}

const fmtDate = (t: number | null) => (t ? new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(t) : 'תאריך לא ידוע');

function mapActive(): boolean {
  return showOnMap.value || currentView.value.kind === 'photos';
}

function draw() {
  if (!map?.getSource('photos')) return;
  const on = mapActive();
  setGeoJSON(map, 'photos', on
    ? { type: 'FeatureCollection', features: visible.value.map((p) => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.lng!, p.lat!] } })) }
    : EMPTY);
  updateMarkers();
}

// Thumbnails for unclustered photos in view, as HTML markers (cheap up to ~100).
const markers = new Map<string, maplibregl.Marker>();
function updateMarkers() {
  if (!map) return;
  const keep = new Set<string>();
  if (mapActive() && map.getLayer('photos-point')) {
    const feats = map.queryRenderedFeatures({ layers: ['photos-point'] }).slice(0, 100);
    const byId = new Map(photos.value.map((p) => [p.id, p]));
    for (const f of feats) {
      const id = String(f.properties.id);
      const p = byId.get(id);
      if (!p) continue;
      keep.add(id);
      if (markers.has(id)) continue;
      const el = document.createElement('button');
      el.className = 'photo-marker';
      el.setAttribute('aria-label', `תמונה מ-${fmtDate(p.takenAt)}`);
      const u = thumbUrl(p);
      if (u) el.style.backgroundImage = `url("${u}")`;
      else el.textContent = '📷';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        viewer.value = p;
      });
      markers.set(id, new maplibregl.Marker({ element: el }).setLngLat([p.lng!, p.lat!]).addTo(map));
    }
  }
  for (const [id, m] of markers) {
    if (!keep.has(id)) {
      m.remove();
      markers.delete(id);
    }
  }
}

async function onFiles(files: FileList | null) {
  if (!files?.length) return;
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  progress.value = { done: 0, total: list.length };
  const recs = await importFiles(list, (done) => (progress.value = { done, total: list.length }));
  await put(recs);
  progress.value = null;
  const withGps = recs.filter((r) => r.lng !== null).length;
  toast(`נוספו ${recs.length} תמונות, ${withGps} עם מיקום`);
  if (withGps) fit(recs.filter((r) => r.lng !== null));
}

function fit(list: PhotoRec[]) {
  if (!list.length) return;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of list) {
    w = Math.min(w, p.lng!); e = Math.max(e, p.lng!); s = Math.min(s, p.lat!); n = Math.max(n, p.lat!);
  }
  map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 15, duration: 800 });
}

function PhotosView(_: ViewProps) {
  const tab = useSignal<'trips' | 'nogps'>('trips');
  const all = photos.value;
  const noGps = all.filter((p) => p.lng === null);
  const trips = groupTrips(year.value === null ? all : visible.value);
  return (
    <div class="view photos">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          →
        </button>
        <h2>מפת התמונות שלי</h2>
      </header>
      <p class="muted small">התמונות נשארות במכשיר שלך. שומרים רק תמונה מוקטנת, תאריך ומיקום, ושום דבר לא עולה לשרת.</p>
      <input
        id="photo-input"
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        class="visually-hidden"
        onChange={(e) => {
          void onFiles((e.target as HTMLInputElement).files);
          (e.target as HTMLInputElement).value = '';
        }}
      />
      <label for="photo-input" class="btn primary full">
        📷 הוספת תמונות
      </label>
      <p class="muted small">באייפון: בבחירת התמונות לחצו על "אפשרויות" למעלה והפעילו "מיקום", אחרת האייפון מוחק את המיקום מהתמונות.</p>
      {progress.value && (
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.value.total} aria-valuenow={progress.value.done}>
          <div class="progress-bar" style={{ width: `${(100 * progress.value.done) / progress.value.total}%` }} />
          <span class="small">
            מעבד {progress.value.done} מתוך {progress.value.total}
          </span>
        </div>
      )}
      {!loaded.value && <div class="spinner" />}
      {loaded.value && all.length > 0 && (
        <>
          <p class="stats">
            {all.length} תמונות · {all.length - noGps.length} על המפה · {groupTrips(all).length} טיולים
          </p>
          <label class="toggle-row">
            <input type="checkbox" checked={showOnMap.value} onChange={(e) => (showOnMap.value = (e.target as HTMLInputElement).checked)} /> להציג את התמונות במפה גם כשהמסך הזה סגור
          </label>
          {years.value.length > 1 && (
            <div class="chips" role="group" aria-label="סינון לפי שנה">
              <button class="chip" aria-pressed={year.value === null} onClick={() => (year.value = null)}>
                הכל
              </button>
              {years.value.map((y) => (
                <button key={y} class="chip" aria-pressed={year.value === y} onClick={() => (year.value = y)}>
                  {y}
                </button>
              ))}
            </div>
          )}
          <div class="segmented" role="tablist">
            <button role="tab" aria-pressed={tab.value === 'trips'} onClick={() => (tab.value = 'trips')}>
              טיולים
            </button>
            <button role="tab" aria-pressed={tab.value === 'nogps'} onClick={() => (tab.value = 'nogps')}>
              בלי מיקום ({noGps.length})
            </button>
          </div>
          {tab.value === 'trips' && (
            <ul class="list">
              {trips.length === 0 && <li class="muted small">טיול נוצר אוטומטית מ-3 תמונות ומעלה שצולמו ברצף.</li>}
              {trips.map((t) => (
                <li key={t.id}>
                  <button class="list-item" onClick={() => fit(t.photos)}>
                    <span class="li-thumb" style={thumbUrl(t.photos[0]) ? { backgroundImage: `url("${thumbUrl(t.photos[0])}")` } : undefined} aria-hidden="true" />
                    <span class="li-body">
                      <div class="li-title">{fmtDate(t.start)}</div>
                      <div class="li-sub">
                        {t.photos.length} תמונות
                        {t.end - t.start > 86400000 ? ` · ${Math.round((t.end - t.start) / 86400000) + 1} ימים` : ''}
                      </div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tab.value === 'nogps' && (
            <ul class="thumb-grid">
              {noGps.map((p) => (
                <li key={p.id}>
                  <button
                    class="thumb"
                    style={thumbUrl(p) ? { backgroundImage: `url("${thumbUrl(p)}")` } : undefined}
                    aria-label={`שיבוץ ${p.name} במפה`}
                    onClick={() => {
                      placing.value = p;
                      toast('לחצו על המפה במקום שבו צולמה התמונה', { label: 'ביטול', run: () => (placing.value = null) }, 10000);
                    }}
                  >
                    {!p.thumb && '📷'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            class="btn danger small"
            onClick={() => {
              if (confirm('למחוק את כל התמונות ממפת התמונות? (התמונות המקוריות במכשיר לא נמחקות)')) void removeAll().then(draw);
            }}
          >
            ניקוי מפת התמונות
          </button>
        </>
      )}
    </div>
  );
}

function Viewer() {
  const p = viewer.value;
  if (!p) return null;
  const u = thumbUrl(p);
  return (
    <div class="lightbox" role="dialog" aria-label="תמונה" onClick={() => (viewer.value = null)}>
      <figure onClick={(e) => e.stopPropagation()}>
        {u ? <img src={u} alt={p.name} /> : <div class="thumb big">📷</div>}
        <figcaption>
          <div>{fmtDate(p.takenAt)}</div>
          <div class="muted small">{p.name}</div>
          <div class="lightbox-actions">
            <button
              class="btn small danger"
              onClick={() => {
                void remove(p.id).then(draw);
                viewer.value = null;
              }}
            >
              הסרה מהמפה
            </button>
            <button class="btn small" onClick={() => (viewer.value = null)}>
              סגירה
            </button>
          </div>
        </figcaption>
      </figure>
    </div>
  );
}

export default defineFeature({
  id: 'photos',
  title: 'מפת התמונות',
  description: 'תמונות מהאייפון על המפה, לפי המיקום שבו צולמו. נשאר רק במכשיר.',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('photos', PhotosView);
    ctx.registerSlot('overlay', Viewer, 20);
    ctx.registerMenuItem({ id: 'photos', label: 'מפת התמונות שלי', icon: '🖼️', order: 20, run: () => open({ kind: 'photos' }) });

    ctx.onStyle((m) => {
      setGeoJSON(m, 'photos', EMPTY, { cluster: true, clusterRadius: 50, clusterMaxZoom: 16 });
      ensureLayer(m, {
        id: 'photos-cluster',
        type: 'circle',
        source: 'photos',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#a142f4',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26, 200, 32],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      }, null);
      ensureLayer(m, {
        id: 'photos-count',
        type: 'symbol',
        source: 'photos',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' },
      }, null);
      ensureLayer(m, {
        id: 'photos-point',
        type: 'circle',
        source: 'photos',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': 4, 'circle-color': '#a142f4', 'circle-opacity': 0.01 },
      }, null);
      draw();
    });

    ctx.map.on('moveend', updateMarkers);
    ctx.map.on('sourcedata', (e) => {
      if (e.sourceId === 'photos' && e.isSourceLoaded) updateMarkers();
    });
    visible.subscribe(() => draw());
    showOnMap.subscribe(() => draw());
    let prev = currentView.value.kind;
    currentView.subscribe((v) => {
      if ((v.kind === 'photos') !== (prev === 'photos')) draw();
      prev = v.kind;
    });

    // Zoom into a cluster on tap.
    ctx.onMapClick((e, features) => {
      if (placing.value) {
        const p = placing.value;
        placing.value = null;
        void put([{ ...p, lng: e.lngLat.lng, lat: e.lngLat.lat }]).then(() => toast('התמונה שובצה במפה'));
        return true;
      }
      const c = features.find((f) => f.layer.id === 'photos-cluster');
      if (!c) return;
      const src = ctx.map.getSource('photos') as maplibregl.GeoJSONSource;
      void src.getClusterExpansionZoom(c.properties.cluster_id as number).then((z) =>
        ctx.map.easeTo({ center: (c.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: z + 0.5 }),
      );
      return true;
    }, 200);

    void loadAll().then(draw);
    if (ctx.initialUrl.panel === 'photos') open({ kind: 'photos' });
  },
});
