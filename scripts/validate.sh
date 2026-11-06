#!/usr/bin/env bash
# Feature validation gate: syntax checks + all unit tests. Exit non-zero on any failure.
# Usage: scripts/validate.sh [base-ref]   (base-ref defaults to origin/main; used for the test-coverage check)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/main}"
step() { printf '\n▶ %s\n' "$1"; }

step "JavaScript syntax"
for f in app.js audio.js flow.js timer-core.js store.js sw.js tests/*.test.js; do node --check "$f"; done

step "Node unit tests (timer-core, store)"
node --test tests/*.test.js

step "Changed-code-has-tests check (vs $BASE)"
if git rev-parse --verify -q "$BASE" >/dev/null; then
  changed=$(git diff --name-only "$BASE"...HEAD -- store.js timer-core.js app.js flow.js || true)
  tests_changed=$(git diff --name-only "$BASE"...HEAD -- tests || true)
  if [ -n "$changed" ] && [ -z "$tests_changed" ]; then
    echo "✗ Source changed ($(echo $changed)) but no files under tests/ changed." >&2
    exit 1
  fi
  echo "✓ ok"
else
  echo "(skipped: $BASE not found)"
fi

printf '\n✅ All validation checks passed\n'
