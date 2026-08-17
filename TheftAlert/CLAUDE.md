# TheftAlert

macOS menu-bar app. Arm it before walking away from a locked Mac; it sounds
a loud siren if the lid is opened, the Mac is unplugged, or it leaves a
trusted Wi-Fi network — unless a paired iPhone is detected nearby over
Bluetooth. Disarming needs a Keychain-stored passphrase on top of the
normal macOS login.

Full feature description, setup steps, and the "known risk areas to
verify" list live in `README.md` in this folder — read that first. This
file is for working-session context; `README.md` is the user-facing doc,
don't duplicate its content here.

## Stack

- Swift Package Manager executable target (`Package.swift`), not an Xcode
  project — AppKit + AVFoundation, macOS 13+ minimum.
- No SwiftUI, no storyboard/XIB. Everything is programmatic AppKit
  (`NSStatusItem`, `NSMenu`, `NSAlert`-based passphrase prompt).
- Distributed as a direct-download notarized `.app`, not the Mac App Store
  — it shells out to `ioreg`/`osascript` and does unsandboxed Bluetooth
  polling, both of which App Sandbox forbids. Don't add App Sandbox
  entitlements without redesigning those pieces first.

## Architecture

- `main.swift` — entry point, sets `.accessory` activation policy (no Dock
  icon, menu-bar only).
- `AppDelegate.swift` — the orchestrator. Owns the status item/menu, arm/
  disarm state machine, and wires each monitor's callback to `trigger(reason:)`,
  which checks Bluetooth proximity before deciding whether to actually sound
  the siren.
- `LidStateMonitor.swift`, `PowerSourceMonitor.swift`, `TrustedNetworkMonitor.swift`
  — the three tamper-detection proxies (see README for *why* these three
  and not real motion detection — no public accelerometer API exists on
  modern Macs).
- `BluetoothProximity.swift` — paired *classic* Bluetooth connection check
  (deliberately not BLE scanning; iPhones randomize BLE addresses).
- `SirenPlayer.swift` — synthesizes the siren tone in code (no bundled audio
  asset) and forces system volume to 100 via `osascript`.
- `KeychainStore.swift` / `PassphrasePanel.swift` — passphrase storage and
  the modal prompt used both to set and to check it.
- `LoginItem.swift` — registers the app via `SMAppService` so it survives
  restarts.

## Working on this

- **This has never been compiled.** It was written without access to
  macOS/Xcode. Before trusting any change, build it (`swift build`, or
  `Scripts/make_app_bundle.sh` for a real signed `.app`) and actually run
  it on a Mac — don't assume the Swift compiles cleanly from inspection
  alone.
- When adding a new tamper-detection signal, follow the existing monitor
  pattern (own file, `start()`/`stop()`, a callback closure into
  `AppDelegate`) rather than growing `AppDelegate` directly.
- See `README.md`'s "Ideas for later" section before proposing new features
  — several likely next steps (real accelerometer access, camera capture,
  Apple Watch panic button, fake-shutdown screen) are already scoped there
  with the tradeoffs noted.
