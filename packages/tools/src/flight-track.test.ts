import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { currentFlight, mergeTraces, parseTrace, thin, traceUrls, flightTrack } from './providers/flight-track.ts';
import { flightTrackTool } from './tools/index.ts';
import { relayRoute } from './flights-proxy.ts';

const T0 = 1_794_000_000; // seconds
type P = [number, number, number, number | 'ground' | null, number?, number?, number?];
const trace = (points: P[], timestamp = T0) => ({ icao: '06a10f', timestamp, trace: points });

// Earlier flight that landed, a night at the gate, then today's flight: taxi, takeoff, cruise.
const DAY: P[] = [
  [0, 25.0, 51.0, 'ground'],
  [60, 25.1, 51.1, 2000],
  [3600, 30.0, 40.0, 37000],
  [7000, 32.0, 34.9, 3000],
  [7200, 32.01, 34.88, 'ground'],
  [7300, 32.011, 34.881, 'ground'],
  // Gate, then the next morning's taxi and takeoff.
  [40000, 32.012, 34.882, 'ground'],
  [40300, 32.0, 34.87, 'ground'],
  [40360, 32.05, 34.8, 1500],
  [41000, 33.0, 33.0, 30000],
  [42000, 36.0, 30.0, 38000],
];

describe('flight track', () => {
  it('builds the trace file urls from the last two hex digits', () => {
    expect(traceUrls('https://adsb.lol/data/traces/', '06a10f')).toEqual([
      'https://adsb.lol/data/traces/0f/trace_full_06a10f.json',
      'https://adsb.lol/data/traces/0f/trace_recent_06a10f.json',
    ]);
    expect(relayRoute(traceUrls(DEFAULT_PROVIDERS.tracesUrl, '06a10f')[0])).not.toBeNull();
  });

  it('parses readsb trace points', () => {
    const pts = parseTrace(trace([[0, 32, 34.8, 'ground'], [10.5, 32.1, 34.9, 10000], [11, 99, 0, 1000], [12, 32.2, 35, null]]));
    expect(pts).toEqual([
      { lngLat: [34.8, 32], t: T0 * 1000, altitudeM: 0, onGround: true },
      { lngLat: [34.9, 32.1], t: T0 * 1000 + 10500, altitudeM: 3048, onGround: false },
      { lngLat: [35, 32.2], t: T0 * 1000 + 12000, altitudeM: null, onGround: false },
    ]);
    expect(parseTrace(null)).toEqual([]);
    expect(parseTrace({ trace: 'x' })).toEqual([]);
  });

  it('keeps only the current flight, from the takeoff run on', () => {
    const f = currentFlight(parseTrace(trace(DAY)), (T0 + 42000) * 1000);
    expect(f.landed).toBe(false);
    expect(f.points.map((p) => p.lngLat)).toEqual([[34.87, 32.0], [34.8, 32.05], [33.0, 33.0], [30.0, 36.0]]);
  });

  it('shows the whole flight with the landing roll once it has landed', () => {
    const f = currentFlight(parseTrace(trace(DAY.slice(0, 7))), (T0 + 7400) * 1000);
    expect(f.landed).toBe(true);
    expect(f.points[0].lngLat).toEqual([51.0, 25.0]);
    expect(f.points.at(-1)!.lngLat).toEqual([34.881, 32.011]);
    // Parked for hours since: nothing to show.
    expect(currentFlight(parseTrace(trace(DAY.slice(0, 7))), (T0 + 60000) * 1000).points).toEqual([]);
  });

  it('does not cut a flight at a long gap over the ocean', () => {
    const f = currentFlight(parseTrace(trace([[0, 40, -74, 'ground'], [60, 40.1, -73.9, 2500], [600, 42, -65, 35000], [12000, 51, -15, 36000], [14000, 51.4, -0.5, 'ground']])), (T0 + 14100) * 1000);
    expect(f.points).toHaveLength(5);
  });

  it('starts where the plane came into range when its takeoff was not received', () => {
    const f = currentFlight(parseTrace(trace([[0, 32, 34.8, 'ground'], [5000, 40, 20, 500], [9000, 45, 10, 37000], [9500, 46, 9, 37000]])), (T0 + 9500) * 1000);
    expect(f.points.map((p) => p.lngLat)).toEqual([[20, 40], [10, 45], [9, 46]]);
  });

  it('merges the recent trace after the full one', () => {
    const full = parseTrace(trace([[0, 1, 1, 1000], [10, 2, 2, 2000]]));
    const recent = parseTrace(trace([[5, 1.5, 1.5, 1500], [20, 3, 3, 3000]]));
    expect(mergeTraces(full, recent).map((p) => p.lngLat[0])).toEqual([1, 2, 3]);
  });

  it('thins long tracks, keeping both ends', () => {
    const list = Array.from({ length: 10001 }, (_, i) => i);
    const out = thin(list, 2500);
    expect(out).toHaveLength(2500);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(10000);
  });

  it('reads both files through the relay and treats a 404 as no track', async () => {
    const asked: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const { url } = JSON.parse(init.body as string) as { url: string };
      asked.push(url);
      if (url.includes('trace_recent')) return new Response('not found', { status: 404 });
      return Response.json(trace(DAY));
    }) as typeof fetch;
    const ctx = { config: { ...DEFAULT_PROVIDERS, flightsRelayUrl: 'https://relay.test/flights' }, fetch: fetcher, lang: 'he' };
    const t = await flightTrack(ctx, '06A10F');
    expect(asked.sort()).toEqual(traceUrls(DEFAULT_PROVIDERS.tracesUrl, '06a10f').sort());
    expect(t.hex).toBe('06a10f');
    expect(t.points.length).toBeGreaterThan(0);
    expect(t.startedAt).toBe(t.points[0].t);
    expect(flightTrackTool.input.safeParse({ hex: 'zz' }).success).toBe(false);
    expect(await flightTrack({ ...ctx, config: { ...ctx.config, tracesUrl: '' } }, '06a10f')).toEqual({ hex: '06a10f', points: [], landed: false, startedAt: null });
  });
});
