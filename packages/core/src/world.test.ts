import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countryAt, decodeWorld, nearestCity, searchWorld, worldGeoJSON, type WorldFile } from './world.ts';

// The real file that ships with the app.
const file = JSON.parse(readFileSync(new URL('../../../apps/web/public/offline/world-1.json', import.meta.url), 'utf8')) as WorldFile;
const world = decodeWorld(file);

describe('offline world map', () => {
  it('is small and complete', () => {
    expect(JSON.stringify(file).length).toBeLessThan(1_000_000);
    expect(world.countries.length).toBeGreaterThan(200);
    expect(world.cities.length).toBeGreaterThan(1000);
    expect(world.airports.length).toBeGreaterThan(300);
    expect(world.borders.length).toBeGreaterThan(300);
  });

  it('finds the country under a point', () => {
    expect(countryAt(world, [34.78, 32.08])).toMatchObject({ code: 'IL', he: 'ישראל' });
    expect(countryAt(world, [2.35, 48.86])).toMatchObject({ code: 'FR', he: 'צרפת' });
    expect(countryAt(world, [-77.04, 38.9])?.code).toBe('US');
    expect(countryAt(world, [139.7, 35.7])?.code).toBe('JP');
    expect(countryAt(world, [151.2, -33.87])?.code).toBe('AU');
    // Russia's far east, across the antimeridian, and a longitude past 180.
    expect(countryAt(world, [177, 65])?.code).toBe('RU');
    expect(countryAt(world, [-185, 65])?.code).toBe('RU');
  });

  it('says null over the sea', () => {
    expect(countryAt(world, [-40, 40])).toBeNull(); // mid Atlantic
    expect(countryAt(world, [33, 34])).toBeNull(); // Mediterranean, off Cyprus
  });

  it('finds the nearest big city, with Hebrew names', () => {
    const athens = nearestCity(world, [23.9, 38.1], 300);
    expect(athens?.city).toMatchObject({ name: 'Athens', he: 'אתונה', country: 'GR' });
    expect(athens!.distanceM).toBeLessThan(30_000);
    expect(nearestCity(world, [34.8, 32.1], 300)?.city.he).toBe('תל אביב-יפו');
    const sea = nearestCity(world, [-40, 40], 300);
    expect(sea!.distanceM).toBeGreaterThan(500_000);
  });

  it('searches bundled cities and airports for a destination', () => {
    expect(searchWorld(world, 'TLV')[0]).toMatchObject({ kind: 'airport', airport: { iata: 'TLV' } });
    const ny = searchWorld(world, 'ניו יורק')[0];
    expect(ny.kind === 'city' && ny.city.name).toBe('New York City');
    expect(searchWorld(world, 'london').some((r) => r.kind === 'city' && r.city.country === 'GB')).toBe(true);
    expect(searchWorld(world, '   ')).toEqual([]);
  });

  it('becomes GeoJSON for the map', () => {
    const fc = worldGeoJSON(world);
    const kinds = new Set(fc.features.map((f) => f.properties.kind));
    expect([...kinds].sort()).toEqual(['border', 'city', 'country', 'land']);
    const israel = fc.features.find((f) => f.properties.kind === 'country' && f.properties.name === 'ישראל');
    expect(israel).toBeTruthy();
    const paris = fc.features.find((f) => f.properties.kind === 'city' && f.properties.name === 'פריז');
    expect(paris?.properties.capital).toBe(true);
  });
});
