# PSParty

macOS menu-bar app that lets you join PlayStation party voice chat on a
Mac without a console, by booting a private Google Android emulator with a
Play Store image and launching the official Android PlayStation App
(`com.scee.psxandroid`) inside it. User-facing docs (German, the user's
language) are in `README.md`, including the "risks to verify" list, read
that first.

## Stack

- Swift Package Manager, one executable target, AppKit only (no SwiftUI),
  macOS 13+. Same layout as `../TheftAlert` but nothing is shared.
- `Scripts/make_app_bundle.sh` builds the `.app` and copies
  `Scripts/setup_runtime.sh` into `Contents/Resources`.
- `Scripts/setup_runtime.sh` is the one-time installer. It uses Homebrew
  (`openjdk@17`, cask `android-commandlinetools`) and then Google's own
  `sdkmanager`/`avdmanager`, so we never parse Google's repository XML
  ourselves. Runs in Terminal so the user sees progress and accepts the
  SDK licenses themselves.
- Everything lives in `~/Library/Application Support/PSParty/{sdk,avd}`,
  isolated from any Android Studio install via `ANDROID_SDK_ROOT` and
  `ANDROID_AVD_HOME`. Paths in `Paths.swift` must match the script.

## Architecture

- `AppDelegate.swift`: status item and menu (rebuilt in `menuNeedsUpdate`),
  mic permission request before booting, opens the setup script in Terminal.
- `EmulatorController.swift`: state machine (notInstalled/stopped/booting/
  running/failed). All adb/emulator calls run on one serial queue; boot
  polling re-schedules with `asyncAfter` so it never blocks that queue.
  Uses a fixed console port 5580 (serial `emulator-5580`) so it never
  touches the user's other emulators.
- `Shell.swift`: blocking process runner, background queue only.
- `Paths.swift`: install locations and env vars.

## Things that must stay true

- `NSMicrophoneUsageDescription` in `Info.plist` is required: the emulator
  is our child process, so macOS charges its mic use to us. Without it the
  mic is silently denied or the app is killed.
- Don't add App Sandbox: we spawn external binaries from Application Support.
- UI strings are German.
