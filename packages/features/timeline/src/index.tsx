import { batch, signal, useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { formatClock, formatDistance, formatDuration, placeVisual, regionAt, type LngLat } from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  EMPTY,
  ensureLayer,
  firstSymbolLayer,
  Icon,
  open,
  region,
  openPlace,
  setGeoJSON,
  toast,
  units,
  viewStack,
  type ViewProps,
} from '@nm/core/app';
import { searchPlaces, tools } from '@nm/tools';
import { clearAll, deleteBetween, deleteSeg, exportAll, hasDb, lastPoint, pointsBetween, putEdits, segsBetween } from './db.ts';
import { addDays, dayKey, dayRange, isDay } from './days.ts';
import { ownExport } from './google.ts';
import { importFiles, type ImportSummary } from './importer.ts';
import { autoIdentify, candidates, lookupHere, resolveStay, toPlace } from './places.ts';
import { initRecorder, keepAwake, lastSavedAt, recording, savedCount, wakeState } from './recorder.ts';
import { mergeSegments, overlapping, segment, summarize } from './segment.ts';
import type { Mode, Move, PlaceRef, Seg, Stay } from './types.ts';

let map: MapLibreMap;

// ---------- day data ----------

/** Time zone of the timeline: the region of your newest point. */
const tz = signal<string | undefined>(undefined);
/** Before any point is known, the region the map shows. */
const zone = () => tz.value ?? region.value.timeZone;
const today = () => dayKey(Date.now(), zone());

interface DayData {
  day: string;
  range: [number, number];
  segs: Seg[];
  loading: boolean;
  error?: boolean;
}
const dayData = signal<DayData | null>(null);
/** Resolved place per stay id; undefined = still looking, null = nothing found. */
const names = signal<Record<string, PlaceRef | null>>({});
const importing = signal<{ done: number; total: number } | null>(null);

let loadSeq = 0;
let lastLoad = 0;
async function loadDay(day: string, fit: boolean): Promise<void> {
  const seq = ++loadSeq;
  lastLoad = Date.now();
  const range = dayRange(day, zone());
  const prev = dayData.value?.day === day ? dayData.value.segs : [];
  dayData.value = { day, range, segs: prev, loading: true };
  if (!hasDb()) {
    dayData.value = { day, range, segs: [], loading: false };
    return;
  }
  try {
    const H12 = 12 * 3600_000;
    const [pts, imported] = await Promise.all([pointsBetween(range[0] - H12, range[1] + H12), segsBetween(range[0], range[1])]);
    const segs = overlapping(mergeSegments(imported, segment(pts)), range[0], range[1]);
    if (seq !== loadSeq) return;
    dayData.value = { day, range, segs, loading: false };
    if (fit) fitDay(segs);
    void resolveNames(segs, seq);
  } catch {
    if (seq === loadSeq) dayData.value = { day, range, segs: [], loading: false, error: true };
  }
}

async function resolveNames(segs: Seg[], seq: number) {
  const stays = segs.filter((s): s is Stay => s.kind === 'stay');
  // Everything the device knows first, all at once; then lookups one by one.
  const local = await Promise.all(stays.map((s) => resolveStay(map, s, false).catch(() => undefined)));
  if (seq !== loadSeq) return;
  const known: Record<string, PlaceRef | null> = {};
  stays.forEach((s, i) => {
    if (local[i] !== undefined) known[s.id] = local[i]!;
  });
  names.value = { ...names.value, ...known };
  for (const s of stays) {
    if (s.id in known) continue;
    const ref = (await resolveStay(map, s)) ?? null;
    if (seq !== loadSeq) return;
    names.value = { ...names.value, [s.id]: ref };
  }
}

const reload = () => {
  const d = dayData.value;
  if (d) void loadDay(d.day, false);
};

function openTimeline(day = today(), opts: { replace?: boolean } = {}) {
  open({ kind: 'timeline', props: { url: { panel: 'timeline', day } } }, opts);
}

/** Switch the day shown (replaces the screen, so Back leaves the timeline). */
function goDay(day: string) {
  if (!isDay(day)) return;
  openTimeline(day > today() ? today() : day, { replace: currentView.value.kind === 'timeline' });
}

// ---------- labels ----------

