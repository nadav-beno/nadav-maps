import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { parseIncident } from './providers/tomtom.ts';
import { TOOLS, trafficIncidents, trafficTravelTime } from './tools/index.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Shaped like TomTom Incident Details v5 (fields as we request them). */
const INCIDENTS = {
  incidents: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[34.7915, 32.0712], [34.7931, 32.0755], [34.7944, 32.0801]] },
      properties: {
        id: 'abc-1',
        iconCategory: 6,
        magnitudeOfDelay: 2,
        events: [{ description: 'תנועה איטית', code: 115, iconCategory: 6 }],
        startTime: '2026-10-10T06:40:00Z',
        endTime: null,
        from: 'מחלף השלום',
        to: 'מחלף ארלוזורוב',
        length: 1043.6,
        delay: 240,
        roadNumbers: ['20'],
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [34.78, 32.08] },
      properties: {
        id: 'abc-2',
        iconCategory: 8,
        magnitudeOfDelay: 4,
        events: [{ description: 'Closed', code: 401, iconCategory: 8 }, { description: 'Closed', code: 401, iconCategory: 8 }, { description: 'Road works', code: 701, iconCategory: 9 }],
        from: 'אבן גבירול',
        to: 'ארלוזורוב',
        length: 300,
        delay: null,
        roadNumbers: [],
      },
    },
    { type: 'Feature', properties: { id: 'broken' } },
  ],
};

describe('tomtom incidents', () => {
  it('parses a line incident with delay and roads', () => {
    expect(parseIncident(INCIDENTS.incidents[0] as never)).toEqual({
      id: 'abc-1',
      type: 'jam',
      typeLabel: 'עומס תנועה',
      description: 'תנועה איטית',
      magnitude: 2,
      delayS: 240,
      lengthM: 1044,
      from: 'מחלף השלום',
      to: 'מחלף ארלוזורוב',
      roads: ['20'],
      start: '2026-10-10T06:40:00Z',
      end: undefined,
      point: [34.7915, 32.0712],
    });
  });
  it('merges duplicate event texts and skips incidents without geometry', () => {
    expect(parseIncident(INCIDENTS.incidents[1] as never)).toMatchObject({ type: 'road_closed', description: 'Closed · Road works', delayS: undefined, point: [34.78, 32.08] });
    expect(parseIncident(INCIDENTS.incidents[2] as never)).toBeNull();
  });

  it('the tool asks TomTom for the box and returns the worst first', async () => {
    const seen: string[] = [];
    const client = createToolClient({ ...DEFAULT_PROVIDERS, tomtomKey: 'test-key' }, 'he', (async (u: string | URL | Request) => {
      seen.push(String(u));
      return json(INCIDENTS);
    }) as typeof fetch);
    const r = await client.call(trafficIncidents, { bbox: [34.75, 32.05, 34.82, 32.1] });
    expect(r.map((x) => x.id)).toEqual(['abc-2', 'abc-1']);
    const u = new URL(seen[0]);
    expect(u.host).toBe('api.tomtom.com');
    expect(u.searchParams.get('key')).toBe('test-key');
    expect(u.searchParams.get('language')).toBe('he-IL');
  });

  it('says clearly (in Hebrew) when no key is configured, without calling anyone', async () => {
    let called = false;
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async () => {
      called = true;
      return json({});
    }) as typeof fetch);
    await expect(client.call(trafficIncidents, { bbox: [34.75, 32.05, 34.82, 32.1] })).rejects.toMatchObject({ name: 'ProviderError', status: 503, message: expect.stringContaining('TomTom') });
    expect(called).toBe(false);
  });

  it('refuses boxes over 10,000 km² and hides TomTom error bodies', async () => {
    const client = createToolClient({ ...DEFAULT_PROVIDERS, tomtomKey: 'k' }, 'he', (async () => json({ detailedError: { message: 'key k is bad' } }, 403)) as typeof fetch);
    await expect(client.call(trafficIncidents, { bbox: [33, 29, 36, 33] })).rejects.toThrow('האזור גדול מדי');
    const err = await client.call(trafficIncidents, { bbox: [34.75, 32.05, 34.82, 32.1] }).catch((e: Error) => e);
    expect((err as Error).message).toBe('מפתח TomTom לא תקין או לא מורשה לשירות הזה.');
  });

  it('is listed for REST and MCP', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['traffic_incidents', 'traffic_travel_time']));
  });
});

describe('tomtom traffic time', () => {
  it('reconstructs our route from supporting points and reads the summary', async () => {
    let body: { supportingPoints: { latitude: number; longitude: number }[] } | undefined;
    let url = '';
    const client = createToolClient({ ...DEFAULT_PROVIDERS, tomtomKey: 'k' }, 'he', (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      body = JSON.parse(String(init?.body));
      return json({ routes: [{ summary: { lengthInMeters: 1580, travelTimeInSeconds: 420, trafficDelayInSeconds: 120, noTrafficTravelTimeInSeconds: 300 } }] });
    }) as typeof fetch);
    const line: [number, number][] = [[34.7741, 32.0787], [34.779, 32.078], [34.785, 32.0765], [34.7918, 32.0745]];
    const r = await client.call(trafficTravelTime, { waypoints: [line[0], line[3]], geometry: line });
    expect(r).toEqual({ durationS: 420, noTrafficS: 300, delayS: 120, distanceM: 1580 });
    expect(url).toContain('/routing/1/calculateRoute/32.078700,34.774100:32.074500,34.791800/json');
    expect(body?.supportingPoints[1]).toEqual({ latitude: 32.078, longitude: 34.779 });
  });
});
