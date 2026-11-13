import type { LngLat } from '@nm/core';
import { getJson, type ToolContext } from '../define.ts';

/**
 * Weather from Open-Meteo (https://open-meteo.com): free for non-commercial use without a key,
 * data CC BY 4.0, CORS enabled, rate limits per client IP (so per user when called from the
 * browser). Answers are metric; the UI converts. Times are Unix seconds (UTC).
 */

export interface WeatherNow {
  time: number;
  temp: number | null;
  feels: number | null;
  humidity: number | null;
  dew: number | null;
  isDay: boolean;
  precip: number | null;
  code: number | null;
  cloud: number | null;
  pressure: number | null;
  wind: number | null;
  gust: number | null;
  dir: number | null;
  visibility: number | null;
  uv: number | null;
}

export interface WeatherHour {
  time: number;
  temp: number | null;
  feels: number | null;
  /** Chance of precipitation, %. */
  pop: number | null;
  /** mm in the hour. */
  precip: number | null;
  code: number | null;
  isDay: boolean;
  uv: number | null;
  uvClear: number | null;
  /** m. */
  visibility: number | null;
  wind: number | null;
  gust: number | null;
  dir: number | null;
  humidity: number | null;
  dew: number | null;
  pressure: number | null;
  /** Shortwave (global) solar radiation, W/m². */
  radiation: number | null;
  cloud: number | null;
}

export interface WeatherDay {
  /** Local midnight. */
  time: number;
  code: number | null;
  max: number | null;
  min: number | null;
  precip: number | null;
  pop: number | null;
  sunrise: number | null;
  sunset: number | null;
  uvMax: number | null;
  windMax: number | null;
  gustMax: number | null;
  dir: number | null;
  /** Seconds of daylight. */
  daylight: number | null;
}

export interface WeatherForecast {
  lng: number;
  lat: number;
  elevation: number | null;
  /** IANA time zone of the point ("Asia/Jerusalem"). */
  timeZone: string;
  current: WeatherNow;
  /** Every 15 minutes, the next 2 hours. */
  minutely: { time: number; precip: number | null }[];
  /** 24 hours back and 48 ahead. */
  hourly: WeatherHour[];
  /** 10 days from today. */
  daily: WeatherDay[];
}

type Series = Record<string, (number | null)[] | undefined>;

interface OmForecast {
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
  current?: Record<string, number | null>;
  minutely_15?: Series & { time?: number[] };
  hourly?: Series & { time?: number[] };
  daily?: Series & { time?: number[] };
}

const CURRENT = 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index,dew_point_2m';
const HOURLY = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,is_day,uv_index,uv_index_clear_sky,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,dew_point_2m,pressure_msl,shortwave_radiation,cloud_cover';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,daylight_duration';

/** Coordinates go out rounded to ~1 km: enough for a ~10 km model, and kinder to privacy. */
const coord = (v: number) => v.toFixed(2);

