import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { curlbusDepartures, curlbusRadius, curlbusTime, headsign } from './providers/curlbus.ts';
import { relayRoute } from './flights-proxy.ts';
import { transitDeparturesTool } from './tools/index.ts';
import { curlbusNearby, curlbusVisits } from '../../../e2e/curlbus-fixture.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const DIZENGOFF: [number, number] = [34.7746, 32.0754];

const motisStopTimes = (now: number) => ({
  stopTimes: [
    { place: { name: 'דיזנגוף סנטר', lat: 32.0754, lon: 34.7746, departure: new Date(now + 240_000).toISOString(), scheduledDeparture: new Date(now + 240_000).toISOString() }, mode: 'BUS', routeShortName: '99', headSign: 'timetable bus', realTime: false },
    { place: { name: 'קרליבך', lat: 32.0705, lon: 34.7815, departure: new Date(now + 420_000).toISOString(), scheduledDeparture: new Date(now + 400_000).toISOString() }, mode: 'TRAM', routeShortName: 'R', headSign: 'פתח תקווה', realTime: true },
  ],
});

describe('live bus arrivals (curlbus)', () => {
  it('reads Python times and snaps radii to the ones curlbus accepts', () => {
    expect(curlbusTime('2026-11-13 07:52:00+02:00')).toBe(Date.parse('2026-11-13T05:52:00Z'));
    expect(curlbusRadius(120)).toBe(150);
    expect(curlbusRadius(20)).toBe(50);
    expect(curlbusRadius(5000)).toBe(1000);
    expect(headsign('רמת גן_מסוף עמידר')).toBe('מסוף עמידר, רמת גן');
    expect(headsign('מסוף הלוחמים')).toBe('מסוף הלוחמים');
  });

  it('turns visits into live departures, soonest first, passed buses dropped', () => {
    const now = Date.now();
    const list = curlbusDepartures(curlbusVisits(now), curlbusNearby(), now);
    expect(list.map((d) => d.line)).toEqual(['18', '25', '61']);
    expect(list[0]).toMatchObject({ mode: 'bus', realtime: true, predicted: true, headsign: 'ת. מרכזית בת ים', agency: 'דן', stop: { name: 'דיזנגוף סנטר' } });
    expect(list[0].vehicle).toMatchObject({ id: 'openbus:7701355', lng: 34.779, lat: 32.0775 });
    // When the position was recorded (the fixture says 20 s ago, whole seconds).
    expect(Math.abs(now - Date.parse(list[0].vehicle!.at!) - 20_000)).toBeLessThanOrEqual(1000);
    expect(list[1]).toMatchObject({ headsign: 'מסוף רדינג, תל אביב יפו', agency: 'אגד' });
    // An hour-old position is dropped; the arrival stays.
    expect(list[2].vehicle).toBeUndefined();
    expect(list[1].vehicle).toBeUndefined();
    // The fixture writes whole seconds, like curlbus.
    expect(Math.abs((Date.parse(list[0].time) - now) / 1000 - 150)).toBeLessThanOrEqual(1);
  });

  function fakeFetch(urls: string[], fail: { curlbus?: boolean } = {}) {
    return (async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u);
      urls.push(url);
      if (url.startsWith('https://curlbus.app/')) {
        expect(new Headers(init?.headers).get('accept')).toBe('application/json');
        if (fail.curlbus) return json({ error: 'down' }, 500);
        return url.includes('/nearby?') ? json(curlbusNearby()) : json(curlbusVisits());
      }
      if (url.includes('/stoptimes')) return json(motisStopTimes(Date.now()));
      return json({}, 404);
    }) as typeof fetch;
  }

  it('in Israel: live bus predictions replace timetable buses; trams stay from Transitous', async () => {
    const urls: string[] = [];
    const res = await createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch(urls)).call(transitDeparturesTool, { near: DIZENGOFF, radius: 120 });
    expect(res.map((d) => `${d.mode}:${d.line}`)).toEqual(['bus:18', 'bus:25', 'tram:R', 'bus:61']);
    const nearby = new URL(urls.find((u) => u.includes('/nearby?'))!).searchParams;
    expect(nearby.get('radius')).toBe('150');
    // Nearest stops first; the municipal "TA…" stop is not queryable by code.
    expect(urls.find((u) => /curlbus\.app\/\d/.test(u))).toBe('https://curlbus.app/21330+21331');
  });

  it("asks for just the stop's own code when the card knows it", async () => {
    const urls: string[] = [];
    await createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch(urls)).call(transitDeparturesTool, { near: DIZENGOFF, radius: 120, stopCode: '21330' });
    expect(urls.some((u) => u.includes('/nearby?'))).toBe(false);
    expect(urls).toContain('https://curlbus.app/21330');
  });

  it('falls back to Transitous when curlbus is down', async () => {
    const res = await createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch([], { curlbus: true })).call(transitDeparturesTool, { near: DIZENGOFF, radius: 120 });
    expect(res.map((d) => d.line)).toEqual(['99', 'R']);
  });

  it('asks curlbus nothing outside Israel or for a stop id', async () => {
    const urls: string[] = [];
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', fakeFetch(urls));
    await client.call(transitDeparturesTool, { near: [2.35, 48.86], radius: 120 });
    await client.call(transitDeparturesTool, { stopId: 'il_123' });
    expect(urls.some((u) => u.includes('curlbus'))).toBe(false);
  });

  it('is allowed through the relay', () => {
    expect(relayRoute('https://curlbus.app/21330+21331')?.cacheMs).toBe(15_000);
    expect(relayRoute('https://curlbus.app/nearby?lat=32&lon=34.7&radius=150')?.cacheMs).toBeGreaterThan(60_000);
    expect(relayRoute('https://curlbus.app.evil.com/1')).toBeNull();
  });
});
