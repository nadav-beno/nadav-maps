import { describe, expect, it } from 'vitest';
import type { Ship } from '@nm/tools';
import { NO_SHIP_FILTERS, passes, tally } from './filters.ts';

const ship = (o: Partial<Ship>): Ship => ({
  mmsi: 428000001, lngLat: [34.9, 32.8], sog: 12, cog: 90, heading: 90, nav: 0, at: 0, name: 'X', callsign: null, imo: null, type: 71,
  length: 200, beam: 30, draught: null, destination: null, eta: null, source: 'aisstream', ...o,
});

describe('ships filters', () => {
  it('narrows by kind, motion, distress, flag and length', () => {
    const cargo = ship({});
    const tankerAtAnchor = ship({ mmsi: 538000002, type: 80, sog: 0, nav: 1 });
    const aground = ship({ mmsi: 248000003, type: 60, nav: 6, length: 40 });
    expect(passes(cargo, NO_SHIP_FILTERS)).toBe(true);
    expect(passes(cargo, { ...NO_SHIP_FILTERS, hide: ['cargo'] })).toBe(false);
    expect(passes(tankerAtAnchor, { ...NO_SHIP_FILTERS, moving: true })).toBe(false);
    expect([cargo, tankerAtAnchor, aground].filter((s) => passes(s, { ...NO_SHIP_FILTERS, alerts: true }))).toEqual([aground]);
    expect([cargo, tankerAtAnchor, aground].filter((s) => passes(s, { ...NO_SHIP_FILTERS, flag: 'MH' }))).toEqual([tankerAtAnchor]);
    expect(passes(aground, { ...NO_SHIP_FILTERS, minLen: 50 })).toBe(false);
  });

  it('counts kinds and flags', () => {
    const t = tally([ship({}), ship({ mmsi: 428000002 }), ship({ mmsi: 538000002, type: 80 })]);
    expect(t.byCat).toMatchObject({ cargo: 2, tanker: 1 });
    expect(t.flags).toEqual([['IL', 2], ['MH', 1]]);
  });
});
