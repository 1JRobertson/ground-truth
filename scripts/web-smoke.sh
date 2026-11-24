#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
staging="$(mktemp -d "${TMPDIR:-/tmp}/ground-truth-web.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

GROUND_TRUTH_BUILD_DIR="$staging" "$root/scripts/build.sh" \
    -D GROUND_TRUTH_WEB_SMOKE "$root/Tests/WebSmoke.swift" "$@"
ditto -x -k "$staging/Ground-Truth-macOS-preview.zip" "$staging"
test_app="$staging/Ground Truth.app/Contents/MacOS/GroundTruth"
"$test_app"
if [[ "$(uname -m)" == "arm64" ]] && /usr/bin/arch -x86_64 /usr/bin/true 2>/dev/null; then
    /usr/bin/arch -x86_64 "$test_app"
fi
