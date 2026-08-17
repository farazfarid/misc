# Memory

## 2026-08-17 — Experimental slap/impact detection (opt-in)

User asked about "SlapMac," a viral $5-7 app that makes a MacBook "moan"
when slapped. Turns out it reads the same undocumented Apple Silicon MEMS
accelerometer flagged as a maybe-later idea in the initial scaffold's
memory below — it's now mainstream enough that several open-source clones
exist (`spank`, `OpenSlap`, `MacSlapApp`), which is what made this feel
safe enough to actually build rather than just note as an idea.

User explicitly chose **opt-in only**, not primary: the existing lid/
unplug/Wi-Fi triggers stay the default behavior; this is an extra signal
you turn on deliberately.

**What was added:**

- `SensorHelper` — new second SPM executable target, root-only, reads HID
  vendor usage page `0xFF00` usage `3`, posts a distributed notification on
  detected impact.
- `MotionImpactMonitor.swift` in the main app — launches the helper
  elevated (repeated admin-password prompt per arm, no reboot persistence
  yet — that's explicitly deferred, see README "Ideas for later"), listens
  for its notifications.
- Menu toggle with an explicit confirmation dialog before first enabling
  (this is the only root-requiring code path in the app), plus a 3-level
  sensitivity cycle (Low/Medium/High) stored in UserDefaults.
- Hardware gating via `machdep.cpu.brand_string` sysctl: Apple Silicon
  M1 Pro/Max/Ultra and M2+ only, excludes plain M1 and Intel.

**Explicitly not done, called out in README:**

- No persistent LaunchDaemon (`SMAppService.daemon()`) — would remove the
  repeated admin prompt but needs a real Apple Developer ID to sign
  correctly, and I have no way to test that packaging step here.
- The exact HID key constants and the "sum of deltas as impact energy"
  heuristic are copied from third-party reverse-engineering, not verified
  first-hand — most likely thing to need rework once run on real hardware.

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
