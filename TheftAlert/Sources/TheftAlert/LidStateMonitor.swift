import Foundation

/// Polls `ioreg` for the clamshell (lid) state, since macOS has no public
/// notification API for lid open/close.
final class LidStateMonitor {
    private var timer: Timer?
    private var lastClosed: Bool?
    var onLidOpened: (() -> Void)?

    func start() {
        lastClosed = queryClamshellClosed()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func poll() {
        let closed = queryClamshellClosed()
        if lastClosed == true, closed == false {
            onLidOpened?()
        }
        lastClosed = closed
    }

    private func queryClamshellClosed() -> Bool? {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/ioreg")
        task.arguments = ["-r", "-c", "IOPMrootDomain", "-d", "1", "-k", "AppleClamshellState"]

        let pipe = Pipe()
        task.standardOutput = pipe
        do {
            try task.run()
        } catch {
            return nil
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        guard let output = String(data: data, encoding: .utf8) else { return nil }

        if output.contains("\"AppleClamshellState\" = Yes") {
            return true
        } else if output.contains("\"AppleClamshellState\" = No") {
            return false
        }
        return nil
    }
}
