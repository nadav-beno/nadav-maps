import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { clearRelayCache, handleFlightsRelay, relayRoute } from './flights-proxy.ts';
import { getJson } from './define.ts';

const SITE = 'https://nadav-beno.github.io';
const post = (body: unknown, origin: string | null = SITE) =>
  new Request('https://relay.test/functions/v1/flights', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

describe('flights relay', () => {
  beforeEach(() => clearRelayCache());

  it('allows only the feed endpoints', () => {
    expect(relayRoute('https://api.adsb.lol/v2/point/32/34.8/100')).toBeTruthy();
    expect(relayRoute('https://opensky-network.org/api/states/all?lamin=1&extended=1')).toBeTruthy();
    expect(relayRoute('https://adsb.im/api/0/routeset')?.post).toBe(true);
    expect(relayRoute('https://api.adsb.lol/v2/point/../../admin')).toBeNull();
    expect(relayRoute('https://evil.example/v2/point/1/2/3')).toBeNull();
    expect(relayRoute('https://api.adsb.lol.evil.example/v2/point/1/2/3')).toBeNull();
  });

  it('relays with CORS for our site and caches GETs briefly', async () => {
    const upstream = vi.fn(async () => new Response('{"ac":[]}', { status: 200 }));
    const url = 'https://api.adsb.lol/v2/point/32/34.8/100';
    const res = await handleFlightsRelay(post({ url }), upstream as typeof fetch, 1000);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(await res.text()).toBe('{"ac":[]}');
    await handleFlightsRelay(post({ url }), upstream as typeof fetch, 3000);
    expect(upstream).toHaveBeenCalledTimes(1);
    await handleFlightsRelay(post({ url }), upstream as typeof fetch, 9000);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('forwards the routeset POST body and passes upstream errors through', async () => {
    const upstream = vi.fn(async (_u: string, init?: RequestInit) => new Response(String(init?.body), { status: 429 }));
    const body = { planes: [{ callsign: 'ELY001', lat: 32, lng: 34.8 }] };
    const res = await handleFlightsRelay(post({ url: 'https://adsb.im/api/0/routeset', body }), upstream as unknown as typeof fetch);
    expect(res.status).toBe(429);
    expect(JSON.parse(await res.text())).toEqual(body);
    expect(upstream.mock.calls[0][1]?.method).toBe('POST');
  });

  it('refuses other sites, other URLs and other methods', async () => {
    const upstream = vi.fn();
    expect((await handleFlightsRelay(post({ url: 'https://api.adsb.lol/v2/point/1/2/3' }, 'https://other.example'), upstream)).status).toBe(403);
    expect((await handleFlightsRelay(post({ url: 'https://example.com/' }), upstream)).status).toBe(400);
    expect((await handleFlightsRelay(new Request('https://relay.test/', { method: 'GET' }), upstream)).status).toBe(405);
    const pre = await handleFlightsRelay(new Request('https://relay.test/', { method: 'OPTIONS', headers: { origin: SITE } }), upstream);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('getJson sends flight feeds through the relay, with the URL in the body', async () => {
    const fetch = vi.fn(async () => new Response('{"ok":1}'));
    const ctx = { config: { ...DEFAULT_PROVIDERS, flightsRelayUrl: 'https://relay.test/f' }, fetch: fetch as unknown as typeof globalThis.fetch, lang: 'he' };
    await getJson(ctx, 'https://api.adsb.lol/v2/point/1/2/3', {}, 'flights');
    await getJson(ctx, 'https://adsb.im/api/0/routeset', { method: 'POST', body: '{"planes":[]}' }, 'flights');
    await getJson(ctx, 'https://photon.example/api', {}, 'photon');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://relay.test/f');
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ url: 'https://api.adsb.lol/v2/point/1/2/3' });
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ url: 'https://adsb.im/api/0/routeset', body: { planes: [] } });
    expect(calls[2][0]).toBe('https://photon.example/api');
  });
});
