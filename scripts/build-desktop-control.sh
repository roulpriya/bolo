#!/bin/zsh
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$project_dir/bin/Bolo Desktop Control.app"
mkdir -p "$app_dir/Contents/MacOS"
cp "$project_dir/scripts/BoloDesktopControl-Info.plist" "$app_dir/Contents/Info.plist"
xcrun swiftc -parse-as-library -target "$(uname -m)-apple-macosx14.0" "$project_dir/scripts/desktop-control.swift" \
  -o "$app_dir/Contents/MacOS/desktop-control" \
  -framework AppKit -framework CoreGraphics -framework ScreenCaptureKit
codesign --force --sign - --identifier com.bolo.desktop-control "$app_dir"
codesign --verify --strict "$app_dir"
echo "Built: $app_dir"
