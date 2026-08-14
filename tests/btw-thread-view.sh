#!/usr/bin/env bash
# Rendering tests use Node's TypeScript transform for thread-view's parameter properties.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/../scripts/link-pi-types.sh"
node --experimental-transform-types --test "$SCRIPT_DIR/btw-thread-view.test.ts"
