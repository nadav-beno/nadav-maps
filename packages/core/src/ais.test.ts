import { describe, expect, it } from 'vitest';
import { destinationName, dimensions, etaFromPacked, etaFromParts, flagEmoji, flagOf, isStopped, shipCategory, shipTypeName } from './ais.ts';

describe('ais helpers', () => {
  it('groups ship type codes', () => {
    expect(shipCategory(70)).toBe('cargo');
    expect(shipCategory(84)).toBe('tanker');
    expect(shipCategory(60)).toBe('passenger');
    expect(shipCategory(30)).toBe('fishing');
    expect(shipCategory(52)).toBe('service');
    expect(shipCategory(37)).toBe('pleasure');
    expect(shipCategory(35)).toBe('gov');
    expect(shipCategory(null)).toBe('unknown');
    expect(shipTypeName(52)).toBe('גוררת');
    expect(shipTypeName(79)).toBe('ספינת משא');
  });

  it('reads the flag from the MMSI', () => {
    expect(flagOf(428123456)).toBe('IL');
    expect(flagOf(230944050)).toBe('FI');
    expect(flagOf(538007976)).toBe('MH');
    expect(flagOf(352001234)).toBe('PA');
    expect(flagOf(982301234)).toBe('FI');
    expect(flagOf(123)).toBeNull();
    expect(flagEmoji('IL')).toBe('🇮🇱');
  });

  it('decodes the ETA without a year', () => {
    const now = Date.UTC(2026, 10, 14, 11, 0);
    // Digitraffic's packed form: month 11, day 14, 08:30.
    expect(etaFromPacked(750110, now)).toBe('2026-11-14T08:30:00.000Z');
    // January next year, not this one.
    expect(etaFromParts(1, 3, 6, 0, now)).toBe('2027-01-03T06:00:00.000Z');
    expect(etaFromParts(0, 0, 24, 60, now)).toBeNull();
  });

  it('measures the hull and reads destinations', () => {
    expect(dimensions(128, 22, 15, 7)).toEqual({ length: 150, beam: 22 });
    expect(dimensions(0, 0, 0, 0)).toEqual({ length: null, beam: null });
    expect(destinationName('IL HFA').port).toBe('חיפה');
    expect(destinationName('ILASH>CYLMS').port).toBe('לימסול');
    expect(destinationName('FISHING GROUNDS').port).toBeNull();
    expect(isStopped({ sog: 12, nav: 5 })).toBe(true);
    expect(isStopped({ sog: 12, nav: 0 })).toBe(false);
  });
});

describe('ship alerts', () => {
  it('flags rescue beacons and ships in trouble', async () => {
    const { shipAlert } = await import('./ais.ts');
    expect(shipAlert({ mmsi: 970123456 })).toContain('SART');
    expect(shipAlert({ mmsi: 972123456 })).toContain('MOB');
    expect(shipAlert({ mmsi: 974123456 })).toContain('EPIRB');
    expect(shipAlert({ mmsi: 428000001, nav: 6 })).toBe('עלתה על שרטון');
    expect(shipAlert({ mmsi: 428000001, nav: 2 })).toBe('לא בשליטה');
    expect(shipAlert({ mmsi: 428000001, nav: 0 })).toBeNull();
  });
});
