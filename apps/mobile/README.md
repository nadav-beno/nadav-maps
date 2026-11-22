# Nadav Maps for iPhone

A native shell ([Capacitor](https://capacitorjs.com) 8) around the deployed site,
`https://nadav-beno.github.io/nadav-maps/`. Every deploy of the site reaches the app at its next
launch; only changes in this folder need a new build from Xcode.

What the shell adds over the PWA:

- **Background location.** `navigator.geolocation` is served by the native location manager
  (`@capacitor-community/background-geolocation`, wired in `packages/core/src/app/native.ts`).
  While "אנשים" shares my location with someone (`backgroundLocation` in `@nm/core/app`), the
  watcher runs in background mode, so friends see live updates with the app closed. iOS shows the
  blue location pill meanwhile. Nobody watching: foreground only, as on the web.
- **One permission, kept for good**: the app's own (Settings > Nadav Maps > Location), with no
  second "the website wants your location" prompt.
- A home-screen icon and launch screen (`node scripts/gen-ios-images.mjs`), and an offline page
  (`www/offline.html`, `server.errorPath`) when the site can't load.

Inside the app `isNativeApp()` is true. Features never import Capacitor; they use the standard web
APIs and the helpers in `@nm/core/app`. `e2e/native-app.spec.ts` fakes the native bridge.

## Build and install (free Apple ID, no paid developer account)

Needs a Mac with Xcode (App Store) and Node 22+ with pnpm (`corepack enable`).

```bash
git clone https://github.com/nadav-beno/nadav-maps.git
cd nadav-maps
corepack enable
pnpm ios          # pnpm install + cap sync ios + opens Xcode
```

In Xcode: target **App** > Signing & Capabilities > Team: your Apple ID ("Personal Team"). Plug in
the iPhone, pick it as the run destination, press Run. On the iPhone, once: Settings > Privacy &
Security > Developer Mode (on, restart), then Settings > General > VPN & Device Management > your
Apple ID > Trust.

A free personal team signs the app for **7 days**. To renew: plug in, press Run again (data stays).
Up to 3 such apps per device; no TestFlight, no push notifications.

## Updating

- Site changes: nothing to do, the app loads the live site.
- `apps/mobile` changes (plugins, `capacitor.config.json`, `Info.plist`): `git pull && pnpm ios`, Run.
- CI (`.github/workflows/ios.yml`) builds the project for the simulator without signing on every
  PR that touches it, and checks that `cap sync` leaves the committed project unchanged.
