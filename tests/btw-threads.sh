#!/usr/bin/env bash
# Unit tests for the cross-session thread store's deleteThread logic. Runs the
# store against a temporary HOME so it never touches the real ~/.pi.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node --test "$SCRIPT_DIR/btw-threads.test.ts"