const MODE_LABEL: Record<Mode, string> = {
  walk: 'הליכה',
  bike: 'רכיבה על אופניים',
  car: 'נסיעה ברכב',
  bus: 'נסיעה באוטובוס',
  train: 'נסיעה ברכבת',
  flight: 'טיסה',
  boat: 'שיט',
  unknown: 'בדרך',
};
const MODE_ICON: Record<Mode, string> = {
  walk: 'directions_walk',
  bike: 'directions_bike',
  car: 'directions_car',
  bus: 'directions_bus',
  train: 'train',
  flight: 'flight',
  boat: 'directions_boat',
  unknown: 'route',
};
/** Map colours per mode (the list uses the same ones from CSS). */
const MODE_COLOR: Record<Mode, string> = {
  walk: '#1e8e3e',
  bike: '#00897b',
  car: '#1a73e8',
  bus: '#e37400',
  train: '#8e24aa',
  flight: '#5f6368',
  boat: '#0097a7',
  unknown: '#80868b',
};

const clock = (t: number) => formatClock(new Date(t).toISOString(), zone());

function dayLabel(day: string): { title: string; sub?: string } {
  const [y, m, d] = day.split('-').map(Number);
  const full = new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: y !== Number(today().slice(0, 4)) ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(Date.UTC(y, m - 1, d));
  if (day === today()) return { title: 'היום', sub: full };
  if (day === addDays(today(), -1)) return { title: 'אתמול', sub: full };
  return { title: full };
}

function stayVisual(ref: PlaceRef | null | undefined, s: Stay): { icon: string; group: string } {
  const sem = ref?.semantic ?? s.semantic;
  if (sem === 'home') return { icon: 'home', group: 'place' };
  if (sem === 'work') return { icon: 'work', group: 'place' };
  if (ref?.category) return placeVisual(ref);
  return { icon: 'location_on', group: 'address' };
}

// ---------- map ----------

const isActive = () => viewStack.value.some((v) => v.kind === 'timeline' || v.kind === 'timeline-place');

function draw() {
  if (!map?.getSource('timeline-path')) return;
  const d = dayData.value;
  if (!isActive() || !d) {
    setGeoJSON(map, 'timeline-path', EMPTY);
    setGeoJSON(map, 'timeline-stays', EMPTY);
    return;
  }
  setGeoJSON(map, 'timeline-path', {
    type: 'FeatureCollection',
    features: d.segs
      .filter((s): s is Move => s.kind === 'move' && s.path.length >= 2)
      .map((s) => ({ type: 'Feature', properties: { id: s.id, mode: s.mode }, geometry: { type: 'LineString', coordinates: s.path } })),
  });
  setGeoJSON(map, 'timeline-stays', {
    type: 'FeatureCollection',
    features: d.segs
      .filter((s): s is Stay => s.kind === 'stay')
      .map((s) => ({ type: 'Feature', properties: { id: s.id }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })),
  });
}

function fitDay(segs: Seg[]) {
  if (!isActive() || !map) return;
  const pts: LngLat[] = [];
  for (const s of segs) {
    if (s.kind === 'stay') pts.push([s.lng, s.lat]);
    else pts.push(...s.path);
  }
  if (!pts.length) return;
  let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) {
    w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y);
  }
  map.fitBounds([[w, so], [e, n]], { padding: 50, maxZoom: 16, duration: 600 });
}

function openStay(s: Stay) {
  const place = toPlace(names.value[s.id], s);
  map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 16) });
  openPlace(place);
}

// ---------- UI pieces ----------

function Header({ title, settings }: { title: string; settings?: boolean }) {
  return (
    <header class="view-header">
      <button class="icon-btn" aria-label="חזרה" onClick={back}>
        <Icon name="arrow_back" />
      </button>
      <h2>{title}</h2>
      {settings && (
        <button class="icon-btn" aria-label="הגדרות ציר הזמן" onClick={() => open({ kind: 'timeline-settings', props: { url: { panel: 'timeline', day: dayData.value?.day } } })}>
          <Icon name="settings" />
        </button>
      )}
    </header>
  );
}

