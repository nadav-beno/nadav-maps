Atlas v4 offline integration fixtures
Use manifest.json to validate SHA-256 hashes.
Intercept all Atlas requests locally for network-free e2e tests.
flow-fresh.pbf, flow-stale.pbf and flow-empty.pbf are fixed test fixtures, not live traffic.
Status timestamps are fixed; use a controlled test clock.
Production immutable tiles use status_only freshness; stale=true fixture tests legacy filtering.
No API, Sites owner, or admin key is included.
