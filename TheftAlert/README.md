# Theft Alert

A menu-bar app that arms your Mac before you walk away with it, and sounds a
loud siren if it's tampered with — unless your paired iPhone is nearby.

This is a source scaffold written without access to macOS/Xcode (it was
built in a Linux container), so **it has not been compiled or run yet**.
Treat it as a strong starting point, not a finished, tested product — build
it on your own Mac, watch the console for issues, and expect to tweak a few
things. See "Known risk areas to verify" below before you trust it.

## What it actually detects

macOS gives apps no public API for the accelerometer on modern Macs (Apple
Silicon exposes it only through an undocumented, reverse-engineered HID
interface — see "Ideas for later" below), so this app can't do literal
"shake/motion" detection out of the box. Instead it arms three proxies for
tampering, which is also what existing shipped anti-theft apps (Unplug
Alarm, Clyde, MacAlert) rely on:

1. **Lid opened** while armed — polls `ioreg`'s `AppleClamshellState` every
   1.5s (no public notification API exists for this either).
2. **Unplugged from power** while armed — public `IOPowerSources` API,
   pushed via a real notification (no polling).
3. **Left a trusted Wi-Fi network** while armed (optional) — proxy for "the
   Mac physically left the house/office."

There's a fourth, **experimental and off by default** signal: real slap/
impact detection on Apple Silicon Macs (M1 Pro/Max/Ultra, M2 and later —
not plain M1, not Intel). This uses the same trick as the viral "SlapMac"
app: the chip's internal MEMS accelerometer, managed by the Sensor
Processing Unit, is undocumented but readable via IOKit HID (vendor usage
page `0xFF00`, usage `3`). Reading it requires root, so it runs in a
separate privileged helper (`SensorHelper`) rather than in the main app —
see "Experimental: Slap/Impact Detection" below before turning it on.

When any of these fire, it checks whether your iPhone is connected over
**paired classic Bluetooth** (not BLE scanning — iPhones randomize their BLE
advertising address for privacy, so BLE scanning can't reliably identify a
specific iPhone without it actively broadcasting a fixed identifier). If
your iPhone is connected, the event is logged as a quiet notification only.
Otherwise, a synthesized wailing siren starts immediately at max system
volume.

Disarming requires two things a thief won't have: your macOS login password
(to physically get back into the session at all — no app UI is reachable
from the lock screen, by design of macOS's secure session separation), and
then a separate app passphrase you set on first launch, stored in the
Keychain. This second layer exists so a stolen/guessed Mac password alone
doesn't silently kill the alarm.

## Setup

1. Open `Package.swift` in Xcode (`File > Open...`), or work from the
   command line with the Swift toolchain.
2. Build a real `.app` bundle (a bare SPM executable can't hold entitlements
   or show up properly in Login Items):
   ```
   ./Scripts/make_app_bundle.sh
   ```
   This ad-hoc code-signs it with `Resources/TheftAlert.entitlements`. Move
   `dist/Theft Alert.app` to `/Applications` and launch it once.
3. Grant permissions when prompted: Notifications, and — if you set a
   trusted Wi-Fi network — Location Services (reading the current SSID
   requires it since macOS 10.15).
4. On first launch you'll be asked to set a disarm passphrase.
5. From the menu bar icon: pair your iPhone in System Settings > Bluetooth
   first, then use "Link Trusted iPhone..." to select it, optionally "Set
   Trusted Wi-Fi Network...", then **Arm**.

The app registers itself as a login item (`SMAppService`) so it keeps
running across restarts. Locking the screen (Cmd+Ctrl+Q) does **not** quit
it — regular user processes keep running through a lock, which is exactly
what makes the "lock it and walk away" workflow possible.

## Experimental: Slap/Impact Detection

Off by default, and hidden entirely on non-Apple-Silicon Macs. Turning it
on from the menu:

- Explains what it does and asks you to confirm, since it's a real trust
  boundary change — nothing else in this app touches root.
- Each time you **Arm** with it enabled, macOS prompts for your admin
  password to launch `SensorHelper` (via `do shell script ... with
  administrator privileges`). It does **not** install a persistent
  LaunchDaemon in v1, so this prompt repeats every arm, and the helper
  does not survive a reboot on its own.
- The helper never reports real g-forces — nobody's published the exact
  per-axis scaling Apple uses internally, so instead it tracks sudden
  jumps across whatever HID elements the sensor reports and fires past a
  threshold. Use the "Slap Sensitivity" menu item (Low/Medium/High) to
  tune false positives vs. missed hits for your machine.
- It talks to the main app over `DistributedNotificationCenter`, which
  works fine across the privilege boundary without any custom socket code.

This is the least proven part of the app — the exact IOKit key constants,
the vendor usage page/usage numbers, and the whole approach are drawn from
third-party reverse-engineering ([spank](https://github.com/taigrr/spank),
[apple-silicon-accelerometer](https://github.com/olvvier/apple-silicon-accelerometer)),
not written from first-hand testing. Expect to debug it on real hardware.

## Why it's not sandboxed / not on the Mac App Store

The app shells out to `ioreg` and `osascript`, and does aggressive
Bluetooth/network polling — none of which App Sandbox permits. This is
built for direct, notarized distribution (same as most competitors in this
category), not App Store submission. If you want App Store distribution
later, the lid-detection and volume-forcing pieces would need to be
redesigned around sandbox-safe APIs, and Apple's review guidelines around
apps whose primary function is a loud alarm/siren are worth checking first.

## Known risk areas to verify on real hardware

- **Local notifications from a non-notarized, ad-hoc-signed app** can be
  flaky — `UNUserNotificationCenter` sometimes requires a stable bundle
  identity to register reliably. If notifications silently fail, the siren
  will still fire; only the "silenced because iPhone nearby" notice would
  be missing.
- **Wi-Fi SSID reads** may return `nil` without Location Services fully
  granted, which would make the trusted-network trigger never fire (fails
  safe, but silently).
- **`IOBluetoothDevice.isConnected()`** reflects classic Bluetooth pairing
  state; if your iPhone has classic Bluetooth radio off (only BLE on) it
  may not show as connected even when nearby. Test this specifically —
  it's the piece most likely to need adjustment.
- **Ad-hoc codesigning** (`--sign -`) is fine for running on your own Mac
  but will trip Gatekeeper on any other machine and won't survive an
  App Store-style notarization pipeline.
- **SensorHelper's HID matching/parsing is unverified** (see previous
  section) — the vendor usage page/usage numbers and the "sum of deltas"
  impact heuristic are the most likely things to need rework once tested.

## Ideas for later (not implemented)

- **Persist Slap/Impact Detection across reboots** without a repeated admin
  prompt: package `SensorHelper` as a proper signed `LaunchDaemon` via
  `SMAppService.daemon()` (macOS 13+) instead of the current one-shot
  `do shell script ... with administrator privileges` launch. Needs an
  Apple Developer ID to sign both the app and the daemon with a matching
  Team ID.
- Snap a photo from the camera + push it to your phone when triggered.
- Apple Watch / push notification "panic button" to remotely trigger or
  silence the alarm (what Clyde does via a companion watch app).
- A "fake shutdown" screen thieves might fall for, à la Undercover's
  simulated hardware failure trick.
- BLE RSSI-based *distance* estimation instead of a binary connected/not,
  once you're past the classic-Bluetooth MVP.
