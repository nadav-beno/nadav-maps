import { render } from 'preact';
import { effect } from '@preact/signals';
import { parseUrl, providersFromEnv } from '@nm/core';
import { applyUrlFlags, featureCatalog, isEnabled, providers, sheet, viewStack } from '@nm/core/app';
import { createToolClient, setToolClient } from '@nm/tools';
import { FEATURES } from './features.ts';
import { App, isWide } from './shell/App.tsx';
import { createMap } from './shell/map.ts';
import { createContext } from './shell/registry.ts';
import { startUrlSync } from './shell/url-sync.ts';
import { initErrorReporting } from './shell/errors.ts';
import '@fontsource-variable/rubik';
import './styles.css';

initErrorReporting();

const config = providersFromEnv(import.meta.env as Record<string, string | undefined>, 'VITE_');
setToolClient(createToolClient(config, 'he'));
providers.value = config;

applyUrlFlags(location.search);
const initialUrl = parseUrl(location.href);
const map = createMap(document.getElementById('map')!, config, initialUrl);
// Handy when debugging on a phone: window.map in the console.
(window as unknown as { map: typeof map }).map = map;

featureCatalog.value = FEATURES.map(({ id, title, description, enabledByDefault }) => ({ id, title, description, enabledByDefault }));
const ctx = createContext(map, initialUrl);
for (const f of FEATURES) {
  if (!isEnabled(f.id, f.enabledByDefault)) continue;
  try {
    f.setup(ctx);
  } catch (e) {
    // One broken feature must never take the whole map down.
    console.error(`feature "${f.id}" failed to start`, e);
  }
}

render(<App />, document.getElementById('app')!);
startUrlSync(map);

// Keep the map's visual center above the bottom sheet / beside the side panel.
effect(() => {
  void sheet.value;
  void viewStack.value;
  const wide = isWide.value;
  requestAnimationFrame(() => {
    const cs = getComputedStyle(document.documentElement);
    const sheetH = (parseFloat(cs.getPropertyValue('--sheet-h')) || 0) + (parseFloat(cs.getPropertyValue('--tabs-h')) || 0);
    // The side panel is on the right in Hebrew (RTL), so the map's visual centre shifts left.
    const side = document.dir === 'rtl' ? { left: 0, right: 408 } : { left: 408, right: 0 };
    map.setPadding(wide ? { top: 0, bottom: 0, ...side } : { top: 110, bottom: sheetH, left: 0, right: 0 });
  });
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
