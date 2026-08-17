import Foundation
import IOKit.ps

/// Watches for the Mac being unplugged from AC power using the public
/// IOPowerSources API and its run-loop change notification.
final class PowerSourceMonitor {
    private var runLoopSource: CFRunLoopSource?
    private var lastOnACPower: Bool?
    var onUnplugged: (() -> Void)?

    func start() {
        lastOnACPower = isOnACPower()
        let context = Unmanaged.passUnretained(self).toOpaque()
        let callback: IOPowerSourceCallbackType = { context in
            guard let context else { return }
            let monitor = Unmanaged<PowerSourceMonitor>.fromOpaque(context).takeUnretainedValue()
            monitor.handleChange()
        }
        if let source = IOPSNotificationCreateRunLoopSource(callback, context)?.takeRetainedValue() {
            runLoopSource = source
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
        }
    }

    func stop() {
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .defaultMode)
        }
        runLoopSource = nil
    }

    private func handleChange() {
        let onAC = isOnACPower()
        if lastOnACPower == true, onAC == false {
            onUnplugged?()
        }
        lastOnACPower = onAC
    }

    private func isOnACPower() -> Bool {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let sources = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else {
            return true
        }
        for source in sources {
            guard let description = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: AnyObject] else {
                continue
            }
            if let state = description[kIOPSPowerSourceStateKey] as? String {
                return state == kIOPSACPowerValue
            }
        }
        return true
    }
}
