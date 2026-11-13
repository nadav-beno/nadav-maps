import { useEffect, useState } from 'preact/hooks';
import type { LngLat, Units } from '@nm/core';
import {
  beaufort,
  feelsLikeNote,
  fmtPrecip,
  fmtPressure,
  fmtTemp,
  fmtVisibility,
  fmtWind,
  moonPhase,
  uvBand,
  visibilityLabel,
  weatherIcon,
  weatherScene,
  weatherText,
  windFrom,
  windLabel,
} from '@nm/core';
import { back, Icon, providers, units, type ViewProps } from '@nm/core/app';
import { airQuality, aqiLabel, reverseGeocode, tools, type AirQuality, type WeatherForecast, type WeatherHour } from '@nm/tools';
import { forecastAt } from './data.ts';
import { clock, dayLabel, hourLabel } from './format.ts';
import { showWeatherLayer } from './layers.tsx';

export interface WeatherViewProps {
  at: LngLat;
  name?: string;
}

/** The full weather screen for a point, laid out like a phone weather app. */
export function WeatherView({ view }: ViewProps<WeatherViewProps>) {
  const at = view.props?.at;
  const [f, setF] = useState<WeatherForecast | null | undefined>(undefined);
  const [err, setErr] = useState(false);
  const [name, setName] = useState(view.props?.name ?? '');
  const key = at ? `${at[0].toFixed(2)},${at[1].toFixed(2)}` : '';
  useEffect(() => {
    if (!at) return;
    let live = true;
    setF(undefined);
    setErr(false);
    forecastAt(at)
      .then((r) => live && setF(r))
      .catch(() => live && setErr(true));
    if (!view.props?.name) {
      tools()
        .call(reverseGeocode, { lng: at[0], lat: at[1] })
        .then((p) => live && p && setName(cityOf(p.address, !!p.countryCode) || p.name))
        .catch(() => {});
    } else setName(view.props.name);
    return () => {
      live = false;
    };
  }, [key, view.props?.name]);

  return (
    <div class="view weather-view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>מזג אוויר</h2>
      </header>
      {!at && <p class="muted">אין מיקום להצגה.</p>}
      {at && err && <p class="muted">אין כרגע חיבור לנתוני מזג האוויר. נסו שוב בעוד רגע.</p>}
      {at && !err && f === undefined && <p class="muted" aria-busy="true">טוען את מזג האוויר…</p>}
      {at && f === null && <p class="muted">נתוני מזג אוויר כבויים באתר הזה.</p>}
      {f && <Forecast f={f} name={name} u={units.value} />}
    </div>
  );
}

/** The locality from a one-line address ("רחוב, תל אביב-יפו, ישראל" → "תל אביב-יפו"). */
function cityOf(address: string | undefined, endsWithCountry: boolean): string {
  if (!address) return '';
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (endsWithCountry && parts.length >= 2) parts.pop();
  return parts[parts.length - 1] ?? '';
}

function Forecast({ f, name, u }: { f: WeatherForecast; name: string; u: Units }) {
  const tz = f.timeZone;
  const now = f.current.time;
  const today = f.daily[0];
  const scene = weatherScene(f.current.code, f.current.isDay);
  const next = f.hourly.filter((h) => h.time >= now - 3599);
  return (
    <>
      <section class={`wx-hero wx-scene-${scene}`} aria-label="מזג האוויר עכשיו">
        {name && <div class="wx-place">{name}</div>}
        <div class="wx-now">
          <Icon name={weatherIcon(f.current.code, f.current.isDay)} size={44} />
          <span class="wx-temp">{fmtTemp(f.current.temp, u)}</span>
        </div>
        <div class="wx-cond">{weatherText(f.current.code, f.current.isDay)}</div>
        {today && (
          <div class="wx-hl">
            מקס׳ {fmtTemp(today.max, u)} · מינ׳ {fmtTemp(today.min, u)}
          </div>
        )}
      </section>
      <RainSoon f={f} />
      <Hourly f={f} hours={next.slice(0, 25)} u={u} />
      <Daily f={f} u={u} />
      <Tiles f={f} next={next} u={u} />
      <p class="muted tiny wx-credit">
        נתונים: Open-Meteo (CC BY 4.0), מודלים מטאורולוגיים ברזולוציה של כ-10 ק״מ. עודכן {clock(now, tz)}.
      </p>
      <button class="chip wx-map-btn" onClick={() => showWeatherLayer('temp')}>
        <Icon name="layers" size={18} />
        מזג אוויר על המפה
      </button>
    </>
  );
}

