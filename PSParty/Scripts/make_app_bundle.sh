#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="PS Party"
BUILD_DIR=".build/release"
APP_DIR="dist/${APP_NAME}.app"

swift build -c release

rm -rf "dist"
mkdir -p "${APP_DIR}/Contents/MacOS"
mkdir -p "${APP_DIR}/Contents/Resources"

cp "${BUILD_DIR}/PSParty" "${APP_DIR}/Contents/MacOS/PSParty"
cp "Resources/Info.plist" "${APP_DIR}/Contents/Info.plist"
cp "Scripts/setup_runtime.sh" "${APP_DIR}/Contents/Resources/setup_runtime.sh"
chmod +x "${APP_DIR}/Contents/Resources/setup_runtime.sh"

codesign --force --deep --sign - --entitlements "Resources/PSParty.entitlements" "${APP_DIR}"

echo "Built ${APP_DIR}"
echo "Move it to /Applications and double-click it once to launch."
