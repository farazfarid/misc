#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="Theft Alert"
BUILD_DIR=".build/release"
APP_DIR="dist/${APP_NAME}.app"

swift build -c release

rm -rf "dist"
mkdir -p "${APP_DIR}/Contents/MacOS"
mkdir -p "${APP_DIR}/Contents/Resources"

cp "${BUILD_DIR}/TheftAlert" "${APP_DIR}/Contents/MacOS/TheftAlert"
cp "Resources/Info.plist" "${APP_DIR}/Contents/Info.plist"

codesign --force --deep --sign - --entitlements "Resources/TheftAlert.entitlements" "${APP_DIR}"

echo "Built ${APP_DIR}"
echo "Move it to /Applications and double-click it once to launch."
