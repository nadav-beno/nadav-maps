import { describe, expect, it } from 'vitest';
import type { Route } from '@nm/core';
import { moveStop, routeContext } from './index.tsx';

const route = (durationS: number, distanceM: number, tags?: Route['tags']): Route => ({ mode: 'car', durationS, distanceM, geometry: [], steps: [], tags });

describe('directions helpers', () => {
  it('moves a stop', () => {
    expect(moveStop(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveStop(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
  it('explains each route', () => {
    const rs = [route(1200, 20000, ['toll']), route(1500, 17000)];
    const t = (r: Route) => r.durationS;
    expect(routeContext(rs, 0, 0, t)).toBe('המסלול הכי מהיר · חוסך 5 דק׳');
    expect(routeContext(rs, 1, 0, t)).toBe('ארוך ב-5 דק׳ · מסלול קצר יותר · בלי כביש אגרה');
  });
});
