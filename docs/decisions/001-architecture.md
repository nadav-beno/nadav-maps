# 001: Feature packages around a thin shell

**Decision.** The web app is a thin shell plus one workspace package per feature. Features talk only
through `@nm/core/app` (state, navigation, extension points) and `@nm/tools` (data). An import rule
(`scripts/check-boundaries.mjs`) runs in CI.

**Why.** The product will grow to 100+ features built over time, often by AI agents. Isolated packages
mean a new feature cannot break another one by reaching into its internals, can be switched off with a
flag, and can be deleted by removing one line in `apps/web/src/features.ts`.

**Stack.** Preact + signals (small bundle for mobile), MapLibre GL (open, vector), Vite, TypeScript strict.
