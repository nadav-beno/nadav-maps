import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { buildStyle, DARK, LIGHT } from './style.ts';
import { offlineLayers, WORLD_SOURCE } from './offline.ts';

describe('offline world layers', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`are valid in the base style and use its palette (${theme})`, () => {
      const base = buildStyle(theme, DEFAULT_PROVIDERS);
      const { ground, labels } = offlineLayers(theme, true);
      const style = {
        ...base,
        sources: { ...base.sources, [WORLD_SOURCE]: { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } } },
        layers: [base.layers[0], ...ground, ...base.layers.slice(1), ...labels],
      };
      expect(validateStyleMin(style)).toEqual([]);
      const c = theme === 'dark' ? DARK : LIGHT;
      expect(ground.find((l) => l.id === 'world-ocean')).toMatchObject({ paint: { 'background-color': c.water } });
      expect(ground.find((l) => l.id === 'world-land')).toMatchObject({ paint: { 'fill-color': c.land } });
    });
  }

  it('start hidden unless switched on', () => {
    const { ground, labels } = offlineLayers('light', false);
    for (const l of [...ground, ...labels]) expect(l.layout?.visibility).toBe('none');
  });
});
