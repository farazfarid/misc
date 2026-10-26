import AppKit

/// Boots and drives the private Android emulator that runs the official
/// PlayStation App. All adb/emulator calls go through a serial background
/// queue; state changes are reported on the main thread.
final class EmulatorController {
    enum State: Equatable {
        case notInstalled
        case stopped
        case booting
        case running
        case failed(String)
    }

    static let psAppPackage = "com.scee.psxandroid"

    /// Fixed console port so the adb serial is predictable and we never touch
    /// another emulator the user might be running (those default to 5554+).
    private static let consolePort = 5580
    private static let serial = "emulator-\(consolePort)"
    private static let bootTimeout: TimeInterval = 240

    var onStateChange: ((State) -> Void)?

    private(set) var state: State = .stopped {
        didSet {
            guard state != oldValue else { return }
            let newState = state
            DispatchQueue.main.async { self.onStateChange?(newState) }
        }
    }

    var micEnabled: Bool {
        get { UserDefaults.standard.object(forKey: "micEnabled") as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: "micEnabled")
            queue.async {
                guard self.state == .running else { return }
                self.applyMicSetting()
            }
        }
    }

    private let queue = DispatchQueue(label: "PSParty.emulator")
    private var emulatorProcess: Process?
    private var openAppAfterBoot = false

    init() {
        refreshState()
    }

    /// Re-checks the install and whether our emulator is already up, e.g. after
    /// the setup script ran or when the app is relaunched while it's running.
    func refreshState() {
        queue.async {
            guard Paths.isRuntimeInstalled else {
                self.state = .notInstalled
                return
            }
            if self.state == .booting { return }
            self.state = self.isBooted() ? .running : .stopped
        }
    }

    /// Boots the emulator if needed, then brings the PlayStation App up.
    func startParty() {
        queue.async {
            switch self.state {
            case .running:
                self.openPlayStationApp()
            case .booting:
                self.openAppAfterBoot = true
            case .notInstalled:
                return
            case .stopped, .failed:
                self.boot()
            }
        }
    }

    func stop() {
        queue.async {
            Shell.run(Paths.adb, ["-s", Self.serial, "emu", "kill"])
            if let process = self.emulatorProcess, process.isRunning {
                process.terminate()
            }
            self.emulatorProcess = nil
            self.state = Paths.isRuntimeInstalled ? .stopped : .notInstalled
        }
    }

    /// Stops the emulator and waits for it, used while the app quits.
    func stopSynchronously() {
        stop()
        queue.sync {}
    }

    func showEmulatorWindow() {
        let pid = emulatorProcess?.processIdentifier
        let app = NSWorkspace.shared.runningApplications.first { app in
            if let pid, app.processIdentifier == pid { return true }
            return app.executableURL?.lastPathComponent.hasPrefix("qemu-system") ?? false
        }
        app?.activate(options: [.activateIgnoringOtherApps])
    }

    // MARK: - Private (call on `queue` only)

    private func boot() {
        state = .booting
        openAppAfterBoot = true

        FileManager.default.createFile(atPath: Paths.emulatorLog.path, contents: nil)
        let log = try? FileHandle(forWritingTo: Paths.emulatorLog)

        var arguments = [
            "-avd", Paths.avdName,
            "-port", String(Self.consolePort),
            "-no-boot-anim",
        ]
        // Newer emulator builds zero out host microphone audio unless this is
        // passed; older ones don't know the flag and refuse to start with it.
        if supportsAllowHostAudioFlag() {
            arguments.append("-allow-host-audio")
        }

        let process = Process()
        process.executableURL = Paths.emulator
        process.arguments = arguments
        process.environment = Paths.androidEnvironment
        process.standardOutput = log
        process.standardError = log
        process.terminationHandler = { [weak self] finished in
            self?.queue.async {
                guard let self, self.emulatorProcess === finished else { return }
                self.emulatorProcess = nil
                if self.state == .booting {
                    self.state = .failed("Emulator wurde beendet (Code \(finished.terminationStatus)). Details im Log.")
                } else {
                    self.state = Paths.isRuntimeInstalled ? .stopped : .notInstalled
                }
            }
        }

        do {
            try process.run()
        } catch {
            state = .failed("Emulator konnte nicht gestartet werden: \(error.localizedDescription)")
            return
        }
        emulatorProcess = process

        waitForBoot()
    }

    private func waitForBoot() {
        Shell.run(Paths.adb, ["start-server"])
        pollBoot(deadline: Date().addingTimeInterval(Self.bootTimeout))
    }

    /// Re-schedules itself instead of looping, so stop and mic toggles queued
    /// behind it aren't stuck for the whole boot.
    private func pollBoot(deadline: Date) {
        // The process may have died or been stopped since the last check.
        guard state == .booting else { return }

        if isBooted() {
            state = .running
            applyMicSetting()
            if openAppAfterBoot {
                openAppAfterBoot = false
                openPlayStationApp()
            }
        } else if Date() >= deadline {
            state = .failed("Android ist nach \(Int(Self.bootTimeout)) Sekunden nicht hochgefahren.")
        } else {
            queue.asyncAfter(deadline: .now() + 2) { self.pollBoot(deadline: deadline) }
        }
    }

    private func isBooted() -> Bool {
        let result = Shell.run(Paths.adb, ["-s", Self.serial, "shell", "getprop", "sys.boot_completed"])
        return result.succeeded && result.output == "1"
    }

    private func applyMicSetting() {
        // Emulator console command; the Extended Controls > Microphone toggle
        // in the emulator window does the same thing by hand.
        Shell.run(Paths.adb, ["-s", Self.serial, "emu", "avd", micEnabled ? "hostmicon" : "hostmicoff"])
    }

    /// Launches the PlayStation App, or opens its Play Store page if it's not
    /// installed yet (first run, before the user has signed in to Google).
    private func openPlayStationApp() {
        let installed = Shell.run(Paths.adb, ["-s", Self.serial, "shell", "pm", "path", Self.psAppPackage])
        if installed.succeeded && installed.output.hasPrefix("package:") {
            Shell.run(Paths.adb, [
                "-s", Self.serial, "shell", "monkey",
                "-p", Self.psAppPackage,
                "-c", "android.intent.category.LAUNCHER", "1",
            ])
        } else {
            Shell.run(Paths.adb, [
                "-s", Self.serial, "shell", "am", "start",
                "-a", "android.intent.action.VIEW",
                "-d", "market://details?id=\(Self.psAppPackage)",
            ])
        }
        DispatchQueue.main.async { self.showEmulatorWindow() }
    }

    private lazy var allowHostAudioSupported: Bool = {
        Shell.run(Paths.emulator, ["-help"]).output.contains("-allow-host-audio")
    }()

    private func supportsAllowHostAudioFlag() -> Bool {
        allowHostAudioSupported
    }
}
