import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { buildStyle } from './style.ts';
import { overtureIconExpression, poiImageList, POI_GROUPS } from './poi.ts';
import { parseReleases } from './places-source.ts';
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

  const SRC = { ...DEFAULT_PROVIDERS, places: 'pmtiles://example/places', contours: 'contour://{z}/{x}/{y}' };
  for (const mapType of ['default', 'satellite', 'terrain'] as const) {
    it(`is valid with every option on (${mapType})`, () => {
      const style = buildStyle('light', SRC, 'he', { mapType, transit: true, bike: true, buildings3d: false });
      expect(validateStyleMin(style)).toEqual([]);
      const ids = style.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain('ovt-poi');
      expect(ids).toContain('transit-line');
      expect(ids).not.toContain('building-3d');
      if (mapType === 'satellite') {
        expect(ids[1]).toBe('satellite');
        expect(ids).not.toContain('landuse');
      }
      if (mapType === 'terrain') expect(ids).toContain('contour');
    });
  }

  it('falls back to the default map when no satellite imagery is configured', () => {
    const style = buildStyle('light', { ...SRC, satellite: '' }, 'he', { mapType: 'satellite' });
    expect(style.sources.satellite).toBeUndefined();
    expect(style.layers.some((l) => l.id === 'landuse')).toBe(true);
  });

  it('leaves Overture out when it is switched off', () => {
    const style = buildStyle('light', { ...SRC, places: '' });
    expect(style.sources.overture).toBeUndefined();
    expect(style.layers.some((l) => l.id.startsWith('ovt-'))).toBe(false);
  });

  it('finds the newest Overture release in a bucket listing', () => {
    const xml = '<ListBucketResult><CommonPrefixes><Prefix>tiles/2026-08-19.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-09-23.1/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-09-23.0/</Prefix></CommonPrefixes></ListBucketResult>';
    expect(parseReleases(xml)).toEqual(['2026-09-23.1', '2026-09-23.0', '2026-08-19.0']);
  });

  it('has a drawn image for every Overture category', () => {
    const ids = new Set(poiImageList('dark').map((i) => i.id));
    const expr = JSON.stringify(overtureIconExpression());
    for (const m of expr.matchAll(/"(nm-[a-z-]+)"/g)) expect(ids.has(m[1]), m[1]).toBe(true);
  });

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
