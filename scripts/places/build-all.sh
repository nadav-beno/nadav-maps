#!/usr/bin/env bash
# Builds our own places tiles (restaurants, shops, attractions...) for every region with `geodata`
# in packages/core/src/region.ts, from the newest Overture Maps release:
#
#   scripts/places/build-all.sh <out dir> [release]
#   PLACES_INPUT=some.parquet scripts/places/build-all.sh <out dir> test   (local check, no download)
#
# Writes <out dir>/<region>/places.pmtiles (+ places.json with the release). Needs Node 22,
# Python 3 with duckdb (`pip install duckdb`) and tippecanoe (`sudo apt-get install -y tippecanoe`).
# Runs in the "Deploy to GitHub Pages" workflow; the files go to <site>/data/<region>/.
set -euo pipefail

OUT="${1:?usage: build-all.sh <out dir> [release]}"
RELEASE="${2:-$(curl -fsSL --retry 3 https://stac.overturemaps.org/catalog.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["latest"])')}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/places-work"
mkdir -p "$OUT" "$WORK"
echo "Overture release $RELEASE"

node --experimental-strip-types "$ROOT/scripts/places/config.ts" > "$WORK/config.json"
python3 -c 'import json,sys; json.dump(json.load(open(sys.argv[1]))["prominent"], open(sys.argv[2], "w"))' "$WORK/config.json" "$WORK/prominent.json"
python3 -c 'import json,sys; [print(r["id"], ",".join(map(str, r["bbox"]))) for r in json.load(open(sys.argv[1]))["regions"]]' "$WORK/config.json" |
while read -r id bbox; do
  echo "::group::places $id"
  python3 -I "$ROOT/scripts/places/build.py" $([ -n "${PLACES_INPUT:-}" ] && echo --input "$PLACES_INPUT" || echo --release "$RELEASE") --bbox "$bbox" --prominent "$WORK/prominent.json" --out "$WORK/$id.geojsonseq"
  mkdir -p "$OUT/$id"
  # Every place is kept from its own first zoom (`mz`) on (-r1 and the -j filter); only an over-full
  # tile (a dense mall at z13) sheds places. Above z15 the map stretches the z15 tiles.
  tippecanoe -q --force -o "$OUT/$id/places.pmtiles" -l place -Z13 -z15 -r1 --drop-densest-as-needed \
    -j '{"place":["any",["<=","mz",13],["all",["==","mz",14],[">=","$zoom",14]],[">=","$zoom",15]]}' \
    --no-tile-stats --attribution='© Overture Maps Foundation' "$WORK/$id.geojsonseq"
  printf '{"release":"%s","built":"%s"}\n' "$RELEASE" "$(date -u +%FT%TZ)" > "$OUT/$id/places.json"
  ls -l "$OUT/$id"
  rm -f "$WORK/$id.geojsonseq"
  echo "::endgroup::"
done
