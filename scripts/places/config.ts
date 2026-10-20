#!/usr/bin/env node
// Prints what build.py needs as JSON: the regions with `geodata` (packages/core/src/region.ts) and
// the Overture categories shown early (packages/core/src/overture.ts), so the map and the builder agree.
import { REGIONS } from '../../packages/core/src/region.ts';
import { OVERTURE_CATEGORIES, PROMINENT_GROUPS } from '../../packages/core/src/overture.ts';

const prominent = Object.entries(OVERTURE_CATEGORIES)
  .filter(([, [group]]) => PROMINENT_GROUPS.includes(group))
  .map(([c]) => c);
const regions = REGIONS.filter((r) => r.geodata && r.bbox).map((r) => ({ id: r.geodata!.id, bbox: r.bbox }));
console.log(JSON.stringify({ regions, prominent }));
