#!/usr/bin/env bash
# Installs the command-line tools the data builds need (osmium-tool, tippecanoe) on a GitHub runner.
# apt first; when the Ubuntu mirrors are unreachable from the runners (as on 2026-11-11, when every
# Places/Geodata check failed on "Temporary failure resolving 'azure.archive.ubuntu.com'"), the same
# packages come from conda-forge through micromamba instead. The tools are on PATH from the next step.
#
# Usage: bash scripts/ci/install-tools.sh osmium-tool [tippecanoe ...]
set -euo pipefail
[ $# -gt 0 ] || { echo "usage: $0 <package>..." >&2; exit 2; }

apt_opts=(-o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)
if timeout 150 sudo apt-get "${apt_opts[@]}" update -qq &&
   timeout 150 sudo apt-get "${apt_opts[@]}" install -y -qq --no-install-recommends "$@"; then
  exit 0
fi

echo "::warning::apt could not install $*; installing from conda-forge instead"
dir="${RUNNER_TEMP:-/tmp}/conda-tools"
mm="${RUNNER_TEMP:-/tmp}/micromamba"
curl -fsSL --retry 4 --retry-all-errors -o "$mm" \
  https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-linux-64
chmod +x "$mm"
"$mm" create --yes --quiet --root-prefix "$dir.root" --prefix "$dir" \
  --channel conda-forge --override-channels "$@"
ls "$dir/bin" | grep -E '^(osmium|tippecanoe)' || true
if [ -n "${GITHUB_PATH:-}" ]; then echo "$dir/bin" >> "$GITHUB_PATH"; fi
