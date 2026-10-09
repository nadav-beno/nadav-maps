import { describe, expect, it } from 'vitest';
import { createList, decodeList, encodeList, fromGeoJSON, toGeoJSON, toggleInList, listsContaining, deleteList, restoreList, data } from './store.ts';

const place = { id: 'osm:n42', name: 'קפה "נחת"', lng: 34.781234, lat: 32.081234 };

describe('saved store', () => {
  it('toggles favorites', () => {
    expect(toggleInList('favorites', place)).toBe(true);
    expect(listsContaining('osm:n42')).toContain('favorites');
    expect(toggleInList('favorites', place)).toBe(false);
    expect(listsContaining('osm:n42')).not.toContain('favorites');
  });
  it('deletes and restores a list', () => {
    const l = createList('טיול');
    const removed = deleteList(l.id);
    expect(data.value.lists.find((x) => x.id === l.id)).toBeUndefined();
    restoreList(removed!);
    expect(data.value.lists.find((x) => x.id === l.id)).toBeTruthy();
  });
  it('round-trips a list through the share link (hebrew safe)', () => {
    const list = createList('מקומות בצפון', '🌲', [{ ...place, savedAt: 1 }, { id: 'pt:35.00000,33.00000', name: 'נקודה', lng: 35, lat: 33, savedAt: 1 }]);
    const enc = encodeList(list);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeList(enc);
    expect(back.name).toBe('מקומות בצפון');
    expect(back.places.map((p) => p.id)).toEqual(['osm:n42', 'pt:35.00000,33.00000']);
    expect(back.places[0].name).toBe('קפה "נחת"');
  });
  it('round-trips GeoJSON and rejects junk', () => {
    const list = createList('ייצוא', '📍', [{ ...place, savedAt: 1, note: 'טעים' }]);
    const back = fromGeoJSON(JSON.parse(JSON.stringify(toGeoJSON(list))));
    expect(back.name).toBe('ייצוא');
    expect(back.places[0]).toMatchObject({ id: 'osm:n42', note: 'טעים' });
    expect(() => fromGeoJSON({ foo: 1 })).toThrow();
    expect(fromGeoJSON({ type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: [] } }] }).places).toEqual([]);
  });
});
