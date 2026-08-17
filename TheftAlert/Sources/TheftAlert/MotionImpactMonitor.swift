import Foundation

/// Drives the privileged SensorHelper process (see Sources/SensorHelper) and
/// turns its distributed-notification impact events into a callback.
/// Experimental and opt-in: launching the helper requires an admin password
/// prompt (via `do shell script ... with administrator privileges`) every
/// time it starts, since v1 doesn't install a persistent root LaunchDaemon.
final class MotionImpactMonitor {
    var onImpact: ((Double) -> Void)?
    private var helperPID: String?
    private var observer: NSObjectProtocol?

    /// The underlying HID accelerometer only exists on Apple Silicon M1 Pro,
    /// M1 Max, M1 Ultra, and M2 and later — not on plain M1, and not on Intel.
    static var isSupported: Bool {
        var size = 0
        sysctlbyname("machdep.cpu.brand_string", nil, &size, nil, 0)
        guard size > 0 else { return false }
        var buffer = [CChar](repeating: 0, count: size)
        sysctlbyname("machdep.cpu.brand_string", &buffer, &size, nil, 0)
        let brand = String(cString: buffer)
        return brand.contains("Apple M") && brand != "Apple M1"
    }

    func start(threshold: Double) {
        guard let helperPath = Bundle.main.path(forAuxiliaryExecutable: "SensorHelper") else { return }

        observer = DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.theftalert.impact"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let magnitude = (notification.userInfo?["magnitude"] as? Double) ?? 0
            self?.onImpact?(magnitude)
        }

        let escapedPath = helperPath.replacingOccurrences(of: "\"", with: "\\\"")
        let script = "do shell script \"'\(escapedPath)' --threshold \(threshold) > /tmp/theftalert-sensor.log 2>&1 & echo $!\" with administrator privileges"

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var error: NSDictionary?
            let result = NSAppleScript(source: script)?.executeAndReturnError(&error)
            if let pid = result?.stringValue {
                self?.helperPID = pid.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
    }

    func stop() {
        if let observer {
            DistributedNotificationCenter.default().removeObserver(observer)
        }
        observer = nil

        guard let pid = helperPID else { return }
        helperPID = nil
        let script = "do shell script \"kill \(pid)\" with administrator privileges"
        DispatchQueue.global(qos: .userInitiated).async {
            var error: NSDictionary?
            NSAppleScript(source: script)?.executeAndReturnError(&error)
        }
    }
}
