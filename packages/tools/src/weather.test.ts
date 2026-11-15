import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { omForecast, omGrid, omMarine } from '../../../e2e/weather-fixture.ts';
import { createToolClient } from './client.ts';
import { marineForecastTool, weatherForecastTool, weatherGridTool } from './tools/index.ts';
import { ProviderError } from './define.ts';

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

  it('reads the sea at the nearest sea cell, and nothing far inland', async () => {
    let url = '';
    let body: unknown = omMarine();
    let status = 200;
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string) => {
      url = u;
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
    const m = await client.call(marineForecastTool, { at: [34.78, 32.08] });
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://marine-api.open-meteo.com/v1/marine?')).toBe(true);
    expect(q.get('cell_selection')).toBe('sea');
    expect(m?.current.wave).toBe(0.8);
    expect(m?.current.sea).toBe(24.6);
    expect(m?.hourly).toHaveLength(48);
    expect(m?.daily).toHaveLength(7);
    expect(m!.offshore).toBeGreaterThan(2000);
    expect(m!.offshore).toBeLessThan(4000);
    // Nearest sea cell 50 km away: not a coastal point.
    body = { ...omMarine(), longitude: 34.78 + 0.5 };
    expect(await client.call(marineForecastTool, { at: [34.78, 32.08] }, { cache: false })).toBeNull();
    // The API answers 400 when there is no sea cell at all.
    body = { error: true, reason: 'No data is available for this location' };
    status = 400;
    expect(await client.call(marineForecastTool, { at: [35.2, 31.8] }, { cache: false })).toBeNull();
    status = 500;
    await expect(client.call(marineForecastTool, { at: [35.2, 31.8] }, { cache: false })).rejects.toBeInstanceOf(ProviderError);
  });
});
