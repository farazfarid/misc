#!/bin/bash
# One-time setup for PS Party: installs Google's official Android emulator
# plus a Play Store system image into PS Party's own folder, and creates the
# virtual phone ("AVD") the app boots. Safe to re-run; it only fills gaps.
set -euo pipefail

SUPPORT_DIR="${HOME}/Library/Application Support/PSParty"
SDK_ROOT="${SUPPORT_DIR}/sdk"
AVD_HOME="${SUPPORT_DIR}/avd"
AVD_NAME="PSParty"
API_LEVEL="34"

case "$(uname -m)" in
    arm64) ABI="arm64-v8a" ;;
    x86_64) ABI="x86_64" ;;
    *) echo "Nicht unterstützte CPU: $(uname -m)"; exit 1 ;;
esac
SYSTEM_IMAGE="system-images;android-${API_LEVEL};google_apis_playstore;${ABI}"

echo "== PS Party Einrichtung =="
echo "Installiert nach: ${SUPPORT_DIR}"
echo "Benötigt ca. 6-8 GB Speicher und lädt ca. 2 GB herunter."
echo

if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew fehlt. Installiere es zuerst von https://brew.sh und starte die Einrichtung dann erneut."
    exit 1
fi

# sdkmanager/avdmanager are Java tools; a private JDK keeps us independent of
# whatever Java the user may or may not have.
brew list openjdk@17 >/dev/null 2>&1 || brew install openjdk@17
brew list --cask android-commandlinetools >/dev/null 2>&1 || brew install --cask android-commandlinetools

export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
SDKMANAGER="$(brew --prefix)/bin/sdkmanager"
AVDMANAGER="$(brew --prefix)/bin/avdmanager"

mkdir -p "${SDK_ROOT}" "${AVD_HOME}"
export ANDROID_SDK_ROOT="${SDK_ROOT}"
export ANDROID_HOME="${SDK_ROOT}"
export ANDROID_AVD_HOME="${AVD_HOME}"

echo
echo "== Android SDK Lizenzen =="
echo "Google verlangt, dass du die Lizenzen selbst bestätigst (mit 'y')."
"${SDKMANAGER}" --sdk_root="${SDK_ROOT}" --licenses

echo
echo "== Emulator, ADB und Play-Store-Image installieren =="
"${SDKMANAGER}" --sdk_root="${SDK_ROOT}" "platform-tools" "emulator" "platforms;android-${API_LEVEL}" "${SYSTEM_IMAGE}"

if [ ! -f "${AVD_HOME}/${AVD_NAME}.ini" ]; then
    echo
    echo "== Virtuelles Telefon anlegen =="
    echo "no" | "${AVDMANAGER}" create avd \
        --name "${AVD_NAME}" \
        --package "${SYSTEM_IMAGE}" \
        --device "pixel_6" \
        --path "${AVD_HOME}/${AVD_NAME}.avd"
fi

CONFIG="${AVD_HOME}/${AVD_NAME}.avd/config.ini"

# Replaces a key in config.ini or appends it if missing.
set_config() {
    local key="$1" value="$2"
    if grep -q "^${key}[[:space:]]*=" "${CONFIG}"; then
        sed -i '' "s|^${key}[[:space:]]*=.*|${key}=${value}|" "${CONFIG}"
    else
        echo "${key}=${value}" >> "${CONFIG}"
    fi
}

set_config "hw.audioInput" "yes"
set_config "hw.audioOutput" "yes"
set_config "hw.keyboard" "yes"
set_config "hw.ramSize" "4096"
set_config "hw.gpu.enabled" "yes"
set_config "hw.gpu.mode" "auto"
set_config "disk.dataPartition.size" "8G"
set_config "showDeviceFrame" "no"

echo
echo "== Fertig =="
echo "Klicke jetzt im PS-Party-Menü auf 'Party starten'."
echo "Beim ersten Start: im Play Store mit deinem Google-Konto anmelden und die PlayStation App installieren."
