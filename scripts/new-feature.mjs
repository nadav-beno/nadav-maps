#!/usr/bin/env node
// Scaffold a new feature package: pnpm new-feature <name> "<Hebrew title>"
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [name, title = name] = process.argv.slice(2);
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('usage: pnpm new-feature <kebab-name> "<כותרת>"');
  process.exit(1);
}
const dir = join('packages/features', name);
if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}
mkdirSync(join(dir, 'src'), { recursive: true });
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify(
    {
      name: `@nm/feature-${name}`,
      version: '0.0.0',
      private: true,
      type: 'module',
      exports: { '.': './src/index.tsx' },
      dependencies: { '@nm/core': 'workspace:*', '@nm/tools': 'workspace:*', '@preact/signals': '^2.11.3', preact: '^11.0.1' },
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(dir, 'src/index.tsx'),
  `import { back, defineFeature, open, type ViewProps } from '@nm/core/app';

function MainView(_: ViewProps) {
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>→</button>
        <h2>${title}</h2>
      </header>
      <p class="muted">עוד אין כאן כלום.</p>
    </div>
  );
}

export default defineFeature({
  id: '${name}',
  title: '${title}',
  enabledByDefault: false,
  setup(ctx) {
    ctx.registerView('${name}', MainView);
    ctx.registerMenuItem({ id: '${name}', label: '${title}', icon: '✨', order: 50, run: () => open({ kind: '${name}' }) });
  },
});
`,
);
console.log(`Created ${dir}.
Next: add "@nm/feature-${name}": "workspace:*" to apps/web/package.json,
list it in apps/web/src/features.ts, and run pnpm install.`);
