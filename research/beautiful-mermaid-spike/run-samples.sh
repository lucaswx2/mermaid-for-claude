#!/usr/bin/env bash
# Runs every sample .mmd file through the built bundle.mjs and prints its output.
set -u
for f in samples/*.mmd; do
  echo "=== $f ==="
  node bundle.mjs < "$f"
  echo "(exit code: $?)"
  echo
done