// ---------- rain in the next two hours ----------

function RainSoon({ f }: { f: WeatherForecast }) {
  const m = f.minutely.filter((x) => x.time >= f.current.time - 899);
  const wet = (x: { precip: number | null }) => (x.precip ?? 0) >= 0.05;
  if (!m.some(wet)) return null;
  const nowWet = wet(m[0]) || (f.current.precip ?? 0) >= 0.05;
  const mins = (t: number) => Math.max(15, Math.round((t - f.current.time) / 60 / 5) * 5);
  let text: string;
  if (nowWet) {
    const stop = m.find((x) => !wet(x));
    text = stop ? `הגשם צפוי להיפסק בעוד כ-${mins(stop.time)} דקות.` : 'גשם בשעתיים הקרובות.';
  } else {
    const start = m.find(wet)!;
    text = `גשם צפוי להתחיל בעוד כ-${mins(start.time)} דקות.`;
  }
  const max = Math.max(1, ...m.map((x) => x.precip ?? 0));
  return (
    <section class="wx-card wx-rain" aria-label="גשם בשעתיים הקרובות">
      <h3 class="wx-card-title">
        <Icon name="umbrella" size={16} /> גשם קרוב
      </h3>
      <p>{text}</p>
      <div class="wx-rain-bars" aria-hidden="true">
        {m.map((x) => (
          <span key={x.time} style={{ height: `${Math.max(4, ((x.precip ?? 0) / max) * 100)}%`, opacity: wet(x) ? 1 : 0.25 }} />
        ))}
      </div>
      <div class="wx-rain-axis muted tiny">
        <span>עכשיו</span>
        <span>בעוד שעה</span>
        <span>בעוד שעתיים</span>
      </div>
    </section>
  );
}

// ---------- hourly ----------

type HourItem = { kind: 'hour'; h: WeatherHour } | { kind: 'sun'; time: number; rise: boolean };

