import AppKit
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let siren = SirenPlayer()
    private let lidMonitor = LidStateMonitor()
    private let powerMonitor = PowerSourceMonitor()
    private let networkMonitor = TrustedNetworkMonitor()

    private var isArmed = false
    private var alarmActive = false

    private var trustedDeviceAddress: String? {
        get { UserDefaults.standard.string(forKey: "trustedDeviceAddress") }
        set { UserDefaults.standard.set(newValue, forKey: "trustedDeviceAddress") }
    }
    private var trustedSSID: String? {
        get { UserDefaults.standard.string(forKey: "trustedSSID") }
        set { UserDefaults.standard.set(newValue, forKey: "trustedSSID") }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        LoginItem.enable()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "shield.slash", accessibilityDescription: "Theft Alert")

        lidMonitor.onLidOpened = { [weak self] in self?.trigger(reason: "Lid opened") }
        powerMonitor.onUnplugged = { [weak self] in self?.trigger(reason: "Power disconnected") }
        networkMonitor.trustedSSID = trustedSSID
        networkMonitor.onLeftTrustedNetwork = { [weak self] in self?.trigger(reason: "Left trusted Wi-Fi network") }

        if KeychainStore.hasPassphrase == false {
            promptForNewPassphrase()
        }

        rebuildMenu()
    }

    // MARK: - Alarm

    private func trigger(reason: String) {
        guard isArmed, alarmActive == false else { return }

        if let address = trustedDeviceAddress, BluetoothProximity.isDeviceNearby(address: address) {
            notify(title: "Theft Alert (silenced)", body: "\(reason), but your trusted iPhone is nearby so the siren stayed off.")
            return
        }

        alarmActive = true
        siren.start()
        notify(title: "Theft Alert triggered", body: reason)
        rebuildMenu()
    }

    private func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: - Arm / Disarm

    @objc private func arm() {
        guard KeychainStore.hasPassphrase else {
            promptForNewPassphrase()
            return
        }
        isArmed = true
        lidMonitor.start()
        powerMonitor.start()
        networkMonitor.start()
        rebuildMenu()
    }

    @objc private func disarm() {
        guard let stored = KeychainStore.load() else { return }
        guard let entered = PassphrasePanel.prompt(title: "Disarm Theft Alert", message: "Enter your passphrase to disarm.") else { return }
        guard entered == stored else {
            notify(title: "Wrong passphrase", body: "Theft Alert stays armed.")
            return
        }
        isArmed = false
        alarmActive = false
        siren.stop()
        lidMonitor.stop()
        powerMonitor.stop()
        networkMonitor.stop()
        rebuildMenu()
    }

    @objc private func promptForNewPassphrase() {
        guard let passphrase = PassphrasePanel.prompt(
            title: "Set Disarm Passphrase",
            message: "Choose a passphrase only you know. You'll need it to silence the alarm, in addition to your Mac login password."
        ), passphrase.isEmpty == false else { return }
        KeychainStore.save(passphrase)
    }

    // MARK: - Settings

    @objc private func linkTrustedIPhone() {
        let options = BluetoothProximity.pairedDeviceOptions
        guard options.isEmpty == false, let button = statusItem.button else {
            notify(title: "No paired Bluetooth devices", body: "Pair your iPhone with this Mac in System Settings > Bluetooth first.")
            return
        }

        let menu = NSMenu()
        for option in options {
            let item = NSMenuItem(title: option.name, action: #selector(selectTrustedDevice(_:)), keyEquivalent: "")
            item.representedObject = option.address
            item.target = self
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height), in: button)
    }

    @objc private func selectTrustedDevice(_ sender: NSMenuItem) {
        trustedDeviceAddress = sender.representedObject as? String
        rebuildMenu()
    }

    @objc private func setTrustedNetwork() {
        guard let ssid = PassphrasePanel.prompt(
            title: "Trusted Wi-Fi Network",
            message: "Enter the SSID your Mac is normally on (e.g. your home Wi-Fi). Leaving this network while armed triggers the alarm."
        ) else { return }
        trustedSSID = ssid.isEmpty ? nil : ssid
        networkMonitor.trustedSSID = trustedSSID
        rebuildMenu()
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    // MARK: - Menu

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: isArmed ? "Armed" : "Disarmed", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())

        if isArmed {
            menu.addItem(NSMenuItem(title: "Disarm...", action: #selector(disarm), keyEquivalent: ""))
        } else {
            menu.addItem(NSMenuItem(title: "Arm", action: #selector(arm), keyEquivalent: ""))
        }

        menu.addItem(NSMenuItem.separator())
        let deviceTitle = trustedDeviceAddress == nil ? "Link Trusted iPhone..." : "Trusted iPhone Linked \u{2713}"
        menu.addItem(NSMenuItem(title: deviceTitle, action: #selector(linkTrustedIPhone), keyEquivalent: ""))
        let ssidTitle = trustedSSID == nil ? "Set Trusted Wi-Fi Network..." : "Trusted Network: \(trustedSSID ?? "")"
        menu.addItem(NSMenuItem(title: ssidTitle, action: #selector(setTrustedNetwork), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Change Passphrase...", action: #selector(promptForNewPassphrase), keyEquivalent: ""))

        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))

        for item in menu.items {
            item.target = self
        }
        statusItem.menu = menu

        statusItem.button?.image = NSImage(
            systemSymbolName: isArmed ? "shield.fill" : "shield.slash",
            accessibilityDescription: "Theft Alert"
        )
    }
}
