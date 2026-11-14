import { afterEach, describe, expect, it } from 'vitest';
import { collect, handleShipsRelay, mergeUpdate, parseAisstream, tileBox, tilesOf, type MiniSocket, type ShipRow, type ShipStore, type ShipUpdate } from './ships-relay.ts';
import { liveShips, parseVesselSparql, resetShipCaches, rowToShip } from './providers/ships.ts';
import { DEFAULT_PROVIDERS } from '@nm/core';
import type { ToolContext } from './define.ts';

const position = (mmsi: number, lat: number, lng: number, time = '2026-11-14 11:00:00.000 +0000 UTC') => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, ShipName: 'ZIM HAIFA   ', latitude: lat, longitude: lng, time_utc: time },
  Message: { PositionReport: { Latitude: lat, Longitude: lng, Sog: 14.3, Cog: 271.4, TrueHeading: 270, NavigationalStatus: 0, Valid: true } },
});
const staticData = (mmsi: number) => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi, ShipName: 'ZIM HAIFA' },
  Message: { ShipStaticData: { Name: 'ZIM HAIFA@@@', CallSign: '4XAB', ImoNumber: 9123456, Type: 71, Dimension: { A: 200, B: 50, C: 20, D: 12 }, MaximumStaticDraught: 11.2, Destination: 'ILHFA', Eta: { Month: 11, Day: 15, Hour: 6, Minute: 30 } } },
});

describe('aisstream parsing', () => {
  it('reads positions and static data', () => {
    const now = Date.UTC(2026, 10, 14, 11, 5) / 1000;
    expect(parseAisstream(position(428000001, 32.8, 34.9), now)).toEqual({ mmsi: 428000001, lat: 32.8, lng: 34.9, at: Date.UTC(2026, 10, 14, 11) / 1000, sog: 14.3, cog: 271, hdg: 270, nav: 0, name: 'ZIM HAIFA' });
    const s = parseAisstream(staticData(428000001), now)!;
    expect(s).toMatchObject({ name: 'ZIM HAIFA', callsign: '4XAB', imo: 9123456, type: 71, a: 200, b: 50, draught: 11.2, dest: 'ILHFA', eta: '11-15T06:30' });
    expect(parseAisstream({ MessageType: 'BaseStationReport', MetaData: { MMSI: 2 }, Message: {} })).toBeNull();
    // "Not available" values.
    const na = position(428000002, 91, 181);
    expect(parseAisstream(na, now)).toMatchObject({ mmsi: 428000002 });
    expect(parseAisstream(na, now)?.lat).toBeUndefined();
  });

  it('keeps the newest position when merging', () => {
    const m = new Map<number, ShipUpdate>();
    mergeUpdate(m, { mmsi: 1, lat: 1, lng: 1, at: 20 });
    mergeUpdate(m, { mmsi: 1, lat: 2, lng: 2, at: 10, name: 'A' });
    expect(m.get(1)).toMatchObject({ lat: 1, at: 20, name: 'A' });
  });

  it('tiles the world in 10° squares', () => {
    expect(tilesOf([34, 29, 36, 33.5])).toEqual([11 * 36 + 21, 12 * 36 + 21]);
    expect(tileBox(12 * 36 + 21)).toEqual([30, 30, 40, 40]);
    expect(tilesOf([-180, -90, 180, 90]).length).toBe(648);
  });
});

class FakeSocket implements MiniSocket {
  sent: string[] = [];
  onopen: MiniSocket['onopen'] = null;
  onmessage: MiniSocket['onmessage'] = null;
  onerror: MiniSocket['onerror'] = null;
  onclose: MiniSocket['onclose'] = null;
  closed = false;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
}

function memoryStore(rows: ShipRow[] = []) {
  const puts: { updates: ShipUpdate[]; done: boolean }[] = [];
  const calls: { tiles: number[]; stream: boolean }[] = [];
  let leased = false;
  const store: ShipStore = {
    async get(_box, _max, tiles, stream) {
      calls.push({ tiles, stream });
      const got = stream && !leased;
      if (got) leased = true;
      return { ships: rows, boxes: got ? [[30, 30, 40, 40]] : null };
    },
    async put(updates, done) {
      puts.push({ updates, done });
      if (done) leased = false;
    },
    async track() {
      return [[34.9, 32.8, 1]];
    },
  };
  return { store, puts, calls };
}