function Hourly({ f, hours, u }: { f: WeatherForecast; hours: WeatherHour[]; u: Units }) {
  if (!hours.length) return null;
  const tz = f.timeZone;
  const items: HourItem[] = hours.map((h) => ({ kind: 'hour', h }));
  const first = hours[0].time, last = hours[hours.length - 1].time;
  for (const d of f.daily.slice(0, 3))
    for (const [t, rise] of [[d.sunrise, true], [d.sunset, false]] as const) {
      if (t !== null && t > first && t < last) items.push({ kind: 'sun', time: t, rise });
    }
  items.sort((a, b) => (a.kind === 'hour' ? a.h.time : a.time) - (b.kind === 'hour' ? b.h.time : b.time));
  return (
    <section class="wx-card" aria-label="תחזית שעתית">
      <h3 class="wx-card-title">
        <Icon name="schedule" size={16} /> שעה אחר שעה
      </h3>
      <div class="wx-hours" role="list">
        {items.map((it, i) =>
          it.kind === 'hour' ? (
            <div class="wx-hour" role="listitem" key={it.h.time}>
              <span class="wx-hour-t">{i === 0 ? 'עכשיו' : hourLabel(it.h.time, tz)}</span>
              <Icon name={weatherIcon(it.h.code, it.h.isDay)} size={26} />
              <span class="wx-pop">{(it.h.pop ?? 0) >= 20 ? `${Math.round(it.h.pop!)}%` : ' '}</span>
              <span class="wx-hour-v">{i === 0 ? fmtTemp(f.current.temp, u) : fmtTemp(it.h.temp, u)}</span>
            </div>
          ) : (
            <div class="wx-hour wx-sun" role="listitem" key={`s${it.time}`}>
              <span class="wx-hour-t">{clock(it.time, tz)}</span>
              <Icon name="wb_twilight" size={26} />
              <span class="wx-pop"> </span>
              <span class="wx-hour-v">{it.rise ? 'זריחה' : 'שקיעה'}</span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

// ---------- 10 days ----------

function Daily({ f, u }: { f: WeatherForecast; u: Units }) {
  const [open, setOpen] = useState<number | null>(null);
  const days = f.daily.filter((d) => d.min !== null && d.max !== null);
  if (!days.length) return null;
  const lo = Math.min(...days.map((d) => d.min!)), hi = Math.max(...days.map((d) => d.max!));
  const span = Math.max(1, hi - lo);
  return (
    <section class="wx-card" aria-label="תחזית ל-10 ימים">
      <h3 class="wx-card-title">
        <Icon name="calendar_month" size={16} /> {days.length} ימים
      </h3>
      <ul class="wx-days">
        {days.map((d, i) => (
          <li key={d.time}>
            <button class="wx-day" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              <span class="wx-day-name">{dayLabel(d.time, f.timeZone, i)}</span>
              <span class="wx-day-icon">
                <Icon name={weatherIcon(d.code, true)} size={24} />
                {(d.pop ?? 0) >= 20 && <span class="wx-pop">{Math.round(d.pop!)}%</span>}
              </span>
              <span class="wx-day-min">{fmtTemp(d.min, u)}</span>
              <span class="wx-bar" aria-hidden="true">
                <span class="wx-bar-fill" style={{ insetInlineStart: `${((d.min! - lo) / span) * 100}%`, width: `${Math.max(4, ((d.max! - d.min!) / span) * 100)}%` }} />
                {i === 0 && f.current.temp !== null && (
                  <span class="wx-bar-now" style={{ insetInlineStart: `${Math.min(100, Math.max(0, ((f.current.temp - lo) / span) * 100))}%` }} />
                )}
              </span>
              <span class="wx-day-max">{fmtTemp(d.max, u)}</span>
            </button>
            {open === i && (
              <p class="wx-day-more muted small">
                {weatherText(d.code)}. גשם {fmtPrecip(d.precip, u)}, UV מקסימלי {d.uvMax === null ? '–' : Math.round(d.uvMax)}, רוח עד {fmtWind(d.gustMax ?? d.windMax, u)}
                {d.dir !== null ? ` (${windFrom(d.dir)})` : ''}. זריחה {d.sunrise ? clock(d.sunrise, f.timeZone) : '–'}, שקיעה {d.sunset ? clock(d.sunset, f.timeZone) : '–'}.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- tiles ----------

interface TileDef {
  id: string;
  icon: string;
  title: string;
  value: string;
  sub?: string;
  extra?: preact.ComponentChildren;
  chart?: { values: (number | null)[]; fmt: (v: number) => string; color: string };
}

function Tiles({ f, next, u }: { f: WeatherForecast; next: WeatherHour[]; u: Units }) {
  const [open, setOpen] = useState<string | null>(null);
  const [aq, setAq] = useState<AirQuality | null>(null);
  const hasAir = !!providers.value.airQualityUrl;
  useEffect(() => {
    if (!hasAir) return;
    let live = true;
    tools()
      .call(airQuality, { points: [[f.lng, f.lat]] })
      .then((r) => live && setAq(r[0] ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [f.lng, f.lat, hasAir]);

  const c = f.current;
  const tz = f.timeZone;
  const day = next.slice(0, 24);
  const series = (k: keyof WeatherHour) => day.map((h) => (typeof h[k] === 'number' ? (h[k] as number) : null));
  const today = f.daily[0];
  const tiles: TileDef[] = [];

  // UV
  const uv = c.uv ?? next[0]?.uv ?? 0;
  const band = uvBand(Math.round(uv));
  const todayHours = f.hourly.filter((h) => today && h.time >= today.time && h.time < today.time + 86400);
  const peak = todayHours.reduce<WeatherHour | null>((a, h) => ((h.uv ?? -1) > (a?.uv ?? -1) ? h : a), null);
  const safe = peak && (peak.uv ?? 0) >= 3 ? todayHours.find((h) => h.time > peak.time && h.time >= c.time && (h.uv ?? 0) < 3) : undefined;
  tiles.push({
    id: 'uv',
    icon: 'sunny',
    title: 'מדד UV',
    value: `${Math.round(uv)} · ${band.label}`,
    sub: [peak && peak.uv !== null ? `שיא היום ${Math.round(peak.uv)} ב-${clock(peak.time, tz)}.` : '', safe ? `מתחת ל-3 מ-${clock(safe.time, tz)}.` : '', band.advice].filter(Boolean).join(' '),
    extra: (
      <span class="wx-uvbar" aria-hidden="true">
        <span class="wx-uvdot" style={{ insetInlineStart: `${Math.min(100, (uv / 11) * 100)}%`, background: band.color }} />
      </span>
    ),
    chart: { values: series('uv'), fmt: (v) => String(Math.round(v)), color: '#f8b600' },
  });

  // Sun
  if (today) {
    const tomorrow = f.daily[1];
    const afterSunset = today.sunset !== null && c.time > today.sunset;
    tiles.push({
      id: 'sun',
      icon: 'wb_twilight',
      title: afterSunset ? 'זריחה' : 'שקיעה',
      value: afterSunset ? clock(tomorrow?.sunrise ?? today.sunrise ?? 0, tz) : clock(today.sunset ?? 0, tz),
      sub: `זריחה ${today.sunrise ? clock(today.sunrise, tz) : '–'} · שקיעה ${today.sunset ? clock(today.sunset, tz) : '–'}${today.daylight ? ` · ${Math.floor(today.daylight / 3600)}:${String(Math.round((today.daylight % 3600) / 60)).padStart(2, '0')} שעות אור` : ''}`,
      extra: <SunArc rise={today.sunrise} set={today.sunset} now={c.time} />,
    });
  }

  // Wind
  tiles.push({
    id: 'wind',
    icon: 'air',
    title: 'רוח',
    value: fmtWind(c.wind, u),
    sub: `${windLabel(c.wind)}${c.dir !== null ? `, ${windFrom(c.dir)}` : ''} (בופור ${beaufort(c.wind ?? 0)}). משבים עד ${fmtWind(c.gust, u)}.`,
    extra: <Compass dir={c.dir} />,
    chart: { values: series('wind'), fmt: (v) => fmtWind(v, u), color: '#63e6be' },
  });

  // Precipitation
  const past = f.hourly.filter((h) => h.time < c.time && h.time >= c.time - 86400).reduce((s, h) => s + (h.precip ?? 0), 0);
  const ahead = day.reduce((s, h) => s + (h.precip ?? 0), 0);
  tiles.push({
    id: 'precip',
    icon: 'water_drop',
    title: 'משקעים',
    value: fmtPrecip(past, u),
    sub: `ב-24 השעות האחרונות. צפויים ${fmtPrecip(ahead, u)} ב-24 השעות הקרובות.`,
    chart: { values: series('precip'), fmt: (v) => fmtPrecip(v, u), color: '#339af0' },
  });

  // Feels like
  if (c.feels !== null && c.temp !== null) {
    tiles.push({
      id: 'feels',
      icon: 'thermostat',
      title: 'מרגיש כמו',
      value: fmtTemp(c.feels, u),
      sub: feelsLikeNote(c.temp, c.feels, c.humidity ?? 0, c.wind ?? 0),
      chart: { values: series('feels'), fmt: (v) => fmtTemp(v, u), color: '#f6743a' },
    });
  }

  // Humidity
  tiles.push({
    id: 'humidity',
    icon: 'humidity_percentage',
    title: 'לחות',
    value: c.humidity === null ? '–' : `${Math.round(c.humidity)}%`,
    sub: `נקודת הטל עכשיו ${fmtTemp(c.dew, u)}.`,
    chart: { values: series('humidity'), fmt: (v) => `${Math.round(v)}%`, color: '#4dabf7' },
  });

  // Visibility
  tiles.push({
    id: 'visibility',
    icon: 'visibility',
    title: 'ראות',
    value: fmtVisibility(c.visibility, u),
    sub: `${visibilityLabel(c.visibility)}.`,
    chart: { values: series('visibility'), fmt: (v) => fmtVisibility(v, u), color: '#adb5bd' },
  });

  // Pressure
  const ago = f.hourly.find((h) => h.time >= c.time - 3 * 3600 - 1800 && h.time <= c.time - 3 * 3600 + 1800);
  const dp = c.pressure !== null && ago?.pressure !== null && ago?.pressure !== undefined ? c.pressure - ago.pressure : 0;
  tiles.push({
    id: 'pressure',
    icon: 'compress',
    title: 'לחץ ברומטרי',
    value: fmtPressure(c.pressure, u),
    sub: dp > 1 ? 'עולה ב-3 השעות האחרונות.' : dp < -1 ? 'יורד ב-3 השעות האחרונות.' : 'יציב ב-3 השעות האחרונות.',
    chart: { values: series('pressure'), fmt: (v) => fmtPressure(v, u), color: '#845ef7' },
  });

  // Solar radiation
  const rad = next[0]?.radiation ?? null;
  const radMax = Math.max(0, ...todayHours.map((h) => h.radiation ?? 0));
  const uvClear = next[0]?.uvClear ?? null;
  tiles.push({
    id: 'radiation',
    icon: 'bolt',
    title: 'קרינת שמש',
    value: rad === null ? '–' : `${Math.round(rad)} W/m²`,
    sub: `שיא היום ${Math.round(radMax)} W/m².${uvClear !== null ? ` UV בשמיים בהירים: ${Math.round(uvClear)}.` : ''}`,
    chart: { values: series('radiation'), fmt: (v) => `${Math.round(v)}`, color: '#fcc419' },
  });

  // Air quality (the same data as the air quality layer)
  if (hasAir) {
    tiles.push({
      id: 'air',
      icon: 'eco',
      title: 'איכות אוויר',
      value: aq?.aqi === null || aq?.aqi === undefined ? '–' : `${Math.round(aq.aqi)} · ${aqiLabel(aq.aqi)}`,
      sub: aq ? `PM2.5: ${aq.pm25 === null ? '–' : Math.round(aq.pm25)} · PM10: ${aq.pm10 === null ? '–' : Math.round(aq.pm10)} מק״ג/מ״ק (המדד האירופי).` : 'טוען…',
    });
  }

  // Moon
  const moon = moonPhase(c.time * 1000);
  tiles.push({
    id: 'moon',
    icon: 'bedtime',
    title: 'ירח',
    value: moon.name,
    sub: `${Math.round(moon.illumination * 100)}% מואר.`,
    extra: <Moon phase={moon.phase} />,
  });

  return (
    <div class="wx-tiles">
      {tiles.map((t) => (
        <section key={t.id} class={`wx-tile${open === t.id ? ' open' : ''}`} aria-label={t.title}>
          <button class="wx-tile-btn" aria-expanded={t.chart ? open === t.id : undefined} onClick={() => t.chart && setOpen(open === t.id ? null : t.id)}>
            <span class="wx-card-title">
              <Icon name={t.icon} size={16} /> {t.title}
            </span>
            <span class="wx-tile-v">{t.value}</span>
            {t.extra}
            {t.sub && <span class="wx-tile-sub">{t.sub}</span>}
          </button>
          {open === t.id && t.chart && <Chart times={day.map((h) => h.time)} tz={tz} {...t.chart} />}
        </section>
      ))}
    </div>
  );
}

/** 24 hours of one variable as a line, with a few hour ticks. */
function Chart({ values, times, tz, fmt, color }: { values: (number | null)[]; times: number[]; tz: string; fmt: (v: number) => string; color: string }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const W = 300, H = 90, P = 14;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = hi - lo || 1;
  const x = (i: number) => P + (i / (values.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  const d = values.map((v, i) => (v === null ? '' : `${i === 0 || values[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const maxI = values.indexOf(hi);
  return (
    <svg class="wx-chart" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`24 השעות הקרובות: בין ${fmt(lo)} ל-${fmt(hi)}`} dir="ltr">
      <path d={d} fill="none" stroke={color} stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={x(maxI)} cy={y(hi)} r="3.5" fill={color} />
      <text x={x(maxI)} y={Math.max(10, y(hi) - 6)} text-anchor="middle" class="wx-chart-l">
        {fmt(hi)}
      </text>
      {times.map((t, i) =>
        i % 6 === 0 ? (
          <text key={t} x={x(i)} y={H + 10} text-anchor="middle" class="wx-chart-t">
            {hourLabel(t, tz)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function Compass({ dir }: { dir: number | null }) {
  return (
    <svg class="wx-compass" viewBox="-30 -30 60 60" aria-hidden="true">
      <circle r="26" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" />
      <text y="-17" text-anchor="middle" class="wx-compass-n">
        צ
      </text>
      {dir !== null && (
        // The arrow points where the wind blows to.
        <g transform={`rotate(${dir + 180})`}>
          <path d="M0,-20 L6,-6 L1.5,-8 L1.5,18 L-1.5,18 L-1.5,-8 L-6,-6 Z" fill="currentColor" />
        </g>
      )}
    </svg>
  );
}

function SunArc({ rise, set, now }: { rise: number | null; set: number | null; now: number }) {
  if (rise === null || set === null) return null;
  const t = Math.min(1, Math.max(0, (now - rise) / (set - rise || 1)));
  const up = now >= rise && now <= set;
  // dir=ltr arc: sunrise at the left like a horizon seen facing south.
  const a = Math.PI * (1 - t);
  return (
    <svg class="wx-sunarc" viewBox="0 0 100 40" aria-hidden="true">
      <path d="M5,36 A45,32 0 0 1 95,36" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="3 3" />
      <line x1="0" y1="36" x2="100" y2="36" stroke="currentColor" stroke-opacity="0.3" />
      {up && <circle cx={50 + 45 * Math.cos(a)} cy={36 - 32 * Math.sin(a)} r="4.5" fill="#fcc419" />}
    </svg>
  );
}

/** The moon's lit part (northern hemisphere view). */
function Moon({ phase }: { phase: number }) {
  const r = 20;
  const rx = Math.abs(Math.cos(2 * Math.PI * phase)) * r;
  const waxing = phase < 0.5;
  const outer = waxing ? 1 : 0;
  const inner = waxing ? (phase < 0.25 ? 0 : 1) : phase < 0.75 ? 0 : 1;
  return (
    <svg class="wx-moon" viewBox="-24 -24 48 48" aria-hidden="true">
      <circle r={r} fill="currentColor" fill-opacity="0.18" />
      <path d={`M0,${-r} A${r},${r} 0 0 ${outer} 0,${r} A${rx.toFixed(2)},${r} 0 0 ${inner} 0,${-r} Z`} fill="#f1f3f5" stroke="#ced4da" stroke-width="0.5" />
    </svg>
  );
}
