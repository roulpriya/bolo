#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$project_dir/bin/Bolo Mac Control.app"
contents_dir="$app_dir/Contents"
executable_dir="$contents_dir/MacOS"

mkdir -p "$executable_dir"
cp "$project_dir/scripts/BoloMacControl-Info.plist" "$contents_dir/Info.plist"

swiftc "$project_dir/scripts/mac-control.swift" \
  -o "$executable_dir/mac-control" \
  -framework AppKit \
  -framework CoreGraphics

signing_identity="$(
  security find-identity -v -p codesigning |
    awk -F '"' '/Apple Development:/{print $2; exit}'
)"

if [[ -n "$signing_identity" ]]; then
  codesign --force --sign "$signing_identity" \
    --identifier com.priyaroul.bolo.mac-control \
    "$app_dir"
  echo "Signed Bolo Mac Control with: $signing_identity"
else
  codesign --force --sign - \
    --identifier com.priyaroul.bolo.mac-control \
    "$app_dir"
  echo "No Apple Development identity found; used an ad-hoc signature."
fi

codesign --verify --strict --verbose=2 "$app_dir"
echo "Built: $app_dir"
