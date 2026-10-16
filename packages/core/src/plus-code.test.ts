import { describe, expect, it } from 'vitest';
import {
  decodePlusCode,
  displayPlusCode,
  encodePlusCode,
  isFullPlusCode,
  isShortPlusCode,
  isValidPlusCode,
  parsePlusCode,
  recoverPlusCode,
  shortenPlusCode,
} from './plus-code.ts';

// Vectors from the Open Location Code test data (test_data/encoding.csv, shortCodeTests.csv, validityTests.csv).
describe('Plus Codes (Open Location Code)', () => {
  it.each([
    [20.375, 2.775, 6, '7FG49Q00+'],
    [20.3700625, 2.7821875, 10, '7FG49QCJ+2V'],
    [20.3701125, 2.782234375, 11, '7FG49QCJ+2VX'],
    [20.3701135, 2.78223535156, 13, '7FG49QCJ+2VXGJ'],
    [47.0000625, 8.0000625, 10, '8FVC2222+22'],
    [-41.2730625, 174.7859375, 10, '4VCPPQGP+Q9'],
    [0.5, -179.5, 4, '62G20000+'],
    [-89.5, -179.5, 4, '22220000+'],
    [20.5, 2.5, 4, '7FG40000+'],
    [-89.9999375, -179.9999375, 10, '22222222+22'],
    [0.5, 179.5, 4, '6VGX0000+'],
    [1, 1, 11, '6FH32222+222'],
    [90, 1, 4, 'CFX30000+'],
    [92, 1, 4, 'CFX30000+'],
    [1, 180, 4, '62H20000+'],
    [1, 181, 4, '62H30000+'],
    [90, 1, 10, 'CFX3X2X2+X2'],
  ])('encodes %f, %f at length %i as %s', (lat, lng, len, code) => {
    expect(encodePlusCode(lat, lng, len)).toBe(code);
  });

  it('decodes to the cell that was encoded', () => {
    const a = decodePlusCode('7FG49QCJ+2V');
    expect(a.south).toBeCloseTo(20.37, 10);
    expect(a.west).toBeCloseTo(2.782125, 10);
    expect(a.north).toBeCloseTo(20.370125, 10);
    expect(a.east).toBeCloseTo(2.78225, 10);
    expect(a.codeLength).toBe(10);
    const p = decodePlusCode('7FG49Q00+');
    expect([p.south, p.west, p.north, p.east]).toEqual([20.35, 2.75, 20.4, 2.8]);
    expect(decodePlusCode('7fg49qcj+2vx').codeLength).toBe(11);
  });

  it('round-trips points around the world', () => {
    for (const [lat, lng] of [[32.0801, 34.7792], [-33.8688, 151.2093], [64.1466, -21.9426], [0, 0], [-0.0001, -0.0001]]) {
      for (const len of [10, 11, 12]) {
        const a = decodePlusCode(encodePlusCode(lat, lng, len));
        expect(lat).toBeGreaterThanOrEqual(a.south);
        expect(lat).toBeLessThan(a.north);
        expect(lng).toBeGreaterThanOrEqual(a.west);
        expect(lng).toBeLessThan(a.east);
      }
    }
  });

  it('checks validity', () => {
    for (const c of ['8FWC2345+G6', '8FWC2345+G6G', '8fwc2345+', '8FWCX400+', 'WC2345+G6g', '2345+G6', '45+G6', '+G6']) {
      expect(isValidPlusCode(c), c).toBe(true);
    }
    for (const c of ['G+', '+', '8FWC2345+G', '8FWC2_45+G6', '8FWC2η45+G6', '8FWC2345+G6+', '8FWC2345G6+', '8FWC2300+G6', 'WC2300+G6g', 'WC2345+G', '']) {
      expect(isValidPlusCode(c), c).toBe(false);
    }
    expect(isShortPlusCode('2345+G6')).toBe(true);
    expect(isFullPlusCode('2345+G6')).toBe(false);
    expect(isFullPlusCode('8FWC2345+G6')).toBe(true);
    // Latitude digit beyond 90°.
    expect(isFullPlusCode('XFWC2345+G6')).toBe(false);
  });

  it.each([
    ['9C3W9QCJ+2VX', 51.3701125, -1.217765625, '+2VX'],
    ['9C3W9QCJ+2VX', 51.3708675, -1.217765625, 'CJ+2VX'],
    ['9C3W9QCJ+2VX', 51.3693575, -1.217765625, 'CJ+2VX'],
    ['9C3W9QCJ+2VX', 51.3701125, -1.218520625, 'CJ+2VX'],
    ['9C3W9QCJ+2VX', 51.3701125, -1.217010625, 'CJ+2VX'],
    ['9C3W9QCJ+2VX', 51.3852125, -1.217765625, '9QCJ+2VX'],
    ['9C3W9QCJ+2VX', 51.3550125, -1.217765625, '9QCJ+2VX'],
  ])('shortens %s near %f, %f to %s and recovers it', (full, lat, lng, short) => {
    expect(shortenPlusCode(full, lat, lng)).toBe(short);
    expect(recoverPlusCode(short, lat, lng)).toBe(full);
  });

  it('recovers across a cell edge, to the nearest match', () => {
    // Reference just over the edge of the 1° cell: the nearest "CJ+2VX" lies in the neighbouring cell.
    const full = encodePlusCode(32.0001, 34.7801);
    const short = full.slice(4);
    expect(recoverPlusCode(short, 31.99, 34.78)).toBe(full);
    expect(recoverPlusCode(short, 32.4, 34.9)).toBe(full);
  });

  it('shows the local code with the town, like Google', () => {
    const d = displayPlusCode(32.0801, 34.7792, 'תל אביב-יפו');
    expect(d.code).toBe(encodePlusCode(32.0801, 34.7792));
    expect(d.code).toMatch(/^8G4P/);
    expect(d.text).toBe(`${d.code.slice(4)} תל אביב-יפו`);
    expect(displayPlusCode(32.0801, 34.7792).text).toBe(d.code);
  });

  it('finds Plus Codes in typed text', () => {
    expect(parsePlusCode('8G4P3QHF+2R')).toEqual({ code: '8G4P3QHF+2R', full: true, locality: undefined });
    expect(parsePlusCode('3qhf+2r תל אביב-יפו')).toEqual({ code: '3QHF+2R', full: false, locality: 'תל אביב-יפו' });
    expect(parsePlusCode('3QHF+2R, Tel Aviv')).toEqual({ code: '3QHF+2R', full: false, locality: 'Tel Aviv' });
    expect(parsePlusCode('קפה')).toBeNull();
    expect(parsePlusCode('דיזנגוף 50')).toBeNull();
    expect(parsePlusCode('a+b')).toBeNull();
  });
});
