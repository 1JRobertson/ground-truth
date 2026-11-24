#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
staging="$(mktemp -d "${TMPDIR:-/tmp}/ground-truth-test.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

xcrun swiftc -swift-version 5 "$@" "$root"/Sources/{Models,GarminClient,PrivateStores,Demo}.swift \
    "$root"/Tests/Contract.swift -o "$staging/tests"
"$staging/tests"
