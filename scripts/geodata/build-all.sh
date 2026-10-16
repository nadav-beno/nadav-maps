#!/usr/bin/env bash
# Builds our static geodata for every region with a `geodata` entry in packages/core/src/region.ts:
# download the OpenStreetMap extract, keep what we index, export it as GeoJSONSeq, run build.ts.
#
#   scripts/geodata/build-all.sh <out dir> [work dir]
#
# Needs curl, osmium-tool (`sudo apt-get install -y osmium-tool`) and Node 22. Runs in the
# "Deploy to GitHub Pages" workflow; the output goes to <site>/data/<region>/.
set -euo pipefail

OUT="${1:?usage: build-all.sh <out dir> [work dir]}"
WORK="${2:-${RUNNER_TEMP:-/tmp}/geodata-work}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT" "$WORK"

node --experimental-strip-types "$ROOT/scripts/geodata/regions.ts" | while read -r id url; do
  echo "::group::geodata $id"
  pbf="$WORK/$id.osm.pbf"
  echo "downloading $url"
  curl -fsSL --retry 3 --retry-delay 30 -A 'NadavMaps-geodata (+https://github.com/nadav-beno/nadav-maps)' -o "$pbf" "$url"
  ls -l "$pbf"
  # The extract's own timestamp, for the manifest ("source").
  stamp="$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$pbf" 2>/dev/null || true)"

  # Only named things, addresses, places and municipal boundaries (osmium keeps the nodes and
  # members they reference, so geometries stay complete).
  osmium tags-filter "$pbf" nwr/name nwr/name:he nwr/addr:housenumber nwr/place r/boundary=administrative \
    --overwrite -o "$WORK/$id.filtered.osm.pbf"
  # GeoJSONSeq with each object's OSM type and id (@type/@id; the unique id is a second copy).
  # Broken multipolygons are skipped with a message; only a missing/empty output is fatal.
  osmium export "$WORK/$id.filtered.osm.pbf" -f geojsonseq -a type,id --add-unique-id=type_id \
    --geometry-types=point,linestring,polygon --overwrite -o "$WORK/$id.geojsonseq" ||
    { [ -s "$WORK/$id.geojsonseq" ] && echo "::warning::osmium export reported errors for $id; continuing"; }
  ls -l "$WORK/$id.geojsonseq"

  node --experimental-strip-types "$ROOT/scripts/geodata/build.ts" --region "$id" \
    --input "$WORK/$id.geojsonseq" --out "$OUT/$id" --source "$url${stamp:+ ($stamp)}"
  du -sh "$OUT/$id"
  rm -f "$WORK/$id".*
  echo "::endgroup::"
done
