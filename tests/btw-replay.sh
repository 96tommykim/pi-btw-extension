#!/usr/bin/env bash
# Unit tests for the pure btw delta/replay module. Node v24 runs .ts directly
# (type stripping); replay.ts has no runtime imports, so no build is needed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node --test "$SCRIPT_DIR/btw-replay.test.ts"
