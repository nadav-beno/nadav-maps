import { useSignal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { distance, formatDistance, type Place } from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  directionsTo,
  ensureLayer,
  EMPTY,
  open,
  openPlace,
  selectedPlace,
  setGeoJSON,
  toast,
  units,
  userLocation,
  type ViewProps,
} from '@nm/core/app';
import { categoryLabel, placeIcon } from '@nm/tools';
import {
  addHistory,
  clearHistory,
  createList,
  data,
  decodeList,
  deleteList,
  encodeList,
  fromGeoJSON,
  listsContaining,
  renameList,
  restoreList,
  savedIds,
  setHomeWork,
  toGeoJSON,
  toggleInList,
  type SavedList,
  type SavedPlace,
} from './store.ts';

let map: MapLibreMap;

function PlaceRow({ p, onRemove }: { p: Place; onRemove?: () => void }) {
  const u = userLocation.value;
  return (
    <li class="row-with-action">
      <button
        class="list-item"
        onClick={() => {
          map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16) });
          openPlace(p);
        }}
      >
        <span class="li-icon" aria-hidden="true">{placeIcon(p)}</span>
        <span class="li-body">
          <div class="li-title">{p.name}</div>
          <div class="li-sub">{[categoryLabel(p.category), p.address].filter(Boolean).join(' · ')}</div>
        </span>
        {u && <span class="li-end">{formatDistance(distance([u.lng, u.lat], [p.lng, p.lat]), units.value)}</span>}
      </button>
      {onRemove && (
        <button class="icon-btn" aria-label={`הסרת ${p.name}`} onClick={onRemove}>
          🗑
        </button>
      )}
    </li>
  );
}

// ----- "Save" on the place card -----
function SaveAction({ place }: { place: Place }) {
  const saved = savedIds.value.has(place.id);
  return (
    <button class={`action ${saved ? 'primary' : ''}`} aria-pressed={saved} onClick={() => open({ kind: 'save-to', props: { place } })}>
      <span class="circle" aria-hidden="true">{saved ? '★' : '☆'}</span>
      {saved ? 'נשמר' : 'שמירה'}
    </button>
  );
}

function SaveToView({ view }: ViewProps<{ place: Place }>) {
  const place = view.props!.place;
  const newName = useSignal('');
  const inLists = listsContaining(place.id);
  void data.value; // re-render on change
  const d = data.value;
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          →
        </button>
        <h2>שמירה ברשימה</h2>
      </header>
      <p class="muted small">{place.name}</p>
      <ul class="list">
        {d.lists.map((l) => (
          <li key={l.id}>
            <label class="list-item checkable">
              <input type="checkbox" checked={inLists.includes(l.id)} onChange={() => toggleInList(l.id, place)} />
              <span class="li-icon" aria-hidden="true">{l.icon}</span>
              <span class="li-body">
                <div class="li-title">{l.name}</div>
                <div class="li-sub">{l.places.length} מקומות</div>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.value.trim()) return;
          const l = createList(newName.value);
          toggleInList(l.id, place);
          newName.value = '';
        }}
      >
        <input class="input" placeholder="רשימה חדשה" aria-label="שם לרשימה חדשה" value={newName.value} onInput={(e) => (newName.value = (e.target as HTMLInputElement).value)} />
        <button class="btn" type="submit">
          הוספה
        </button>
      </form>
      <div class="home-work-set">
        <button class="btn small" onClick={() => { setHomeWork('home', place); toast('נשמר כבית'); }}>
          🏠 הגדרה כבית
        </button>
        <button class="btn small" onClick={() => { setHomeWork('work', place); toast('נשמר כעבודה'); }}>
          💼 הגדרה כעבודה
        </button>
      </div>
      <button class="btn primary full" onClick={back}>
        סיום
      </button>
    </div>
  );
}

