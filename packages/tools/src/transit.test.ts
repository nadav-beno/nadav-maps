import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createToolClient } from './client.ts';
import { motisDeparture, motisItinerary, transitMode } from './providers/transitous.ts';
import { transitDeparturesTool, transitDirections } from './tools/index.ts';
import { motisPlan, motisStoptimes } from '../../../e2e/transit-fixture.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('transit (MOTIS / Transitous)', () => {
  it('maps modes', () => {
    expect(transitMode('BUS')).toBe('bus');
    expect(transitMode('REGIONAL_RAIL')).toBe('rail');
    expect(transitMode('TRAM')).toBe('tram');
    expect(transitMode('METRO')).toBe('subway');
    expect(transitMode('SOMETHING')).toBe('other');
  });

  it('turns an itinerary into walk and ride legs', () => {
    const it0 = motisItinerary(motisPlan(0).itineraries[0] as never);
    expect(it0.legs.map((l) => l.kind)).toEqual(['walk', 'ride', 'walk']);
    const ride = it0.legs[1];
    expect(ride).toMatchObject({ mode: 'bus', line: '18', headsign: 'תחנה מרכזית', color: '0b8043', agency: 'דן', stops: 3, realtime: true });
    expect(ride.geometry).toHaveLength(4);
    expect(it0.walkM).toBe(330);
    expect(new Date(ride.start).getTime() - new Date(ride.scheduledStart).getTime()).toBe(60000);
  });

  it('maps departures and ignores bad colours', () => {
    const d = motisDeparture({ ...motisStoptimes(0).stopTimes[0], routeColor: 'nope' } as never);
    expect(d).toMatchObject({ line: '18', headsign: 'בת ים', mode: 'bus', realtime: true, cancelled: false });
    expect(d.color).toBeUndefined();
    expect(d.stop.stopId).toBe('il:1');
  });

  it('asks v6 first and falls back to v5 on older servers', async () => {
    const urls: string[] = [];
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string | URL | Request) => {
      const url = String(u);
      urls.push(url);
      return url.includes('/v6/') ? json({ error: 'not found' }, 404) : json(motisPlan());
    }) as typeof fetch);
    const res = await client.call(transitDirections, { from: [34.7741, 32.0787], to: [34.7918, 32.0745] });
    expect(res).toHaveLength(2);
    expect(urls[0]).toContain('/api/v6/plan?fromPlace=32.078700%2C34.774100');
    expect(urls[1]).toContain('/api/v5/plan');
  });

  it('finds departures around a point', async () => {
    let url = '';
    const client = createToolClient(DEFAULT_PROVIDERS, 'he', (async (u: string | URL | Request) => {
      url = String(u);
      return json(motisStoptimes());
    }) as typeof fetch);
    const res = await client.call(transitDeparturesTool, { near: [34.7752, 32.0779], radius: 150 });
    expect(res.map((d) => d.line)).toEqual(['18', '5', '61']);
    expect(url).toContain('center=32.077900%2C34.775200');
    expect(url).toContain('radius=150');
    await expect(client.call(transitDeparturesTool, {})).rejects.toThrow();
  });

  it('is off when no transit server is configured', async () => {
    const client = createToolClient({ ...DEFAULT_PROVIDERS, transitUrl: '' }, 'he', (async () => json({})) as typeof fetch);
    await expect(client.call(transitDirections, { from: [34.7, 32], to: [34.8, 32.1] })).rejects.toThrow('תחבורה ציבורית');
  });
});
