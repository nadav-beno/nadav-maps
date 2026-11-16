// Nadav Maps service worker: app shell offline + a capped cache of map tiles.
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 2000;
// Every deploy brings new hashed files; keep about the last three builds' worth, not all of them.
const MAX_ASSETS = 60;
// A page that has not answered by then (a weak signal) opens from the cached shell instead.
const NAVIGATE_TIMEOUT = 4000;
// The bundled world map (countries, cities): the map is never blank on a plane.
// Its name carries a version; bump it with the file (see packages/features/flight/scripts/gen-world.mjs).
const PRECACHE = ['./', 'manifest.webmanifest', 'favicon.svg', 'offline/world-1.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (![SHELL, TILES].includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

let trimmingAssets = false;
async function trimAssets() {
  if (trimmingAssets) return;
  trimmingAssets = true;
  try {
    const cache = await caches.open(SHELL);
    const assets = (await cache.keys()).filter((r) => new URL(r.url).pathname.includes('/assets/'));
    for (let i = 0; i < assets.length - MAX_ASSETS; i++) await cache.delete(assets[i]);
  } finally {
    trimmingAssets = false;
  }
}

/** The network's answer, or a rejection once `ms` pass without one. */
function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(TILES);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  } finally {
    trimming = false;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages: network first, cached shell when offline.
  if (req.mode === 'navigate') {
    const network = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put('./', copy));
      }
      return res;
    });
    event.respondWith(
      within(network, NAVIGATE_TIMEOUT).catch(async () => (await caches.match('./')) || network),
    );
    return;
  }

  // Our own hashed assets never change: cache first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && url.pathname.includes('/assets/')) {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(req, copy)).then(trimAssets);
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Map tiles, styles, fonts and sprites: serve cached, refresh in the background.
  if (url.hostname === 'tiles.openfreemap.org') {
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone()).then(trimTiles);
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      }),
    );
  }
  // Everything else (search, routing APIs) goes straight to the network.
});
