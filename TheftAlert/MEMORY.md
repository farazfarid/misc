# Memory

## 2026-08-17 — Initial scaffold

Built the full v1 scaffold in one session, from a conceptual discussion
about feasibility. No macOS/Xcode access in the build environment, so
everything below is written but **unbuilt and untested**.

**Key decisions, and why:**

- Dropped "detect physical motion/shaking" from the initial ask — modern
  Macs (Apple Silicon, and Intel post-~2013) expose no public accelerometer
  API. A reverse-engineered path exists
  ([olvvier/apple-silicon-accelerometer](https://github.com/olvvier/apple-silicon-accelerometer))
  but it's undocumented IOKit HID access, fragile across OS updates, and
  not App Store safe — explicitly deferred to a v2 experiment, not built.
- Replaced it with three proxies that shipped competitor apps (Unplug
  Alarm, Clyde, MacAlert) already validate in production: lid-open
  (polled via `ioreg`, no public notification API exists), power-unplug
  (real public `IOPowerSources` API with a push notification), and
  leaving a trusted Wi-Fi network (optional, `CoreWLAN`, needs Location
  Services permission).
- iPhone-proximity silencing uses paired **classic** Bluetooth connection
  status (`IOBluetoothDevice.isConnected()`), not BLE scanning — iPhones
  randomize their BLE advertising address for privacy, so BLE scanning
  can't reliably identify a specific iPhone without an active paired
  connection.
- Siren is synthesized in code (two-tone wail via `AVAudioSourceNode`) so
  the app ships with no bundled audio asset.
- Disarm is two layers: the macOS login password (unavoidable — no app can
  put UI over the lock screen, by design of macOS's secure session
  separation) plus a separate Keychain-stored app passphrase, so a
  known/guessed Mac password alone doesn't silently kill the alarm.
- Chose direct-distribution + notarization over Mac App Store, because the
  app shells out to `ioreg`/`osascript` and does unsandboxed Bluetooth
  polling — App Sandbox blocks both.

**Open / not yet done:**

- Nothing has been compiled or run. First real task on a Mac: run
  `Scripts/make_app_bundle.sh`, fix whatever doesn't compile, and actually
  test each trigger.
- `IOBluetoothDevice.isConnected()` reliability is the single biggest
  unknown — flagged in README as the piece most likely to need rework
  once tested against a real iPhone.
- No camera capture, no Apple Watch panic button, no fake-shutdown screen
  — all scoped in README's "Ideas for later" but intentionally left out of
  v1.
- Monetization/market discussion (competitor pricing, positioning) happened
  in chat, not written up anywhere in-repo yet — ask if that should become
  a doc here.