describe('ships relay', () => {
  it('streams once for everyone and stores what it hears', async () => {
    const { store, puts } = memoryStore();
    const sock = new FakeSocket();
    const job = collect([[30, 30, 40, 40]], 'k', store, () => sock, 50);
    sock.onopen?.({});
    expect(JSON.parse(sock.sent[0])).toMatchObject({ APIKey: 'k', BoundingBoxes: [[[30, 30], [40, 40]]] });
    sock.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(position(428000001, 32.8, 34.9))).buffer });
    sock.onmessage?.({ data: JSON.stringify(staticData(428000001)) });
    await job;
    expect(sock.closed).toBe(true);
    const last = puts[puts.length - 1];
    expect(last.done).toBe(true);
    expect(puts.flatMap((p) => p.updates)).toEqual([expect.objectContaining({ mmsi: 428000001, lat: 32.8, imo: 9123456 })]);
  });

  it('answers boxes and tracks, and checks the origin', async () => {
    const row: ShipRow = [428000001, 34.9, 32.8, 14, 270, 270, 0, 1794650000, 'ZIM HAIFA', 71, 250, 32, 11.2, 'ILHFA', '11-15T06:30', 9123456, '4XAB'];
    const { store, calls } = memoryStore([row]);
    const sockets: FakeSocket[] = [];
    const deferred: Promise<unknown>[] = [];
    const opts = { store, key: 'k', socket: () => (sockets.push(new FakeSocket()), sockets[sockets.length - 1]), defer: (p: Promise<unknown>) => void deferred.push(p), listenMs: 10 };
    const post = (body: unknown, origin = 'https://nadav-beno.github.io') =>
      handleShipsRelay(new Request('https://x/ships', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), opts);
    const r = await post({ box: [34, 29, 36, 33.5] });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://nadav-beno.github.io');
    expect(await r.json()).toMatchObject({ ships: [row], live: true });
    expect(calls[0]).toEqual({ tiles: [417, 453], stream: true });
    expect(deferred.length).toBe(1);
    // A world view doesn't claim its 648 tiles.
    await post({ box: [-180, -80, 180, 80] });
    expect(calls[1].tiles).toEqual([]);
    expect((await post({ track: 428000001 }).then((x) => x.json()))).toEqual({ track: [[34.9, 32.8, 1]] });
    expect((await post({ box: [1, 2] })).status).toBe(400);
    expect((await post({ box: [1, 2, 3, 4] }, 'https://evil.example')).status).toBe(403);
    await Promise.all(deferred);
  });

  it('serves only the cache without a key', async () => {
    const { store, calls } = memoryStore();
    const r = await handleShipsRelay(new Request('https://x', { method: 'POST', body: JSON.stringify({ box: [34, 29, 36, 33] }) }), { store, socket: () => new FakeSocket() });
    expect(await r.json()).toMatchObject({ live: false });
    expect(calls[0].stream).toBe(false);
  });
});

describe('live_ships provider', () => {
  afterEach(resetShipCaches);
  const now = Date.UTC(2026, 10, 14, 11, 5);
  const ctx = (f: typeof fetch, cfg = {}): ToolContext => ({ config: { ...DEFAULT_PROVIDERS, shipsUrl: 'https://relay/ships', ...cfg }, fetch: f, lang: 'he' });

  it('turns relay rows into ships', () => {
    const s = rowToShip([428000001, 34.9, 32.8, 14, 270, null, 0, now / 1000 - 60, 'ZIM HAIFA', 71, 250, 32, 11.2, 'ILHFA', '11-15T06:30', 9123456, '4XAB'], now)!;
    expect(s).toMatchObject({ mmsi: 428000001, lngLat: [34.9, 32.8], eta: '2026-11-15T06:30:00.000Z', source: 'aisstream' });
  });

  it('merges the relay with Digitraffic in the Baltic', async () => {
    const f = (async (url: string, init?: RequestInit) => {
      if (url === 'https://relay/ships') {
        expect(JSON.parse(String(init?.body))).toEqual({ box: [20, 59, 26, 61] });
        return Response.json({ live: true, ships: [[230000001, 24.9, 60.1, 0, null, null, 5, now / 1000 - 600, 'OLD NAME', 60, 100, 20, null, null, null, null, null]] });
      }
      if (url.includes('/api/ais/v1/locations')) {
        return Response.json({ dataUpdatedTime: new Date(now).toISOString(), features: [
          { mmsi: 230000001, geometry: { coordinates: [24.95, 60.16] }, properties: { sog: 0.1, cog: 10, heading: 12, navStat: 5, timestampExternal: now - 30_000 } },
          { mmsi: 230000002, geometry: { coordinates: [10, 55] }, properties: { sog: 9, timestampExternal: now - 30_000 } },
        ] });
      }
      if (url.includes('/api/ais/v1/vessels')) return Response.json([{ mmsi: 230000001, name: 'SANNA', shipType: 60, draught: 32, eta: 750110, referencePointA: 22, referencePointB: 24, referencePointC: 8, referencePointD: 1 }]);
      throw new Error(url);
    }) as typeof fetch;
    const r = await liveShips(ctx(f), [20, 59, 26, 61], now);
    expect(r.sources).toEqual(['aisstream', 'digitraffic']);
    expect(r.ships).toHaveLength(1);
    expect(r.ships[0]).toMatchObject({ mmsi: 230000001, name: 'SANNA', lngLat: [24.95, 60.16], draught: 3.2, length: 46, source: 'digitraffic' });
  });

  it('works without the relay and says why', async () => {
    const f = (async () => Response.json({ ships: [], live: false })) as unknown as typeof fetch;
    expect(await liveShips(ctx(f), [34, 31, 35, 33], now)).toMatchObject({ note: 'no-key', live: false });
    expect(await liveShips(ctx(f, { shipsUrl: '' }), [34, 31, 35, 33], now)).toMatchObject({ ships: [], note: 'relay-off' });
  });
});

describe('vessel info', () => {
  it('reads Wikidata answers', () => {
    const v = parseVesselSparql([
      { item: { value: 'http://www.wikidata.org/entity/Q123' }, itemLabel: { value: 'Symphony of the Seas' }, inception: { value: '2018-03-23T00:00:00Z' }, builderLabel: { value: 'Chantiers de l’Atlantique' }, gt: { value: '228081' }, ownerLabel: { value: 'Q999' } },
    ])!;
    expect(v).toMatchObject({ wikidata: 'Q123', label: 'Symphony of the Seas', built: 2018, grossTonnage: 228081, owner: null });
    expect(parseVesselSparql([])).toBeNull();
  });
});
