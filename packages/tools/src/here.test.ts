import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { hereRouteSummary, parseHereIncident } from './providers/here.ts';
import { trafficIncidents, trafficTravelTime } from './tools/index.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Shaped like HERE Traffic API v7 /incidents?locationReferencing=shape (trimmed). */
const V7 = {
  sourceUpdated: '2026-10-10T07:00:00Z',
  results: [
    {
      location: {
        description: 'Ayalon',
        length: 1043.6,
        shape: {
          links: [
            { points: [{ lat: 32.0712, lng: 34.7915 }, { lat: 32.0755, lng: 34.7931 }], length: 500, functionalClass: 1 },
            { points: [{ lat: 32.0755, lng: 34.7931 }, { lat: 32.0801, lng: 34.7944 }], length: 543, functionalClass: 1 },
          ],
        },
      },
      incidentDetails: {
        id: '111',
        originalId: 'o-111',
        type: 'congestion',
        criticality: 'minor',
        roadClosed: false,
        startTime: '2026-10-10T06:40:00Z',
        endTime: '2026-10-10T09:00:00Z',
        description: { value: 'תנועה איטית בנתיבי איילון צפון', language: 'he' },
        summary: { value: 'תנועה איטית', language: 'he' },
        descriptionParts: { proximityType: 'between', roadName: '20', intersectingRoadName: 'מחלף השלום', endIntersectingRoadName: 'מחלף ארלוזורוב' },
      },
    },
    {
      location: { length: 300, shape: { links: [{ points: [{ lat: 32.08, lng: 34.78 }], length: 300, functionalClass: 3 }] } },
      incidentDetails: { id: '222', originalId: 'o-222', type: 'construction', criticality: 'major', roadClosed: true, summary: { value: 'Road closed', language: 'en' } },
    },
    { location: { length: 10 }, incidentDetails: { id: 'no-shape', originalId: 'x', type: 'accident', roadClosed: false } },
  ],
};

describe('here incidents (v7)', () => {
  it('parses an incident with its shape, roads and times', () => {
    expect(parseHereIncident(V7.results[0])).toEqual({
      id: '111',
      type: 'jam',
      typeLabel: 'עומס תנועה',
      description: 'תנועה איטית בנתיבי איילון צפון',
      magnitude: 1,
      lengthM: 1044,
      from: 'מחלף השלום',
      to: 'מחלף ארלוזורוב',
      roads: ['20'],
      start: '2026-10-10T06:40:00Z',
      end: '2026-10-10T09:00:00Z',
      point: [34.7915, 32.0712],
    });
  });
  it('treats closures as closures, falls back to the summary, and skips incidents without a shape', () => {
    expect(parseHereIncident(V7.results[1])).toMatchObject({ type: 'road_closed', magnitude: 4, description: 'Road closed', roads: [], point: [34.78, 32.08] });
    expect(parseHereIncident(V7.results[2])).toBeNull();
  });

  it('in Israel the tool asks HERE (even with a TomTom key) and returns the worst first', async () => {
    const seen: string[] = [];
    const client = createToolClient({ ...DEFAULT_PROVIDERS, tomtomKey: 't', hereKey: 'h-key' }, 'he', (async (u: string | URL | Request) => {
      seen.push(String(u));
      return json(V7);
    }) as typeof fetch);
    const r = await client.call(trafficIncidents, { bbox: [34.75, 32.05, 34.82, 32.1] });
    expect(r.map((x) => x.id)).toEqual(['222', '111']);
    const u = new URL(seen[0]);
    expect(u.host).toBe('data.traffic.hereapi.com');
    expect(u.searchParams.get('apiKey')).toBe('h-key');
    expect(u.searchParams.get('lang')).toBe('he-IL');
    expect(u.searchParams.get('locationReferencing')).toBe('shape');
  });

  it('in Britain with both keys the tool asks TomTom, with only HERE it asks HERE', async () => {
    const hosts: string[] = [];
    const fetcher = (async (u: string | URL | Request) => {
      hosts.push(new URL(String(u)).host);
      return json(String(u).includes('tomtom') ? { incidents: [] } : { results: [] });
    }) as typeof fetch;
    const london: [number, number, number, number] = [-0.15, 51.49, -0.1, 51.52];
    await createToolClient({ ...DEFAULT_PROVIDERS, tomtomKey: 't', hereKey: 'h' }, 'en', fetcher).call(trafficIncidents, { bbox: london });
    await createToolClient({ ...DEFAULT_PROVIDERS, hereKey: 'h' }, 'en', fetcher).call(trafficIncidents, { bbox: london });
    expect(hosts).toEqual(['api.tomtom.com', 'data.traffic.hereapi.com']);
  });

  it('refuses boxes over 1° and hides HERE error bodies (which can echo the key)', async () => {
    const client = createToolClient({ ...DEFAULT_PROVIDERS, hereKey: 'secret' }, 'he', (async () => json({ error: 'Forbidden', title: 'apiKey secret invalid' }, 401)) as typeof fetch);
    await expect(client.call(trafficIncidents, { bbox: [34, 31, 35.5, 32.5] })).rejects.toThrow('האזור גדול מדי');
    const err = await client.call(trafficIncidents, { bbox: [34.75, 32.05, 34.82, 32.1] }).catch((e: Error) => e);
    expect((err as Error).message).toBe('מפתח HERE לא תקין או לא מורשה לשירות הזה.');
    expect((err as Error).message).not.toContain('secret');
  });
});

describe('here traffic time (Routing v8)', () => {
  it('sums the section summaries', () => {
    expect(
      hereRouteSummary({
        routes: [{ sections: [{ summary: { duration: 300, length: 1000, baseDuration: 200, typicalDuration: 260 } }, { summary: { duration: 120, length: 550, baseDuration: 100 } }] }],
      }),
    ).toEqual({ durationS: 420, noTrafficS: 300, delayS: 120, distanceM: 1550 });
    expect(hereRouteSummary({ routes: [{ sections: [{ summary: { duration: 90, length: 500 } }] }] })).toEqual({ durationS: 90, noTrafficS: undefined, delayS: 0, distanceM: 500 });
    expect(hereRouteSummary({ routes: [] })).toBeNull();
  });

  it('times our line in Israel: from its ends, through pass-through points, leaving now', async () => {
    let url = '';
    const client = createToolClient({ ...DEFAULT_PROVIDERS, hereKey: 'k' }, 'he', (async (u: string | URL | Request) => {
      url = String(u);
      return json({ routes: [{ sections: [{ summary: { duration: 420, length: 1550, baseDuration: 240, typicalDuration: 300 } }] }] });
    }) as typeof fetch);
    const line: [number, number][] = [[34.7741, 32.0787], [34.779, 32.078], [34.785, 32.0765], [34.7918, 32.0745]];
    const r = await client.call(trafficTravelTime, { waypoints: [line[0], line[3]], geometry: line });
    expect(r).toEqual({ durationS: 420, noTrafficS: 240, delayS: 180, distanceM: 1550 });
    const u = new URL(url);
    expect(u.host).toBe('router.hereapi.com');
    expect(u.searchParams.get('origin')).toBe('32.078700,34.774100');
    expect(u.searchParams.getAll('via')).toEqual(['32.078000,34.779000!passThrough=true', '32.076500,34.785000!passThrough=true']);
    expect(Math.abs(Date.parse(u.searchParams.get('departureTime')!) - Date.now())).toBeLessThan(60_000);
  });
});
