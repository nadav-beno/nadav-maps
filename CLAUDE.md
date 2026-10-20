# Nadav Maps: notes for contributors and AI agents

A public, Google-Maps-like web map. Hebrew-first UI, global by design (Israel is the first
region with full coverage). The full product spec lives in a Claude Doc; this file is how the code is laid out.

## Layout (pnpm workspace)

| Path | What |
|---|---|
| `apps/web` | The PWA shell: map, bottom sheet / side panel, URL sync, error reporting. Knows no feature by name except in `src/features.ts`. |
| `apps/server` | Hono server: `POST /api/tools/<name>` (REST) and `/mcp` (Model Context Protocol, stateless). Same tools as the web app. |
| `packages/core` | Pure helpers (geo, polyline, Hebrew search text, URL state, formatting, regions, provider config, opening hours, `map-link.ts` for pasted Google/Waze/Apple links, `local-search.ts`). `@nm/core/app` holds app state (signals, incl. `providers`), the feature API and shared UI (`LineChip` for transit lines, `elevationProfile` read from the terrain tiles). |
| `packages/tools` | Every data operation as a typed tool (`defineTool` + Zod schema): search, reverse geocode, details, nearby, directions (car, motorcycle, walk, bike; avoid options), route guidance (speed limits and lanes), search along a route, places inside a mall, photos (Wikimedia Commons), air quality (Open-Meteo). One schema drives web calls, REST and MCP. Providers: our own static geodata (`localgeo`, first where a region has it), Photon, Valhalla, Overpass, Wikipedia/Wikidata, Transitous (MOTIS API, public transit plans and departures), TomTom and HERE (traffic incidents and traffic-aware travel times, key-based; `core/src/tomtom.ts` and `core/src/here.ts` build the URLs, `trafficProvider()` in `region.ts` picks HERE where TomTom has no live traffic, e.g. Israel, and TomTom elsewhere when both keys exist). |
| `packages/features/*` | One package per feature (search, place, location, directions, navigation, transit, measure, layers, flight, saved, contribute, photos, settings). |
| `e2e` | Playwright tests with all network stubbed (`e2e/stubs.ts`); `e2e/geodata/` is a tiny generated geodata set. |
| `scripts/geodata` | Builds our own search/address/reverse/details files from an OSM extract (CI: `build-all.sh`, then `build.ts`). |
| `scripts/places` | Builds our own places tiles (`data/<region>/places.pmtiles`) from the newest Overture release with DuckDB + tippecanoe (CI: `build-all.sh`). |

## Rules

