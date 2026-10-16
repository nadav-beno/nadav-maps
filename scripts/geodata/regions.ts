#!/usr/bin/env node
// Prints "<id> <extract url>" for every region with a `geodata` entry (packages/core/src/region.ts),
// one per line, for build-all.sh.
import { REGIONS } from '../../packages/core/src/region.ts';

for (const r of REGIONS) if (r.geodata) console.log(`${r.geodata.id} ${r.geodata.extract}`);