function Switch({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <label class="tl-switch-row">
      <span class="li-body">
        <span class="li-title">{label}</span>
        {sub && <span class="li-sub">{sub}</span>}
      </span>
      <input type="checkbox" role="switch" class="tl-switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

const IOS_NOTE = 'באייפון (וברוב הדפדפנים) אפשר לקרוא את המיקום רק כשהאפליקציה פתוחה על המסך. כשהיא סגורה או שהמסך כבוי, ההקלטה נעצרת וממשיכה כשחוזרים.';

function RecordCard() {
  if (!recording.value) {
    return (
      <div class="tl-rec">
        <span class="tl-rec-icon" aria-hidden="true">
          <Icon name="timeline" size={22} />
        </span>
        <div class="tl-rec-body">
          <div class="tl-rec-title">הקלטת ציר זמן כבויה</div>
          <div class="small muted">כשההקלטה פועלת והאפליקציה פתוחה, נשמרים המקומות שביקרת בהם והדרך ביניהם. הכול נשמר רק במכשיר הזה.</div>
        </div>
        <button class="btn tonal small" onClick={() => (recording.value = true)}>
          הפעלה
        </button>
      </div>
    );
  }
  const n = savedCount.value;
  return (
    <div class="tl-rec on" role="status">
      <span class="tl-rec-dot" aria-hidden="true" />
      <div class="tl-rec-body">
        <div class="tl-rec-title">מקליט בזמן שהאפליקציה פתוחה</div>
        <div class="small muted">
          {n === 1 ? 'נקודה אחת נשמרה' : n ? `${n} נקודות נשמרו` : 'ממתין למיקום…'}
          {lastSavedAt.value ? (
            <>
              {' · אחרונה '}
              <span dir="ltr">{clock(lastSavedAt.value)}</span>
            </>
          ) : null}
          {wakeState.value === 'on' ? ' · המסך נשאר דלוק' : ''}
        </div>
      </div>
      <button class="btn small" onClick={() => (recording.value = false)}>
        עצירה
      </button>
    </div>
  );
}

function DayBar({ day }: { day: string }) {
  const input = useRef<HTMLInputElement>(null);
  const label = dayLabel(day);
  const isToday = day >= today();
  const pick = () => {
    const el = input.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    try {
      el?.showPicker?.();
    } catch {
      el?.focus();
    }
  };
  return (
    <div class="tl-daybar">
      <button class="icon-btn" aria-label="היום הקודם" onClick={() => goDay(addDays(day, -1))}>
        <Icon name="chevron_left" />
      </button>
      <div class="tl-date">
        <Icon name="calendar_month" size={20} />
        <span class="tl-date-text">
          <span class="tl-date-title">{label.title}</span>
          {label.sub && <span class="tl-date-sub">{label.sub}</span>}
        </span>
        <input
          ref={input}
          type="date"
          class="tl-date-input"
          aria-label="בחירת תאריך"
          value={day}
          max={today()}
          onClick={pick}
          onChange={(e) => goDay((e.target as HTMLInputElement).value)}
        />
      </div>
      <button class="icon-btn" aria-label="היום הבא" disabled={isToday} onClick={() => goDay(addDays(day, 1))}>
        <Icon name="chevron_right" />
      </button>
    </div>
  );
}

function Summary({ d }: { d: DayData }) {
  const s = summarize(d.segs, d.range[0], d.range[1]);
  return (
    <div class="tl-summary" aria-label="סיכום היום">
      <div>
        <strong>{s.distanceM ? formatDistance(s.distanceM, units.value) : '0'}</strong>
        <span>מרחק</span>
      </div>
      <div>
        <strong>{s.places}</strong>
        <span>{s.places === 1 ? 'מקום' : 'מקומות'}</span>
      </div>
      <div>
        <strong>{s.movingMs ? formatDuration(s.movingMs / 1000) : '0'}</strong>
        <span>בתנועה</span>
      </div>
    </div>
  );
}

function StayRow({ s, day, last }: { s: Stay; day: string; last: boolean }) {
  const ref = names.value[s.id];
  const name = ref?.name || (ref === undefined ? 'מזהה את המקום…' : 'מקום לא מזוהה');
  const v = stayVisual(ref, s);
  const ongoing = last && recording.value && day === today() && Date.now() - s.end < 10 * 60_000;
  const addr = ref?.address && ref.address !== name ? ref.address : undefined;
  return (
    <li class="tl-item tl-stay">
      <span class="tl-node">
        <span class={`place-badge g-${v.group}`} style={{ width: '36px', height: '36px' }} aria-hidden="true">
          <Icon name={v.icon} size={20} />
        </span>
      </span>
      <div class="tl-card">
        <button class="tl-main" onClick={() => openStay(s)}>
          <span class="tl-title">{name}</span>
          <span class="tl-sub">
            <span dir="ltr" class="tl-time">
              {clock(s.start)}–{ongoing ? 'עכשיו' : clock(s.end)}
            </span>
            {' · '}
            {formatDuration((Math.min(s.end, ongoing ? Date.now() : s.end) - s.start) / 1000)}
          </span>
          {addr && <span class="tl-addr">{addr}</span>}
        </button>
        <button
          class="icon-btn small"
          aria-label={`תיקון המקום: ${name}`}
          onClick={() => open({ kind: 'timeline-place', props: { stay: s, url: { panel: 'timeline', day } } })}
        >
          <Icon name="edit" size={20} />
        </button>
      </div>
    </li>
  );
}

function MoveRow({ s }: { s: Move }) {
  return (
    <li class={`tl-item tl-move m-${s.mode}`}>
      <span class="tl-node">
        <span class="tl-rail" />
      </span>
      <button
        class="tl-move-body"
        onClick={() => {
          if (s.path.length >= 2) fitDay([s]);
        }}
      >
        <span class="tl-mode-icon" aria-hidden="true">
          <Icon name={MODE_ICON[s.mode]} size={18} />
        </span>
        <span class="tl-move-label">{MODE_LABEL[s.mode]}</span>
        <span class="tl-move-meta">
          {s.distanceM >= 1 ? `${formatDistance(s.distanceM, units.value)} · ` : ''}
          {formatDuration((s.end - s.start) / 1000)}
          {' · '}
          <span dir="ltr">{clock(s.start)}</span>
        </span>
      </button>
    </li>
  );
}

function TimelineView({ view }: ViewProps<{ url?: { day?: string } }>) {
  const asked = view.props?.url?.day;
  const day = asked && isDay(asked) ? (asked > today() ? today() : asked) : today();
  useEffect(() => {
    if (dayData.value?.day !== day || dayData.value.error) void loadDay(day, true);
    else fitDay(dayData.value.segs);
  }, [day]);
  const d = dayData.value?.day === day ? dayData.value : null;
  const segs = d?.segs ?? [];
  // Looking back at a day with history: the recording switch moves out of the way.
  const recTop = recording.value || day === today() || !segs.length;
  return (
    <div class="view timeline">
      <Header title="ציר הזמן שלי" settings />
      {recTop && <RecordCard />}
      <DayBar day={day} />
      {d && !d.loading && segs.length > 0 && <Summary d={d} />}
      {(!d || (d.loading && !segs.length)) && <div class="spinner" />}
      {d && !d.loading && !segs.length && (
        <div class="tl-empty">
          <Icon name="timeline" size={40} />
          <p>{d.error ? 'לא הצלחנו לקרוא את ציר הזמן במכשיר הזה.' : 'אין מידע על היום הזה.'}</p>
          {!recording.value && (
            <p class="small muted">
              אפשר להפעיל הקלטה למעלה, או לייבא היסטוריה מציר הזמן של גוגל מפות{' '}
              <button class="link-like" onClick={() => open({ kind: 'timeline-settings', props: { url: { panel: 'timeline', day } } })}>
                בהגדרות
              </button>
              .
            </p>
          )}
        </div>
      )}
      {segs.length > 0 && (
        <ol class="tl-list" aria-label="המקומות והדרכים של היום">
          {segs.map((s, i) => (s.kind === 'stay' ? <StayRow key={s.id} s={s} day={day} last={i === segs.length - 1} /> : <MoveRow key={s.id} s={s} />))}
        </ol>
      )}
      {segs.length > 0 && (
        <div class="tl-day-actions">
          <button
            class="btn small danger"
            onClick={async () => {
              if (!d || !confirm('למחוק את כל המידע של היום הזה? אי אפשר לבטל.')) return;
              await deleteBetween(d.range[0], d.range[1]);
              toast('היום נמחק מציר הזמן');
              reload();
            }}
          >
            <Icon name="delete" size={18} />
            מחיקת היום
          </button>
        </div>
      )}
      {!recTop && <RecordCard />}
      {recording.value && <p class="small muted tl-note">{IOS_NOTE}</p>}
    </div>
  );
}

function CandidateRow({ p, onPick }: { p: PlaceRef & { d?: number }; onPick: () => void }) {
  const v = p.semantic ? { icon: p.semantic, group: 'place' } : p.category ? placeVisual(p) : { icon: 'location_on', group: 'address' };
  return (
    <li>
      <button class="list-item" onClick={onPick}>
        <span class={`place-badge g-${v.group}`} style={{ width: '36px', height: '36px' }} aria-hidden="true">
          <Icon name={v.icon} size={20} />
        </span>
        <span class="li-body">
          <div class="li-title">{p.name}</div>
          {p.address && p.address !== p.name && <div class="li-sub">{p.address}</div>}
        </span>
        {p.d !== undefined && <span class="li-end">{formatDistance(p.d, units.value)}</span>}
      </button>
    </li>
  );
}

function TimelinePlaceView({ view }: ViewProps<{ stay?: Stay }>) {
  const s = view.props?.stay;
  const list = useSignal<(PlaceRef & { d?: number })[] | null>(null);
  const q = useSignal('');
  const results = useSignal<PlaceRef[]>([]);
  const custom = useSignal('');
  useEffect(() => {
    if (!s) return;
    // Businesses come from what the map draws, so refresh them whenever it settles.
    let here: (PlaceRef & { d?: number }) | null = null;
    let looked = false;
    const refresh = () => {
      const c = candidates(map, s, here);
      if (c.length || looked) list.value = c;
    };
    map.flyTo({ center: [s.lng, s.lat], zoom: 17, duration: 500 });
    map.on('idle', refresh);
    let alive = true;
    void lookupHere(s).then((h) => {
      if (!alive) return;
      here = h;
      looked = true;
      refresh();
    });
    return () => {
      alive = false;
      map.off('idle', refresh);
    };
  }, [s?.id]);
  useEffect(() => {
    if (!s || q.value.trim().length < 2) {
      results.value = [];
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      tools()
        .call(searchPlaces, { query: q.value.trim(), near: [s.lng, s.lat], zoom: 16, limit: 6 }, { signal: ctl.signal })
        .then((r) => (results.value = r.map((p) => ({ id: p.id, name: p.name, lng: p.lng, lat: p.lat, address: p.address, category: p.category }))))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q.value]);
  if (!s) return null;
  const current = names.value[s.id];
  const pick = async (ref: PlaceRef) => {
    const place: PlaceRef = { ...ref, source: 'edit' };
    await putEdits([{ id: s.id, place, at: Date.now() }]);
    names.value = { ...names.value, [s.id]: place };
    toast(`נשמר: ${place.name}`);
    back();
  };
  return (
    <div class="view timeline">
      <Header title="זה היה…" />
      <p class="muted small">
        ביקור ב-<span dir="ltr">{clock(s.start)}–{clock(s.end)}</span>
        {current?.name ? ` · עכשיו: ${current.name}` : ''}
      </p>
      <div class="field">
        <label for="tl-place-q">חיפוש מקום</label>
        <input id="tl-place-q" class="input" type="search" placeholder="שם המקום" value={q.value} onInput={(e) => (q.value = (e.target as HTMLInputElement).value)} />
      </div>
      {results.value.length > 0 && (
        <ul class="list">
          {results.value.map((p) => (
            <CandidateRow key={p.id ?? p.name} p={p} onPick={() => void pick(p)} />
          ))}
        </ul>
      )}
      <h3 class="section-title">מקומות בסביבה</h3>
      {list.value === null ? (
        <div class="spinner" />
      ) : list.value.length ? (
        <ul class="list">
          {list.value.map((p) => (
            <CandidateRow key={p.id ?? p.name} p={p} onPick={() => void pick(p)} />
          ))}
        </ul>
      ) : (
        <p class="small muted">לא מצאנו מקומות קרובים. אפשר לחפש או לתת שם משלך.</p>
      )}
      <form
        class="inline-form tl-custom"
        onSubmit={(e) => {
          e.preventDefault();
          const name = custom.value.trim();
          if (name) void pick({ name, lng: s.lng, lat: s.lat });
        }}
      >
        <input class="input" placeholder="שם משלך (למשל: אצל סבתא)" aria-label="שם משלך" value={custom.value} onInput={(e) => (custom.value = (e.target as HTMLInputElement).value)} />
        <button class="btn" type="submit" disabled={!custom.value.trim()}>
          שמירה
        </button>
      </form>
      <div class="tl-day-actions">
        <button
          class="btn small danger"
          onClick={async () => {
            if (!confirm('למחוק את הביקור הזה מציר הזמן?')) return;
            if (s.source === 'google') await deleteSeg(s.id);
            else await deleteBetween(s.start, s.end + 1);
            back();
            toast('הביקור נמחק');
            reload();
          }}
        >
          <Icon name="delete" size={18} />
          מחיקת הביקור
        </button>
      </div>
    </div>
  );
}

function importMessage(s: ImportSummary): string {
  if (!s.files || s.failed === s.files) {
    if (s.firstError === 'zip') return 'זה קובץ zip. פתחו אותו ובחרו את קבצי ה-JSON שבתוכו.';
    if (s.firstError === 'format') return 'הקובץ לא נראה כמו ייצוא של ציר הזמן.';
    return 'לא הצלחנו לקרוא את הקובץ.';
  }
  const parts = [];
  if (s.stays) parts.push(`${s.stays} ביקורים`);
  if (s.moves) parts.push(`${s.moves} נסיעות`);
  if (s.points) parts.push(`${s.points} נקודות`);
  const what = parts.length ? parts.join(', ') : 'אין מידע חדש';
  return s.failed ? `יובאו ${what}. ${s.failed} קבצים לא נקראו.` : `יובאו ${what}`;
}

async function onImport(files: FileList | null) {
  if (!files?.length) return;
  const list = [...files];
  importing.value = { done: 0, total: list.length };
  const s = await importFiles(list, (done) => (importing.value = { done, total: list.length }));
  importing.value = null;
  toast(importMessage(s), undefined, 6000);
  if (s.newest !== undefined) {
    const day = dayKey(s.newest, zone());
    dayData.value = null;
    batch(() => {
      if (currentView.value.kind === 'timeline-settings') back();
      goDay(day);
    });
  }
}

async function onExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(ownExport(data.points, data.segs, data.edits))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nadav-maps-timeline-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function SettingsView(_: ViewProps) {
  return (
    <div class="view timeline">
      <Header title="הגדרות ציר הזמן" />
      <p class="small muted">ציר הזמן נשמר רק במכשיר הזה. הוא לא נשלח לשום שרת ולא נכתב ללוגים.</p>
      <Switch
        label="הקלטת ציר זמן"
        sub="שומר את המיקום בזמן שהאפליקציה פתוחה"
        checked={recording.value}
        onChange={(v) => (recording.value = v)}
      />
      <Switch
        label="השארת המסך דלוק בזמן הקלטה"
        sub={wakeState.value === 'unsupported' ? 'הדפדפן הזה לא תומך בזה' : wakeState.value === 'failed' ? 'הדפדפן סירב (אולי מצב חיסכון בסוללה)' : 'כדי שההקלטה לא תיעצר כשהמסך נכבה'}
        checked={keepAwake.value}
        onChange={(v) => (keepAwake.value = v)}
      />
      <Switch
        label="זיהוי שמות מקומות"
        sub="שולח את הנקודה לשירות החיפוש, כמו לחיצה על המפה"
        checked={autoIdentify.value}
        onChange={(v) => (autoIdentify.value = v)}
      />
      <p class="small muted">{IOS_NOTE}</p>

      <h3 class="section-title">ייבוא מגוגל מפות</h3>
      <p class="small muted">
        בטלפון: גוגל מפות ← התמונה שלך ← ציר הזמן ← ⋮ ← הגדרות מיקום ופרטיות ← "ייצוא נתוני ציר הזמן". מ-Google Takeout: קבצי Semantic Location History או Records.json (פתחו קודם את ה-zip). הקבצים נקראים כאן בדפדפן ולא עולים לשום מקום.
      </p>
      <input
        id="tl-import"
        type="file"
        accept=".json,application/json"
        multiple
        class="visually-hidden"
        onChange={(e) => {
          void onImport((e.target as HTMLInputElement).files);
          (e.target as HTMLInputElement).value = '';
        }}
      />
      <label for="tl-import" class="btn primary full">
        <Icon name="upload_file" size={18} /> ייבוא קובץ ציר זמן
      </label>
      {importing.value && (
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={importing.value.total} aria-valuenow={importing.value.done}>
          <div class="progress-bar" style={{ width: `${(100 * importing.value.done) / importing.value.total}%` }} />
          <span class="small">
            קורא {importing.value.done} מתוך {importing.value.total}
          </span>
        </div>
      )}

      <h3 class="section-title">המידע שלך</h3>
      <div class="tl-settings-actions">
        <button class="btn" onClick={() => void onExport()}>
          <Icon name="download" size={18} /> ייצוא (JSON)
        </button>
        <button
          class="btn danger"
          onClick={async () => {
            if (!confirm('למחוק את כל ציר הזמן מהמכשיר? אי אפשר לבטל.')) return;
            await clearAll();
            names.value = {};
            toast('ציר הזמן נמחק');
            reload();
          }}
        >
          <Icon name="delete_sweep" size={18} /> מחיקת הכול
        </button>
      </div>
    </div>
  );
}

function HomeRecording() {
  if (!recording.value) return null;
  return (
    <button class="tl-home" onClick={() => openTimeline()}>
      <span class="tl-rec-dot" aria-hidden="true" />
      <span class="tl-home-text">ציר הזמן מקליט</span>
      <span class="small muted">{savedCount.value === 1 ? 'נקודה אחת' : savedCount.value ? `${savedCount.value} נקודות` : 'ממתין למיקום'}</span>
    </button>
  );
}

export default defineFeature({
  id: 'timeline',
  title: 'ציר הזמן שלי',
  description: 'איפה היית ואיך הגעת, כמו ציר הזמן של גוגל. מקליט רק כשהאפליקציה פתוחה ונשמר רק במכשיר.',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('timeline', TimelineView, { hideTop: true });
    ctx.registerView('timeline-place', TimelinePlaceView, { hideTop: true });
    ctx.registerView('timeline-settings', SettingsView, { hideTop: true });
    ctx.registerMenuItem({ id: 'timeline', label: 'ציר הזמן שלי', icon: 'timeline', order: 15, run: () => openTimeline() });
    ctx.registerHomeSection({ id: 'timeline', order: 5, Component: HomeRecording });

    ctx.onStyle((m) => {
      setGeoJSON(m, 'timeline-path', EMPTY);
      setGeoJSON(m, 'timeline-stays', EMPTY);
      const color = ['match', ['get', 'mode'], ...Object.entries(MODE_COLOR).flat(), '#80868b'] as unknown as string;
      const before = firstSymbolLayer(m);
      ensureLayer(m, { id: 'timeline-path-casing', type: 'line', source: 'timeline-path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } }, before);
      ensureLayer(m, {
        id: 'timeline-path',
        type: 'line',
        source: 'timeline-path',
        filter: ['!', ['in', ['get', 'mode'], ['literal', ['walk', 'flight']]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 5 },
      }, before);
      ensureLayer(m, {
        id: 'timeline-path-dashed',
        type: 'line',
        source: 'timeline-path',
        filter: ['in', ['get', 'mode'], ['literal', ['walk', 'flight']]],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 5, 'line-dasharray': [1, 1.2] },
      }, before);
      ensureLayer(m, {
        id: 'timeline-stays',
        type: 'circle',
        source: 'timeline-stays',
        paint: { 'circle-radius': 7, 'circle-color': '#ea4335', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
      }, null);
      draw();
    });
    dayData.subscribe(() => draw());
    let wasActive = false;
    viewStack.subscribe(() => {
      const a = isActive();
      if (a !== wasActive) {
        wasActive = a;
        draw();
      }
    });

    ctx.onMapClick((_e, features) => {
      const f = features.find((x) => x.layer.id === 'timeline-stays');
      if (!f) return;
      const s = dayData.value?.segs.find((x): x is Stay => x.kind === 'stay' && x.id === f.properties.id);
      if (!s) return;
      openStay(s);
      return true;
    }, 150);

    initRecorder();
    // While watching today, show new points as they come (at most every 30 s).
    savedCount.subscribe(() => {
      const d = dayData.value;
      if (d && !d.loading && isActive() && d.day === today() && Date.now() - lastLoad > 30_000) void loadDay(d.day, false);
    });

    if (hasDb()) {
      void lastPoint()
        .then((p) => {
          if (p) tz.value = regionAt([p.lng, p.lat]).timeZone;
        })
        .catch(() => {});
    }

    if (ctx.initialUrl.panel === 'timeline') openTimeline(ctx.initialUrl.day && isDay(ctx.initialUrl.day) ? ctx.initialUrl.day : undefined);
  },
});
