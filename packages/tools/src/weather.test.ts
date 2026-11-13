import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { omForecast, omGrid } from '../../../e2e/weather-fixture.ts';
import { createToolClient } from './client.ts';
import { weatherForecastTool, weatherGridTool } from './tools/index.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('weather tools (Open-Meteo)', () => {
  it('asks for a phone-app forecast with rounded coordinates and normalises it', async () => {
    let url = '';
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string) => {
      url = u;
      return json(omForecast());
    }) as typeof fetch);
    const f = await client.call(weatherForecastTool, { at: [34.78123, 32.08456] });
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://api.open-meteo.com/v1/forecast?')).toBe(true);
    expect(q.get('latitude')).toBe('32.08');
    expect(q.get('longitude')).toBe('34.78');
    expect(q.get('timeformat')).toBe('unixtime');
    expect(q.get('timezone')).toBe('auto');
    expect(q.get('hourly')).toContain('uv_index_clear_sky');
    expect(q.get('hourly')).toContain('visibility');
    expect(q.get('minutely_15')).toBe('precipitation');
    expect(f?.timeZone).toBe('Asia/Jerusalem');
    expect(f?.lng).toBe(34.78123);
    expect(f?.current.temp).toBe(23.4);
    expect(f?.current.isDay).toBe(true);
    expect(f?.current.uv).toBe(5.8);
    expect(f?.hourly).toHaveLength(72);
    expect(f?.daily).toHaveLength(10);
    expect(f?.daily[0].sunrise).toBeGreaterThan(f!.daily[0].time);
    expect(f?.minutely).toHaveLength(8);
  });

  it('is off without a URL', async () => {
    const client = createToolClient({ ...DEFAULT_PROVIDERS, weatherUrl: '' }, 'he', (async () => json({})) as typeof fetch);
    expect(await client.call(weatherForecastTool, { at: [34.78, 32.08] })).toBeNull();
    expect(await client.call(weatherGridTool, { points: [[34.78, 32.08]] })).toEqual([]);
  });

  it('reads many points for the map layers in one call', async () => {
    let url = '';
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string) => {
      url = u;
      const p = new URL(u).searchParams;
      return json(omGrid(p.get('latitude')!.split(',').map(Number), p.get('longitude')!.split(',').map(Number)));
    }) as typeof fetch);
    const r = await client.call(weatherGridTool, { points: [[34.75, 32], [35, 32.25]] });
    const q = new URL(url).searchParams;
    expect(q.get('hourly')!.split(',')).toHaveLength(8);
    expect(q.get('forecast_hours')).toBe('48');
    expect(r).toHaveLength(2);
    expect(r[1].lng).toBe(35);
    expect(r[0].temp).toHaveLength(48);
    expect(r[0].start).toBeGreaterThan(0);
  });
});
