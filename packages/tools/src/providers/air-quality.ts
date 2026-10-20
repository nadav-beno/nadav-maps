import type { LngLat } from '@nm/core';
import { getJson, type ToolContext } from '../define.ts';

export interface AirQuality {
  lng: number;
  lat: number;
  /** European AQI (0-20 good ... 100+ extremely poor). */
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  /** ISO time of the reading (hourly model data). */
  time?: string;
}

interface OmPoint {
  latitude: number;
  longitude: number;
  current?: { time?: string; european_aqi?: number | null; pm2_5?: number | null; pm10?: number | null };
}

/** Current air quality at up to 50 points in one call (Open-Meteo accepts comma-separated coordinates). */
export async function airQualityAt(ctx: ToolContext, points: LngLat[]): Promise<AirQuality[]> {
  if (!ctx.config.airQualityUrl) return [];
  const q = new URLSearchParams({
    latitude: points.map((p) => p[1].toFixed(3)).join(','),
    longitude: points.map((p) => p[0].toFixed(3)).join(','),
    current: 'european_aqi,pm2_5,pm10',
    timezone: 'GMT',
  });
  const data = await getJson<OmPoint | OmPoint[]>(ctx, `${ctx.config.airQualityUrl}?${q}`, {}, 'open-meteo');
  const list = Array.isArray(data) ? data : [data];
  return list.map((d, i) => ({
    // Open-Meteo snaps to its grid; keep the asked point so the layer stays regular.
    lng: points[i]?.[0] ?? d.longitude,
    lat: points[i]?.[1] ?? d.latitude,
    aqi: d.current?.european_aqi ?? null,
    pm25: d.current?.pm2_5 ?? null,
    pm10: d.current?.pm10 ?? null,
    time: d.current?.time,
  }));
}

/** Hebrew label for a European AQI value. */
export function aqiLabel(aqi: number | null): string {
  if (aqi === null) return 'אין נתון';
  if (aqi <= 20) return 'טובה';
  if (aqi <= 40) return 'סבירה';
  if (aqi <= 60) return 'בינונית';
  if (aqi <= 80) return 'גרועה';
  if (aqi <= 100) return 'גרועה מאוד';
  return 'גרועה ביותר';
}
