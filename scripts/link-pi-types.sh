#!/usr/bin/env bash
# Symlink the globally-installed pi packages into ./node_modules so `tsc` can
# resolve @earendil-works/* and @types/node when typechecking this package.
# Node-version-agnostic (resolves via `npm root -g`). Idempotent. Output is gitignored.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"          # -> repository root
groot="$(npm root -g)"
pca="$groot/@earendil-works/pi-coding-agent"
[ -d "$pca" ] || {
  echo "error: @earendil-works/pi-coding-agent not globally installed" >&2
  echo "       run: npm i -g @earendil-works/pi-coding-agent" >&2
  exit 1
}

nm="$here/node_modules"
mkdir -p "$nm/@earendil-works"
ln -sfn "$pca"                                            "$nm/@earendil-works/pi-coding-agent"
ln -sfn "$pca/node_modules/@earendil-works/pi-ai"         "$nm/@earendil-works/pi-ai"
ln -sfn "$pca/node_modules/@earendil-works/pi-agent-core" "$nm/@earendil-works/pi-agent-core"
ln -sfn "$pca/node_modules/@earendil-works/pi-tui"        "$nm/@earendil-works/pi-tui"
ln -sfn "$pca/node_modules/@types"                        "$nm/@types"
echo "linked pi types into $nm (source: $pca)"
