import { describe, expect, it, vi } from 'vitest';
import { BUDGET, CELL_COUNT, cellCenter, cellsIn, compactAircraft, memoryStore, postgrestStore, refreshCells, worldAircraft } from './world-cells.ts';
import { clearRelayCache, handleFlightsRelay } from './flights-proxy.ts';

const R = 6371;
const G = { lol: 0, fi: 0 };
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const plane = (hex: string, lat: number, lon: number, extra: Record<string, unknown> = {}) => ({ hex, flight: 'ELY001 ', lat, lon, alt_baro: 35000, gs: 450, track: 90, seen_pos: 1, t: 'B789', r: '4X-EDF', category: 'A5', ...extra });

describe('world cells', () => {
  it('covers the world with about 1,300 circles that reach every corner of their cell', () => {
    expect(CELL_COUNT).toBeGreaterThan(1000);
    expect(CELL_COUNT).toBeLessThan(1500);
    const all = cellsIn([-180, -90, 180, 90]);
    expect(all).toHaveLength(CELL_COUNT);
    // The corners of a cell near the equator and one up north are within 250 NM (463 km).
    for (const p of [{ lat: 1, lon: 1 }, { lat: 61, lon: 25 }, { lat: -33.9, lon: 151.2 }]) {
      const [id] = cellsIn([p.lon, p.lat, p.lon, p.lat]);
      expect(km(cellCenter(id), p)).toBeLessThan(463);
    }
    expect(cellsIn([34, 31, 35, 33]).length).toBeLessThanOrEqual(2);
  });

  it('keeps only fresh aircraft, compact, without ground vehicles', () => {
    const rows = compactAircraft({ ac: [plane('4X1', 32, 34.8), plane('4X2', 32, 34.8, { seen_pos: 120 }), plane('4X3', 32, 34.8, { category: 'C1' }), { hex: 'x' }] });
    expect(rows).toEqual([['4x1', 'ELY001', 34.8, 32, 35000, 90, 450, 1, 'A5', 'B789', '4X-EDF', null, null, null]]);
    expect(compactAircraft({ aircraft: [plane('A', 1, 2, { alt_baro: 'ground' })] })[0][4]).toBe(-1);
  });

  it('serves every viewer from one cache and refreshes stale cells only', async () => {
    const store = memoryStore();
    const upstream = vi.fn(async (url: string) => {
      const m = /point\/([-\d.]+)\/([-\d.]+)/.exec(url) ?? /lat\/([-\d.]+)\/lon\/([-\d.]+)/.exec(url)!;
      return new Response(JSON.stringify({ ac: [plane(`h${m[1]}${m[2]}`, Number(m[1]), Number(m[2]))] }));
    });
    let t = 1_000_000;
    const now = () => t;
    const box: [number, number, number, number] = [30, 28, 40, 36];
    const first = await worldAircraft(box, store, upstream as unknown as typeof fetch, { now, gaps: G });
    const calls = upstream.mock.calls.length;
    expect(calls).toBe(first.cells);
    expect(first.pending).toBe(0);
    expect(first.ac.length).toBeGreaterThan(0);
    t += 5_000;
    const again = await worldAircraft(box, store, upstream as unknown as typeof fetch, { now, gaps: G });
    expect(upstream.mock.calls.length).toBe(calls);
    expect(again.ac[0][7]).toBe(first.ac[0][7] + 5);
    t += 31_000;
    await worldAircraft(box, store, upstream as unknown as typeof fetch, { now, max: 1, gaps: G });
    expect(upstream.mock.calls.length).toBe(calls + 1);
  });

  it('answers at once and refreshes afterwards when it can defer', async () => {
    const store = memoryStore();
    const upstream = vi.fn(async () => new Response('{"ac":[]}'));
    const later: Promise<unknown>[] = [];
    const res = await worldAircraft([0, 0, 10, 10], store, upstream as unknown as typeof fetch, { defer: (p) => later.push(p), gaps: G });
    expect(res.ac).toEqual([]);
    expect(res.pending).toBe(res.cells);
    await Promise.all(later);
    expect(upstream).toHaveBeenCalled();
    const next = await worldAircraft([0, 0, 10, 10], store, upstream as unknown as typeof fetch, { defer: (p) => later.push(p), gaps: G });
    expect(next.pending).toBe(0);
  });

  it('splits cells between the two feeds and stops a feed that rate-limits', async () => {
    const upstream = vi.fn(async (url: string) =>
      url.includes('adsb.lol') ? new Response('', { status: 429 }) : new Response(JSON.stringify({ aircraft: [plane(`fi${upstream.mock.calls.length}`, 32, 34.8)] })),
    );
    const store = memoryStore();
    const ids = [24010, 24011, 24012, 24013, 24014, 24015];
    await refreshCells(store, ids, upstream as unknown as typeof fetch, 'test', () => 0, G);
    const urls = upstream.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.includes('adsb.lol'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('adsb.fi'))).toHaveLength(3);
  });

  it('claims at most the shared budget of cells per 10 s', async () => {
    const store = memoryStore();
    const ids = cellsIn([-180, -10, 180, 10]);
    expect((await store.take(ids, 100, 0)).claim).toHaveLength(BUDGET);
    expect((await store.take(ids, 100, 5_000)).claim).toHaveLength(0);
    expect((await store.take(ids, 100, 30_000)).claim).toHaveLength(BUDGET);
  });

  it('talks to Postgres through two RPCs', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ cells: [[7001, 1000, []]], claim: [7002], unknown: 1 }));
    });
    const store = postgrestStore('https://db.test/', 'key', f as unknown as typeof fetch);
    const r = await store.take([7001, 7002], 4, 0);
    expect(r).toEqual({ cells: [{ id: 7001, at: 1_000_000, rows: [] }], claim: [7002], unknown: 1 });
    expect(f.mock.calls[0][0]).toBe('https://db.test/rest/v1/rpc/flight_cells_claim');
    expect((f.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer key');
  });

  it('the relay answers world requests from the store, and refuses bad boxes', async () => {
    clearRelayCache();
    const req = (body: unknown) => new Request('https://relay.test/', { method: 'POST', headers: { origin: 'https://nadav-beno.github.io' }, body: JSON.stringify(body) });
    const upstream = vi.fn(async () => new Response('{"ac":[]}'));
    expect((await handleFlightsRelay(req({ world: [0, 0, 1] }), upstream as unknown as typeof fetch, 0, { store: memoryStore() })).status).toBe(400);
    expect((await handleFlightsRelay(req({ world: [10, 0, 0, 1] }), upstream as unknown as typeof fetch, 0, { store: memoryStore() })).status).toBe(400);
    expect((await handleFlightsRelay(req({ world: [0, 0, 1, 1] }), upstream as unknown as typeof fetch)).status).toBe(501);
    const ok = await handleFlightsRelay(req({ world: [0, 0, 1, 1] }), upstream as unknown as typeof fetch, 0, { store: memoryStore() });
    expect(ok.status).toBe(200);
    expect(JSON.parse(await ok.text())).toMatchObject({ ac: [], cells: 1, pending: 0 });
  });
});
