# 003: Open providers now, self-hosted later, regions as data

**Decision.** Start on free public services: OpenFreeMap tiles, Photon search, Valhalla (FOSSGIS) routing,
Overpass details. All URLs are configuration. Regional behaviour (units, time zone, languages, coverage of
transit and traffic) lives in `packages/core/src/region.ts`.

**Why.** Zero cost and zero accounts to launch, while public instances have fair-use limits. When traffic
grows we self-host Photon and Valhalla (Israel extract first, then country by country) and only change env.
Adding a country means adding a region entry and, if needed, pointing providers at our servers.

**Not yet.** Live traffic (needs a commercial feed such as TomTom) and public transit (Israel: GTFS + SIRI
real-time, needs registration with the Ministry of Transport) wait for a server and accounts.
