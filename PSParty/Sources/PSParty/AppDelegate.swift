import AppKit
import AVFoundation

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private let emulator = EmulatorController()
    private var state: EmulatorController.State = .stopped

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        emulator.onStateChange = { [weak self] newState in
            self?.state = newState
            self?.updateIcon()
            if case .failed(let message) = newState {
                self?.showError(message)
            }
        }
        updateIcon()

        // The setup script runs in Terminal; pick up its result whenever the
        // user comes back to us.
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.emulator.refreshState()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        emulator.stopSynchronously()
    }

    // MARK: - Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        emulator.refreshState()
        menu.removeAllItems()

        let status = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        switch state {
        case .notInstalled:
            menu.addItem(item("Einrichtung starten…", #selector(runSetup)))
        case .stopped, .failed:
            menu.addItem(item("Party starten", #selector(startParty), key: "p"))
        case .booting:
            let booting = NSMenuItem(title: "Android startet…", action: nil, keyEquivalent: "")
            booting.isEnabled = false
            menu.addItem(booting)
        case .running:
            menu.addItem(item("PlayStation App öffnen", #selector(startParty), key: "p"))
            menu.addItem(item("Fenster zeigen", #selector(showWindow)))
        }

        if state != .notInstalled {
            let mic = item("Mikrofon an Party senden", #selector(toggleMic), key: "m")
            mic.state = emulator.micEnabled ? .on : .off
            menu.addItem(mic)
        }

        if state == .running || state == .booting {
            menu.addItem(.separator())
            menu.addItem(item("Party beenden", #selector(stopParty)))
        }

        menu.addItem(.separator())
        if state != .notInstalled {
            menu.addItem(item("Einrichtung erneut ausführen…", #selector(runSetup)))
        }
        menu.addItem(item("Emulator-Log anzeigen", #selector(showLog)))
        menu.addItem(item("PS Party beenden", #selector(quit), key: "q"))
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private var statusText: String {
        switch state {
        case .notInstalled: return "Nicht eingerichtet"
        case .stopped: return "Bereit"
        case .booting: return "Startet…"
        case .running: return emulator.micEnabled ? "Party läuft · Mikro an" : "Party läuft · Mikro aus"
        case .failed: return "Fehler, siehe Log"
        }
    }

    private func updateIcon() {
        let symbol: String
        switch state {
        case .running: symbol = emulator.micEnabled ? "gamecontroller.fill" : "mic.slash.fill"
        default: symbol = "gamecontroller"
        }
        statusItem.button?.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "PS Party")
    }

    // MARK: - Actions

    @objc private func startParty() {
        // Ask for the mic up front: the emulator is our child process, so macOS
        // attributes its microphone use to PS Party.
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                if !granted && self.emulator.micEnabled {
                    self.showError("Kein Mikrofonzugriff. Erlaube ihn unter Systemeinstellungen > Datenschutz & Sicherheit > Mikrofon, sonst hört dich die Party nicht.")
                }
                self.emulator.startParty()
            }
        }
    }

    @objc private func stopParty() {
        emulator.stop()
    }

    @objc private func showWindow() {
        emulator.showEmulatorWindow()
    }

    @objc private func toggleMic() {
        emulator.micEnabled.toggle()
        updateIcon()
    }

    @objc private func runSetup() {
        guard let script = Paths.setupScript,
              let terminal = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") else {
            showError("Setup-Skript nicht im App-Bundle gefunden. Baue die App mit Scripts/make_app_bundle.sh.")
            return
        }
        NSWorkspace.shared.open([script], withApplicationAt: terminal, configuration: NSWorkspace.OpenConfiguration())
    }

    @objc private func showLog() {
        if FileManager.default.fileExists(atPath: Paths.emulatorLog.path) {
            NSWorkspace.shared.open(Paths.emulatorLog)
        } else {
            showError("Noch kein Log vorhanden. Es entsteht beim ersten Party-Start.")
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "PS Party"
        alert.informativeText = message
        alert.alertStyle = .warning
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
