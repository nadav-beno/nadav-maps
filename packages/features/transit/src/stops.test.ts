import { describe, expect, it } from 'vitest';
import { isTransitStop } from './stops.ts';

describe('transit stops', () => {
  it('recognises stops and stations from OSM and Overture', () => {
    expect(isTransitStop({ category: { key: 'highway', value: 'bus_stop' } })).toBe(true);
    expect(isTransitStop({ category: { key: 'railway', value: 'station' } })).toBe(true);
    expect(isTransitStop({ category: { key: 'public_transport', value: 'platform' } })).toBe(true);
    expect(isTransitStop({ category: { key: 'overture', value: 'train_station' } })).toBe(true);
    expect(isTransitStop({ category: { key: 'amenity', value: 'cafe' } })).toBe(false);
    expect(isTransitStop({})).toBe(false);
  });
});
