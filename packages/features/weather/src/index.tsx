import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { LngLat, Place } from '@nm/core';
import { fmtTemp, uvBand, weatherIcon, weatherText } from '@nm/core';
import { defineFeature, Icon, open, registerLayerSection, units, userLocation, type FeatureContext } from '@nm/core/app';
import type { WeatherForecast } from '@nm/tools';
import { forecastAt, hasWeather, nearestGridPoint, seriesAt } from './data.ts';
import { initWeatherLayers, WeatherLayerSection, WeatherTimeBar } from './layers.tsx';
import { WeatherView, type WeatherViewProps } from './view.tsx';

let map: FeatureContext['map'];

export function openWeather(at: LngLat, name?: string, opts: { replace?: boolean } = {}) {
  const props: WeatherViewProps & { url: unknown } = { at, name, url: { panel: 'weather', at } };
  open({ kind: 'weather', props: props as unknown as Record<string, unknown> }, opts);
}

const here = (): LngLat => {
  const u = userLocation.peek();
  if (u) return [u.lng, u.lat];
  const c = map.getCenter();
  return [c.lng, c.lat];
};

// ---------- the chip on the map: temperature at the map centre ----------

const chip = signal<{ temp: number | null; code: number | null; at: LngLat } | null>(null);
let chipSeq = 0;

async function refreshChip() {
  if (!hasWeather()) return;
  const c = map.getCenter();
  const at: LngLat = [c.lng, c.lat];
  const s = ++chipSeq;
  try {
    const p = await nearestGridPoint(at);
    if (s !== chipSeq || !p) return;
    const t = Math.floor(Date.now() / 1000);
    chip.value = { temp: seriesAt(p, 'temp', t), code: seriesAt(p, 'code', t), at };
  } catch {
    /* keep the last value */
  }
}

function WeatherChip() {
  const c = chip.value;
  if (!c || c.temp === null) return null;
  const hour = new Date().getHours();
  const day = hour >= 6 && hour < 18;
  return (
    <button class="ctrl wx-chip" aria-label={`מזג אוויר: ${fmtTemp(c.temp, units.value)}, ${weatherText(c.code, day)}`} title="מזג אוויר" onClick={() => openWeather(c.at)}>
      <Icon name={weatherIcon(c.code, day)} size={18} />
      <span>{fmtTemp(c.temp, units.value)}</span>
    </button>
  );
}

// ---------- a row on the place card, and a card on the home screen ----------

function useForecast(at: LngLat | null): WeatherForecast | null {
  const [f, setF] = useState<WeatherForecast | null>(null);
  const key = at ? `${at[0].toFixed(2)},${at[1].toFixed(2)}` : '';
  useEffect(() => {
    if (!at) return;
    let live = true;
    forecastAt(at)
      .then((r) => live && setF(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return f;
}

function WeatherSummary({ f }: { f: WeatherForecast }) {
  const c = f.current;
  const d = f.daily[0];
  return (
    <>
      <Icon name={weatherIcon(c.code, c.isDay)} size={28} />
      <span class="li-body">
        <span class="li-title">
          {fmtTemp(c.temp, units.value)} · {weatherText(c.code, c.isDay)}
        </span>
        <span class="li-sub">
          {d ? `מקס׳ ${fmtTemp(d.max, units.value)} מינ׳ ${fmtTemp(d.min, units.value)} · ` : ''}UV {Math.round(c.uv ?? 0)} ({uvBand(Math.round(c.uv ?? 0)).label})
          {(d?.pop ?? 0) >= 30 ? ` · ${Math.round(d!.pop!)}% גשם` : ''}
        </span>
      </span>
      <Icon name="chevron_left" size={20} />
    </>
  );
}

function PlaceWeather({ place }: { place: Place }) {
  const f = useForecast([place.lng, place.lat]);
  if (!f) return null;
  return (
    <section class="wx-place-row" aria-label="מזג אוויר במקום">
      <button class="list-item" onClick={() => openWeather([place.lng, place.lat], place.name)}>
        <WeatherSummary f={f} />
      </button>
    </section>
  );
}

function HomeWeather() {
  const [at] = useState<LngLat>(() => here());
  const f = useForecast(at);
  if (!f) return null;
  return (
    <section class="home-section wx-home" aria-label="מזג אוויר">
      <h3>{userLocation.value ? 'מזג אוויר כאן' : 'מזג אוויר במפה'}</h3>
      <button class="list-item" onClick={() => openWeather(at)}>
        <WeatherSummary f={f} />
      </button>
    </section>
  );
}

export default defineFeature({
  id: 'weather',
  title: 'מזג אוויר',
  description: 'תחזית כמו באפליקציית מזג אוויר (שעתית, 10 ימים, UV, ראות, רוח, קרינה) ושכבות מזג אוויר על המפה',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    if (!hasWeather()) return;
    ctx.registerView('weather', WeatherView);
    ctx.registerPlaceSection({ id: 'weather', order: 8, Component: PlaceWeather });
    ctx.registerHomeSection({ id: 'weather', order: 15, Component: HomeWeather });
    ctx.registerSlot('controls', WeatherChip, 20);
    ctx.registerSlot('overlay', WeatherTimeBar, 5);
    registerLayerSection({ id: 'weather', order: 10, Component: WeatherLayerSection });
    ctx.registerMenuItem({ id: 'weather', label: 'מזג אוויר', icon: 'partly_cloudy_day', order: 32, run: () => openWeather(here()) });
    initWeatherLayers(ctx.map, ctx.onStyle);
    let last: LngLat | null = null;
    const moved = () => {
      const c = ctx.map.getCenter();
      if (last && Math.abs(c.lng - last[0]) < 0.1 && Math.abs(c.lat - last[1]) < 0.1) return;
      last = [c.lng, c.lat];
      void refreshChip();
    };
    ctx.map.on('moveend', moved);
    ctx.map.once('load', moved);
    if (ctx.map.loaded()) moved();
    // Hourly refresh of the chip while the app stays open.
    setInterval(() => void refreshChip(), 30 * 60_000);
    const u = ctx.initialUrl;
    if (u.panel === 'weather') {
      const c = ctx.map.getCenter();
      openWeather(u.at ?? [c.lng, c.lat]);
    }
  },
});
