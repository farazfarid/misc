# Memory

## 2026-10-26 — Initial build

User asked (in German) for a native Mac "PS Party" app so they don't need
a PlayStation. Researched first, then built. **Unbuilt and untested**: no
macOS here, and the session's network policy blocks `dl.google.com`, so
not even the SDK download could be tried.

**Research findings that drove the design:**

- No official Sony party client for macOS/Windows. Remote Play (Mac app
  exists) always needs a PS4/PS5.
- No public documentation or working open-source reverse engineering of
  the party voice protocol. Only unofficial PSN web APIs exist (npsso
  token based: friends, trophies, messages; e.g. `psnawp`, `psn-api`),
  none do voice. A custom client was ruled out: not feasible and a ban risk.
- Official consoleless party voice exists only in the mobile PlayStation
  App. iPhone Mirroring passes no mic and isn't available in the EU
  (user is in Germany). The iOS app isn't officially on Apple Silicon Macs;
  PlayCover would need a decrypted IPA, rejected.
- So: run the official Android app in Google's official emulator (native
  arm64 on Apple Silicon), wrapped by a menu-bar app.

**Open / verify on a real Mac:**

- Does `avd hostmicon` (emulator console) plus the conditional
  `-allow-host-audio` flag actually route the Mac mic into the guest? The
  flag's existence couldn't be confirmed online, which is why the app only
  passes it if `emulator -help` lists it. Fallback is the Extended Controls
  toggle (documented in README).
- Does the PlayStation App's party voice work in an emulator, or does it
  block emulators (Play Integrity)? Reports from BlueStacks users suggest
  it works, but that's unconfirmed.
- Does `avdmanager --device pixel_6` exist in the current cmdline-tools?
  If not, use `avdmanager list device` and pick another.
- `showEmulatorWindow()` finds the window via the `qemu-system*` process
  name. Check that it really activates the emulator window.

**Ideas for later:** a native friends/presence list in the menu (who's
online, who's in a party) via the unofficial PSN API with an npsso token;
launch at login; running headless with scrcpy for a cleaner window.
