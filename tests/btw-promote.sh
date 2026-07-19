#!/usr/bin/env bash
# Unit tests for the pure btw promote-note builders. Node v24 runs .ts directly
# (type stripping); promote.ts has only type-level imports, so no build is needed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node --test "$SCRIPT_DIR/btw-promote.test.ts"
