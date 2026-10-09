import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { buildStyle } from './style.ts';
import { poiImageList, POI_GROUPS } from './poi.ts';
import { MAKI } from './maki-paths.ts';

describe('base map style', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`is a valid MapLibre style (${theme})`, () => {
      const style = buildStyle(theme, DEFAULT_PROVIDERS);
      expect(validateStyleMin(style)).toEqual([]);
      const ids = style.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it('shows names in the UI language first', () => {
    const style = buildStyle('light', DEFAULT_PROVIDERS, 'he');
    const city = style.layers.find((l) => l.id === 'place-city') as { layout: { 'text-field': unknown } };
    expect(JSON.stringify(city.layout['text-field'])).toContain('"name:he"');
  });

  it('can run without hill shading', () => {
    const style = buildStyle('light', { ...DEFAULT_PROVIDERS, terrain: '' });
    expect(style.sources.terrain).toBeUndefined();
    expect(style.layers.some((l) => l.type === 'hillshade')).toBe(false);
  });

  it('has an icon for every place category, drawn from bundled icons', () => {
    const images = poiImageList('light');
    for (const g of Object.values(POI_GROUPS)) for (const cls of Object.keys(g.classes)) expect(images.some((i) => i.id === `nm-poi-${cls}`)).toBe(true);
    for (const i of images) if (i.icon) expect(MAKI[i.icon], i.icon).toBeTruthy();
    expect(MAKI.mountain).toBeTruthy();
  });
});