// ----- home screen shortcuts -----
function HomeShortcuts() {
  const d = data.value;
  const go = (which: 'home' | 'work') => {
    const p = d[which];
    if (p) directionsTo(p);
    else {
      toast(which === 'home' ? 'כדי להגדיר בית: חפשו את הכתובת, ובכרטיס המקום לחצו שמירה ← הגדרה כבית' : 'כדי להגדיר עבודה: חפשו את הכתובת, ובכרטיס המקום לחצו שמירה ← הגדרה כעבודה', undefined, 7000);
    }
  };
  return (
    <div class="shortcuts">
      <div class="chips">
        <button class="chip" onClick={() => go('home')}>
          🏠 {d.home ? 'בית' : 'הגדרת בית'}
        </button>
        <button class="chip" onClick={() => go('work')}>
          💼 {d.work ? 'עבודה' : 'הגדרת עבודה'}
        </button>
        <button class="chip" onClick={() => open({ kind: 'saved' })}>
          ⭐ שמורים
        </button>
      </div>
      {d.history.length > 0 && (
        <>
          <h3 class="section-title">אחרונים</h3>
          <ul class="list">
            {d.history.slice(0, 4).map((p) => (
              <PlaceRow key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ----- saved screen -----
function SavedView(_: ViewProps) {
  const d = data.value;
  const newName = useSignal('');
  const fileInput = (
    <input
      type="file"
      accept=".geojson,.json,application/geo+json,application/json"
      class="visually-hidden"
      id="import-geojson"
      onChange={async (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        try {
          const parsed = fromGeoJSON(JSON.parse(await f.text()));
          const l = createList(parsed.name, '📥', parsed.places);
          toast(`יובאו ${parsed.places.length} מקומות`);
          open({ kind: 'list', props: { id: l.id } });
        } catch (err) {
          toast((err as Error).message || 'הייבוא נכשל');
        }
        (e.target as HTMLInputElement).value = '';
      }}
    />
  );
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          →
        </button>
        <h2>שמורים</h2>
      </header>
      <ul class="list">
        {(['home', 'work'] as const).map((w) => {
          const p = d[w];
          return (
            <li key={w} class="row-with-action">
              <button class="list-item" onClick={() => (p ? openPlace(p) : toast('חפשו את הכתובת, ובכרטיס המקום לחצו שמירה'))}>
                <span class="li-icon" aria-hidden="true">{w === 'home' ? '🏠' : '💼'}</span>
                <span class="li-body">
                  <div class="li-title">{w === 'home' ? 'בית' : 'עבודה'}</div>
                  <div class="li-sub">{p ? p.address ?? p.name : 'לא הוגדר'}</div>
                </span>
              </button>
              {p && (
                <button class="icon-btn" aria-label="ניקוי" onClick={() => setHomeWork(w, undefined)}>
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <h3 class="section-title">רשימות</h3>
      <ul class="list">
        {d.lists.map((l) => (
          <li key={l.id}>
            <button class="list-item" onClick={() => open({ kind: 'list', props: { id: l.id } })}>
              <span class="li-icon" aria-hidden="true">{l.icon}</span>
              <span class="li-body">
                <div class="li-title">{l.name}</div>
                <div class="li-sub">{l.places.length} מקומות</div>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.value.trim()) return;
          createList(newName.value);
          newName.value = '';
        }}
      >
        <input class="input" placeholder="רשימה חדשה" aria-label="שם לרשימה חדשה" value={newName.value} onInput={(e) => (newName.value = (e.target as HTMLInputElement).value)} />
        <button class="btn" type="submit">
          יצירה
        </button>
      </form>
      {fileInput}
      <label class="btn small" for="import-geojson">
        📥 ייבוא קובץ GeoJSON
      </label>
      {d.history.length > 0 && (
        <>
          <h3 class="section-title">
            היסטוריה{' '}
            <button class="link-like small" onClick={clearHistory}>
              ניקוי
            </button>
          </h3>
          <ul class="list">
            {d.history.slice(0, 20).map((p) => (
              <PlaceRow key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
      <p class="muted small">השמורים נשמרים במכשיר הזה. עם חשבון (בקרוב) הם יסונכרנו לכל המכשירים שלך.</p>
    </div>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function ListView({ view }: ViewProps<{ id?: string; shared?: { name: string; places: SavedPlace[] } }>) {
  const props = view.props ?? {};
  const shared = props.shared;
  const list: SavedList | undefined = shared
    ? { id: 'shared', name: shared.name, icon: '🔗', places: shared.places, createdAt: Date.now() }
    : data.value.lists.find((l) => l.id === props.id);
  const editing = useSignal(false);
  if (!list) {
    return (
      <div class="view empty">
        <p>הרשימה לא נמצאה.</p>
        <button class="btn" onClick={back}>
          חזרה
        </button>
      </div>
    );
  }
  const shareLink = async () => {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('list', encodeList(list));
    const url = u.toString();
    try {
      if (navigator.share) await navigator.share({ title: list.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('הקישור לרשימה הועתק');
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          →
        </button>
        {editing.value && !shared ? (
          <input
            class="input"
            aria-label="שם הרשימה"
            value={list.name}
            autoFocus
            onBlur={(e) => {
              renameList(list.id, (e.target as HTMLInputElement).value);
              editing.value = false;
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h2 onDblClick={() => (editing.value = true)}>
            {list.icon} {list.name}
          </h2>
        )}
      </header>
      {shared && (
        <div class="banner">
          <p>רשימה ששיתפו איתך ({list.places.length} מקומות).</p>
          <button
            class="btn primary"
            onClick={() => {
              const l = createList(list.name, '🔗', list.places);
              toast('הרשימה נשמרה אצלך');
              open({ kind: 'list', props: { id: l.id } }, { replace: true });
            }}
          >
            שמירה אצלי
          </button>
        </div>
      )}
      <div class="action-row">
        <button class="action" onClick={() => void shareLink()} disabled={!list.places.length}>
          <span class="circle" aria-hidden="true">⤴</span>
          שיתוף
        </button>
        <button class="action" onClick={() => download(`${list.name}.geojson`, JSON.stringify(toGeoJSON(list), null, 2))} disabled={!list.places.length}>
          <span class="circle" aria-hidden="true">⬇</span>
          ייצוא
        </button>
        <button
          class="action"
          onClick={() => {
            if (!list.places.length) return;
            let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
            for (const p of list.places) {
              w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat);
            }
            map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 15 });
          }}
        >
          <span class="circle" aria-hidden="true">🗺</span>
          במפה
        </button>
        {!shared && !list.builtIn && (
          <>
            <button class="action" onClick={() => (editing.value = true)}>
              <span class="circle" aria-hidden="true">✎</span>
              שינוי שם
            </button>
            <button
              class="action"
              onClick={() => {
                const removed = deleteList(list.id);
                back();
                if (removed) toast('הרשימה נמחקה', { label: 'ביטול', run: () => restoreList(removed) }, 6000);
              }}
            >
              <span class="circle" aria-hidden="true">🗑</span>
              מחיקה
            </button>
          </>
        )}
      </div>
      {list.places.length === 0 && <p class="muted">עוד אין כאן מקומות. בכרטיס של כל מקום יש כפתור שמירה.</p>}
      <ul class="list">
        {list.places.map((p) => (
          <PlaceRow key={p.id} p={p} onRemove={shared ? undefined : () => toggleInList(list.id, p)} />
        ))}
      </ul>
    </div>
  );
}

function drawSaved() {
  if (!map.getSource('saved-places')) return;
  const seen = new Map<string, Place & { icon: string }>();
  for (const l of data.value.lists) for (const p of l.places) if (!seen.has(p.id)) seen.set(p.id, { ...p, icon: l.icon });
  const d = data.value;
  if (d.home) seen.set(d.home.id, { ...d.home, icon: '🏠' });
  if (d.work) seen.set(d.work.id, { ...d.work, icon: '💼' });
  setGeoJSON(map, 'saved-places', {
    type: 'FeatureCollection',
    features: [...seen.values()].map((p) => ({ type: 'Feature', properties: { id: p.id, name: p.name, icon: p.icon }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
  });
}

export default defineFeature({
  id: 'saved',
  title: 'שמורים ורשימות',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('saved', SavedView);
    ctx.registerView('list', ListView);
    ctx.registerView('save-to', SaveToView);
    ctx.registerPlaceAction({ id: 'save', order: 0, Component: SaveAction });
    ctx.registerHomeSection({ id: 'saved', order: 10, Component: HomeShortcuts });
    ctx.registerMenuItem({ id: 'saved', label: 'שמורים ורשימות', icon: '⭐', order: 10, run: () => open({ kind: 'saved' }) });

    ctx.onStyle((m) => {
      setGeoJSON(m, 'saved-places', EMPTY);
      ensureLayer(m, {
        id: 'saved-places',
        type: 'symbol',
        source: 'saved-places',
        minzoom: 9,
        layout: {
          'text-field': ['get', 'icon'],
          'text-size': 18,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
      }, null);
      drawSaved();
    });
    data.subscribe(() => drawSaved());

    ctx.onMapClick((_e, features) => {
      const f = features.find((x) => x.layer.id === 'saved-places');
      if (!f) return;
      const id = String(f.properties.id);
      const d = data.value;
      const p = [d.home, d.work, ...d.lists.flatMap((l) => l.places)].find((x) => x?.id === id);
      if (p) {
        openPlace(p);
        return true;
      }
    }, 90);

    // Remember places the user opened (history), not every click on the way.
    let timer: ReturnType<typeof setTimeout> | undefined;
    selectedPlace.subscribe((p) => {
      clearTimeout(timer);
      if (p && p.name !== 'נקודה שנבחרה') timer = setTimeout(() => currentView.peek().kind === 'place' && addHistory(p), 1500);
    });

    if (ctx.initialUrl.list) {
      try {
        const shared = decodeList(ctx.initialUrl.list);
        open({ kind: 'list', props: { shared } });
        if (shared.places.length) {
          let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
          for (const p of shared.places) {
            w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat);
          }
          ctx.map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 15, duration: 0 });
        }
      } catch {
        toast('הקישור לרשימה פגום');
      }
    }
    if (ctx.initialUrl.panel === 'saved') open({ kind: 'saved' });
  },
});