export async function weatherForecast(ctx: ToolContext, at: LngLat): Promise<WeatherForecast | null> {
  if (!ctx.config.weatherUrl) return null;
  const q = new URLSearchParams({
    latitude: coord(at[1]),
    longitude: coord(at[0]),
    current: CURRENT,
    minutely_15: 'precipitation',
    forecast_minutely_15: '8',
    hourly: HOURLY,
    past_hours: '24',
    forecast_hours: '48',
    daily: DAILY,
    forecast_days: '10',
    timezone: 'auto',
    timeformat: 'unixtime',
  });
  const d = await getJson<OmForecast>(ctx, `${ctx.config.weatherUrl}?${q}`, {}, 'open-meteo');
  return parseForecast(d, at);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const at = (s: Series | undefined, k: string, i: number) => num(s?.[k]?.[i]);

export function parseForecast(d: OmForecast, asked: LngLat): WeatherForecast {
  const c = d.current ?? {};
  const h = d.hourly ?? {};
  const day = d.daily ?? {};
  const m = d.minutely_15 ?? {};
  return {
    // Keep the asked point (Open-Meteo snaps to its grid).
    lng: asked[0],
    lat: asked[1],
    elevation: num(d.elevation),
    timeZone: d.timezone || 'GMT',
    current: {
      time: num(c.time) ?? Math.floor(Date.now() / 1000),
      temp: num(c.temperature_2m),
      feels: num(c.apparent_temperature),
      humidity: num(c.relative_humidity_2m),
      dew: num(c.dew_point_2m),
      isDay: c.is_day !== 0,
      precip: num(c.precipitation),
      code: num(c.weather_code),
      cloud: num(c.cloud_cover),
      pressure: num(c.pressure_msl),
      wind: num(c.wind_speed_10m),
      gust: num(c.wind_gusts_10m),
      dir: num(c.wind_direction_10m),
      visibility: num(c.visibility),
      uv: num(c.uv_index),
    },
    minutely: (m.time ?? []).map((time, i) => ({ time, precip: at(m, 'precipitation', i) })),
    hourly: (h.time ?? []).map((time, i) => ({
      time,
      temp: at(h, 'temperature_2m', i),
      feels: at(h, 'apparent_temperature', i),
      pop: at(h, 'precipitation_probability', i),
      precip: at(h, 'precipitation', i),
      code: at(h, 'weather_code', i),
      isDay: at(h, 'is_day', i) !== 0,
      uv: at(h, 'uv_index', i),
      uvClear: at(h, 'uv_index_clear_sky', i),
      visibility: at(h, 'visibility', i),
      wind: at(h, 'wind_speed_10m', i),
      gust: at(h, 'wind_gusts_10m', i),
      dir: at(h, 'wind_direction_10m', i),
      humidity: at(h, 'relative_humidity_2m', i),
      dew: at(h, 'dew_point_2m', i),
      pressure: at(h, 'pressure_msl', i),
      radiation: at(h, 'shortwave_radiation', i),
      cloud: at(h, 'cloud_cover', i),
    })),
    daily: (day.time ?? []).map((time, i) => ({
      time,
      code: at(day, 'weather_code', i),
      max: at(day, 'temperature_2m_max', i),
      min: at(day, 'temperature_2m_min', i),
      precip: at(day, 'precipitation_sum', i),
      pop: at(day, 'precipitation_probability_max', i),
      sunrise: at(day, 'sunrise', i),
      sunset: at(day, 'sunset', i),
      uvMax: at(day, 'uv_index_max', i),
      windMax: at(day, 'wind_speed_10m_max', i),
      gustMax: at(day, 'wind_gusts_10m_max', i),
      dir: at(day, 'wind_direction_10m_dominant', i),
      daylight: at(day, 'daylight_duration', i),
    })),
  };
}

// ---------- many points, for the map layers ----------

export interface WeatherGridPoint {
  lng: number;
  lat: number;
  /** Unix seconds of the first hour; one value per hour after it. */
  start: number;
  temp: (number | null)[];
  precip: (number | null)[];
  wind: (number | null)[];
  dir: (number | null)[];
  uv: (number | null)[];
  cloud: (number | null)[];
  vis: (number | null)[];
  code: (number | null)[];
}

const GRID_VARS = 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,uv_index,cloud_cover,visibility,weather_code';

/**
 * Hourly map-layer variables at up to 100 points in one call (8 variables keeps each point at
 * one call of Open-Meteo's budget). Points are sent as given; callers use a fixed lattice.
 */
export async function weatherGrid(ctx: ToolContext, points: LngLat[], hours = 48): Promise<WeatherGridPoint[]> {
  if (!ctx.config.weatherUrl || !points.length) return [];
  const q = new URLSearchParams({
    latitude: points.map((p) => p[1].toFixed(3)).join(','),
    longitude: points.map((p) => p[0].toFixed(3)).join(','),
    hourly: GRID_VARS,
    forecast_hours: String(hours),
    timezone: 'GMT',
    timeformat: 'unixtime',
  });
  const data = await getJson<OmForecast | OmForecast[]>(ctx, `${ctx.config.weatherUrl}?${q}`, {}, 'open-meteo', 20000);
  const list = Array.isArray(data) ? data : [data];
  return list.map((d, i) => parseGridPoint(d, points[i] ?? [d.longitude, d.latitude]));
}

export function parseGridPoint(d: OmForecast, asked: LngLat): WeatherGridPoint {
  const h = d.hourly ?? {};
  const n = h.time?.length ?? 0;
  const col = (k: string) => Array.from({ length: n }, (_, i) => at(h, k, i));
  return {
    lng: asked[0],
    lat: asked[1],
    start: h.time?.[0] ?? 0,
    temp: col('temperature_2m'),
    precip: col('precipitation'),
    wind: col('wind_speed_10m'),
    dir: col('wind_direction_10m'),
    uv: col('uv_index'),
    cloud: col('cloud_cover'),
    vis: col('visibility'),
    code: col('weather_code'),
  };
}
