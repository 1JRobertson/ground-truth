#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${GROUND_TRUTH_BUILD_DIR:-$root/dist}"
version="$(plutil -extract CFBundleShortVersionString raw -o - "$root/packaging/Info.plist")"
archive="Ground-Truth-macOS-preview-$version.zip"
staging="$(mktemp -d "${TMPDIR:-/tmp}/ground-truth-build.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

app="$staging/Ground Truth.app"
binary="$app/Contents/MacOS/GroundTruth"
web="$app/Contents/Resources/Web"
mkdir -p "$web" "$(dirname "$binary")" "$out"
cp "$root"/packaging/Info.plist "$app/Contents/Info.plist"
cp "$root"/Web/{index.html,app.js,chart-axis.js,theme.js,styles.css,theme.css,setup.css} "$web/"
cp "$root"/LICENSE "$app/Contents/Resources/"

sdk="$(xcrun --sdk macosx --show-sdk-path)"
for architecture in arm64 x86_64; do
    xcrun swiftc -sdk "$sdk" -swift-version 5 -O -target "$architecture-apple-macos13.0" \
        "$@" "$root"/Sources/*.swift -o "$staging/GroundTruth-$architecture"
done
xcrun lipo -create "$staging"/GroundTruth-{arm64,x86_64} -output "$binary"
codesign --force --sign - "$app"
codesign --verify --strict "$app"
ditto -c -k --norsrc --noextattr --noacl --keepParent "$app" "$staging/$archive"
mv "$staging/$archive" "$out/$archive"
(cd "$out" && LC_ALL=C shasum -a 256 "$archive" > SHA256SUMS.txt)
echo "$out/$archive"
