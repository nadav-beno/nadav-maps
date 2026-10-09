# Nadav Maps: notes for contributors and AI agents

A public, Google-Maps-like web map. Hebrew-first UI, global by design (Israel is the first
region with full coverage). The full product spec lives in a Claude Doc; this file is how the code is laid out.

## Layout (pnpm workspace)

| Path | What |
|---|---|
| `apps/web` | The PWA shell: map, bottom sheet / side panel, URL sync, error reporting. Knows no feature by name except in `src/features.ts`. |
| `apps/server` | Hono server: `POST /api/tools/<name>` (REST) and `/mcp` (Model Context Protocol, stateless). Same tools as the web app. |
| `packages/core` | Pure helpers (geo, polyline, Hebrew search text, URL state, formatting, regions, provider config). `@nm/core/app` holds app state (signals) and the feature API. |
| `packages/tools` | Every data operation as a typed tool (`defineTool` + Zod schema): search, reverse geocode, details, nearby, directions. One schema drives web calls, REST and MCP. Providers: Photon, Valhalla, Overpass. |
| `packages/features/*` | One package per feature (search, place, location, directions, navigation, saved, photos, settings). |
| `e2e` | Playwright tests with all network stubbed (`e2e/stubs.ts`). |

## Rules

- **Features never import each other or the shell.** Only `@nm/core`, `@nm/core/app`, `@nm/tools` and libraries. `pnpm boundaries` enforces it. Cross-feature navigation goes through view kinds: `open({kind:'place'})`, `openPlace()`, `directionsTo()`, extension points (`registerPlaceAction`, `registerPlaceSection`, `registerHomeSection`, `registerMenuItem`, `registerSlot`).
- **Everything shareable lives in the URL** (`packages/core/src/url-state.ts`): a screen sets `view.props.url` and the shell syncs it with history.
- **Nothing regional is hard-coded.** Units, time zone, language and coverage come from `packages/core/src/region.ts`. Provider URLs come from env (`VITE_PHOTON_URL`, `VITE_VALHALLA_URL`, `VITE_OVERPASS_URL`, `VITE_STYLE_LIGHT`, `VITE_STYLE_DARK`; on the server the same names without `VITE_`).
- **Privacy:** never log or send coordinates or search text to our servers' logs or to error reporting.
- **New data operation?** Add a tool in `packages/tools/src/tools/index.ts` and list it in `TOOLS`; it appears in the web client, REST and MCP automatically.
- **Hebrew UI text** in the components; code, comments and commits in English.
- Map layers must be re-added in `ctx.onStyle` (dark mode swaps the style).

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
