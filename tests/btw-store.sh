#!/usr/bin/env bash
# Unit tests for the pure btw cross-session store module. Node v24 runs .ts
# directly (type stripping); store-file.ts imports only node builtins at runtime.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node --test "$SCRIPT_DIR/btw-store.test.ts"
