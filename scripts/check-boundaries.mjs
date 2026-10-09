#!/usr/bin/env node
// Architecture guard: features may import only @nm/core, @nm/tools and libraries,
// never another feature or the app shell. core imports nothing of ours; tools imports only core.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  { dir: 'packages/core/src', forbid: /^@nm\/(?!core)/, why: 'core must not depend on other packages' },
  { dir: 'packages/tools/src', forbid: /^@nm\/(?!core|tools)/, why: 'tools may only use core' },
  { dir: 'packages/features', forbid: /^(@nm\/feature-|@nm\/web|@nm\/server|\.\.\/\.\.\/)/, why: 'features must not import other features or the shell' },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

let errors = 0;
for (const rule of RULES) {
  for (const file of walk(rule.dir)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (rule.forbid.test(spec)) {
        console.error(`${file}: imports "${spec}" (${rule.why})`);
        errors++;
      }
    }
  }
}
if (errors) process.exit(1);
console.log('boundaries ok');
