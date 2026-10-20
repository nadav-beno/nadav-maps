import { describe, expect, it } from 'vitest';
import { isPlacesSource, localPlacesSource } from './overture.ts';

describe('places sources', () => {
  it('recognises our own places tiles and Overture', () => {
    expect(isPlacesSource('overture')).toBe(true);
    expect(isPlacesSource(localPlacesSource('il'))).toBe(true);
    expect(isPlacesSource('omt')).toBe(false);
    expect(isPlacesSource(undefined)).toBe(false);
  });
});
