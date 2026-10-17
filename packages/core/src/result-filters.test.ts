import { describe, expect, it } from 'vitest';
import { parseFilters, toggleFilter, topCuisines } from './result-filters.ts';
import { parseUrl } from './url-state.ts';

describe('result filters', () => {
  it('toggles tokens and keeps one cuisine', () => {
    expect(toggleFilter(undefined, 'open')).toBe('open');
    expect(toggleFilter('open', 'open')).toBeUndefined();
    expect(toggleFilter('open,c-pizza', 'c-sushi')).toBe('open,c-sushi');
    expect([...parseFilters('open,access')]).toEqual(['open', 'access']);
  });
  it('finds the common cuisines', () => {
    expect(topCuisines(['pizza;italian', 'pizza', 'sushi', 'italian', undefined])).toEqual(['pizza', 'italian']);
  });
  it('survives the URL', () => {
    expect(parseUrl('https://x/?q=a&filter=open,c-middle_eastern').filter).toBe('open,c-middle_eastern');
    expect(parseUrl('https://x/?embed=1').embed).toBe(true);
    expect(parseUrl('https://x/?route=1,2;3,4&mode=motorcycle').mode).toBe('motorcycle');
  });
});
