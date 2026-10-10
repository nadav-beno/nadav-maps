import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { delayMinutes, formatClock, formatDeparture, type Departure, type LngLat, type Place } from '@nm/core';
import { back, defineFeature, Icon, LineChip, open, region, userLocation, type ViewProps } from '@nm/core/app';
import { tools, transitDeparturesTool } from '@nm/tools';
import { isTransitStop } from './stops.ts';

/**
 * Public transport around you: next departures on a stop's place card, and a
 * "departures near me" screen. Journeys by transit live in the directions feature.
 */

let map: MapLibreMap;

const REFRESH_MS = 30_000;

function useDepartures(at: LngLat | null, radius: number, limit: number) {
  const list = useSignal<Departure[] | null>(null);
  const failed = useSignal(false);
  const key = at ? `${at[0].toFixed(5)},${at[1].toFixed(5)}` : '';
  useEffect(() => {
    if (!at) return;
    let alive = true;
    const ac = new AbortController();
    const load = () =>
      tools()
        .call(transitDeparturesTool, { near: at, radius, limit }, { signal: ac.signal })
        .then((d) => {
          if (!alive) return;
          list.value = d;
          failed.value = false;
        })
        .catch(() => {
          if (alive && list.value === null) failed.value = true;
        });
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
    return () => {
      alive = false;
      ac.abort();
      clearInterval(t);
    };
  }, [key, radius, limit]);
  return { list: list.value, failed: failed.value };
}

function DepartureTime({ d }: { d: Departure }) {
  const tz = region.value.timeZone;
  if (d.cancelled) return <span class="dep-time cancelled">בוטל</span>;
  const late = d.realtime ? delayMinutes(d.time, d.scheduledTime) : 0;
  return (
    <span class={`dep-time ${d.realtime ? 'live' : ''}`}>
      <span class="dep-when">
        {d.realtime && <Icon name="rss_feed" size={14} class="live-icon" />}
        {formatDeparture(d.time, Date.now(), tz)}
      </span>
      {late >= 2 && <span class="dep-late">{`${late} דק׳ איחור`}</span>}
      {!d.realtime && <span class="dep-sched">לפי לוח זמנים</span>}
      <span class="dep-clock">{formatClock(d.time, tz)}</span>
    </span>
  );
}

export function DepartureList({ departures, showStop }: { departures: Departure[]; showStop?: boolean }) {
  return (
    <ul class="departures">
      {departures.map((d, i) => (
        <li key={i} class={`departure ${d.cancelled ? 'is-cancelled' : ''}`}>
          <LineChip mode={d.mode} line={d.line} color={d.color} textColor={d.textColor} />
          <span class="dep-body">
            <span class="dep-headsign">{d.headsign ? `לכיוון ${d.headsign}` : d.agency}</span>
            {showStop && <span class="muted small">{[d.stop.name, d.stop.track && `רציף ${d.stop.track}`].filter(Boolean).join(' · ')}</span>}
          </span>
          <DepartureTime d={d} />
        </li>
      ))}
    </ul>
  );
}

function DeparturesBody({ at, radius, limit, showStop }: { at: LngLat | null; radius: number; limit: number; showStop?: boolean }) {
  const { list, failed } = useDepartures(at, radius, limit);
  if (failed) return <p class="muted small">לא הצלחנו לטעון זמני יציאה כרגע.</p>;
  if (list === null) return <div class="spinner" role="progressbar" aria-label="טוען זמני יציאה" />;
  if (!list.length) return <p class="muted small">אין יציאות בשעה הקרובה.</p>;
  return <DepartureList departures={list} showStop={showStop} />;
}

/** On a stop's place card: the next departures, refreshed every 30 seconds. */
function StopSection({ place }: { place: Place }) {
  if (!isTransitStop(place)) return null;
  return (
    <section class="place-section transit-section" aria-label="יציאות קרובות">
      <h3 class="section-title">
        <Icon name="departure_board" size={20} /> יציאות קרובות
      </h3>
      <DeparturesBody at={[place.lng, place.lat]} radius={120} limit={8} />
      <p class="muted tiny">זמני אמת מסומנים בירוק. מקור: Transitous.</p>
    </section>
  );
}

/** "Departures near me": all stops around the user (or the map centre). */
function NearbyView(_: ViewProps) {
  const u = userLocation.value;
  const c = map.getCenter();
  const at: LngLat = u ? [u.lng, u.lat] : [c.lng, c.lat];
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>יציאות קרובות</h2>
      </header>
      <p class="muted small">{u ? 'תחנות עד 400 מ׳ ממך.' : 'תחנות עד 400 מ׳ ממרכז המפה. הפעילו מיקום כדי לראות מה קרוב אליכם.'}</p>
      <DeparturesBody at={at} radius={400} limit={20} showStop />
    </div>
  );
}

export default defineFeature({
  id: 'transit',
  title: 'תחבורה ציבורית',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('departures', NearbyView);
    ctx.registerPlaceSection({ id: 'transit-departures', order: 5, Component: StopSection });
    ctx.registerMenuItem({ id: 'departures', label: 'יציאות קרובות', icon: 'departure_board', order: 30, run: () => open({ kind: 'departures' }) });
  },
});