- **Features never import each other or the shell.** Only `@nm/core`, `@nm/core/app`, `@nm/tools` and libraries. `pnpm boundaries` enforces it. Cross-feature navigation goes through view kinds: `open({kind:'place'})`, `openPlace()`, `directionsTo()`, extension points (`registerPlaceAction`, `registerPlaceSection`, `registerHomeSection`, `registerMenuItem`, `registerSlot`).
- **Everything shareable lives in the URL** (`packages/core/src/url-state.ts`): a screen sets `view.props.url` and the shell syncs it with history.
- **Nothing regional is hard-coded.** Units, time zone, language and coverage come from `packages/core/src/region.ts`. Provider URLs come from env (`VITE_PHOTON_URL`, `VITE_VALHALLA_URL`, `VITE_OVERPASS_URL`, `VITE_VECTOR_TILES_URL`, `VITE_GLYPHS_URL`, `VITE_TERRAIN_URL`, `VITE_PLACES_URL`, `VITE_SATELLITE_URL`, `VITE_TRANSIT_URL`, `VITE_TOMTOM_KEY`, `VITE_HERE_KEY`, `VITE_ATLAS_URL`, `VITE_ATLAS_KEY`, `VITE_FLIGHTS_URL`, `VITE_GEODATA_URL`, `VITE_PHOTOS_URL`, `VITE_AIR_QUALITY_URL`; on the server the same names without `VITE_`; an empty value switches a source off). Keys are optional: `VITE_TOMTOM_KEY` and `VITE_HERE_KEY` (live traffic, incidents, traffic-aware car times) are empty by default and all traffic UI stays hidden until one is set; on localhost `?tomtom=<key>` / `?here=<key>` / `?atlas=<key>` set them at runtime (the e2e tests use `?tomtom=test`, `?here=test` and `?atlas=test`). Atlas is our own traffic service (measured speeds and official incidents, Hong Kong only), shown only from a fresh status and hidden at its `stale_after` (`docs/data-sources.md#atlas-our-own-traffic-service`). Policies, limits and risks of every source: `docs/data-sources.md`.
- **Our own geodata:** regions with `geodata` in `region.ts` (Israel) are searched, reverse geocoded and detailed from static JSON we build weekly in CI from the OSM extract (`scripts/geodata/`, formats and shared helpers in `packages/core/src/geoindex.ts`, provider `packages/tools/src/providers/localgeo.ts`); Photon/Overpass are the fallback. `GEODATA_URL` defaults to the site's own `<base>data/` in the web build and is off on the server unless set. After changing the builder run `pnpm geodata:fixture` (rebuilds `e2e/geodata/` from `scripts/geodata/fixtures/`; a unit test checks it is current). E2E tests get 404 for `data/` unless they call `stubGeodata(page)`.
- **Borders:** the map shows the West Bank and Gaza as part of Israel (the owner's choice). The list lives in `packages/core/src/territory.ts`; the base map style hides the border and labels, the offline world map dissolves the territory into its country, Photon results name the country, and the geodata builder skips the territory's own region entries.
- **Privacy:** never log or send coordinates or search text to our servers' logs or to error reporting.
- **New data operation?** Add a tool in `packages/tools/src/tools/index.ts` and list it in `TOOLS`; it appears in the web client, REST and MCP automatically.
- **Hebrew UI text** in the components; code, comments and commits in English.
- The base map style is ours: `apps/web/src/shell/basemap/` (layers, palette, POI categories, icons drawn from Maki). Icons: add the Maki name in `poi.ts`, then `node --experimental-strip-types scripts/gen-maki.mjs`.
- Map layers must be re-added in `ctx.onStyle` (dark mode and the map type swap the style).
- **Icons:** `<Icon name="…">` from `@nm/core/app` draws Material Symbols (rounded). Only icons listed in `scripts/gen-icons.mjs` are bundled; add a name there and run `node scripts/gen-icons.mjs`. Map POI icons are Maki (`apps/web/src/shell/basemap/maki-paths.ts`).
- **Businesses:** in regions with geodata (Israel) they come from our own `places.pmtiles` (`scripts/places`, source `places-<region>`); elsewhere straight from Overture's public PMTiles (`{release}` resolves to the newest release, see `places-source.ts`). Both have the same properties and ids `ovt:<uuid>`; read them with `queryPlaceFeatures(map)` / `isPlacesSource(id)`, never one source by name. Categories, colours and icons live in `packages/core/src/overture.ts`.
- **Incognito** (`incognito` in `@nm/core/app`): while on, nothing is remembered (search recents, history, recent routes, timeline). Check it before saving anything about what the user did.
- **Embed:** `?embed=1` shows only the map and the card (`embedded` signal); the URL sync keeps the flag.
- **Location:** fixes that jump impossibly fast are dropped as GPS jamming (`plausibleFix` in `core/src/nav.ts`). The first location request shows our own explanation first; e2e tests skip it (`stubNetwork` sets `nm:location:explained`). Granted location/motion are remembered (`nm:location:granted`, `nm:motion:granted`): location restarts at launch, and on iPhone motion is re-requested on the first tap (it must come from a tap). The "הרשאות" screen explains how to make it permanent in the phone's settings.
- **Map types:** `default`, `bright` (vivid `BRIGHT` palette, always light), `satellite` (always dark labels), `terrain`.
- **UI:** Google-Maps-style shell: bottom tabs (`registerTab`), floating map controls (`registerSlot('controls', …)`), views can hide the search bar (`registerView(kind, View, { hideTop: true })`).

## Adding a feature

```bash
pnpm new-feature trip-planner "תכנון טיול"
# add "@nm/feature-trip-planner": "workspace:*" to apps/web/package.json, list it in apps/web/src/features.ts
pnpm install
```

Features can be switched on/off by users (Settings) and by URL (`?flags=photos,-saved`).

## Commands

```bash
pnpm dev          # web app on http://localhost:5173
pnpm server       # REST + MCP on http://localhost:8787
pnpm check        # boundaries + typecheck + unit tests + build (run before every push)
pnpm e2e          # Playwright (needs a Chromium; in CI it is installed by the workflow)
```

Unit tests sit next to the code as `*.test.ts` (Vitest). E2E tests must stub every network call.
