import Foundation
import IOKit.hid

// Reads the undocumented Apple Silicon MEMS accelerometer via IOKit HID
// (vendor usage page 0xFF00, usage 3 — see olvvier/apple-silicon-accelerometer
// and taigrr/spank for prior art; this is the same sensor the viral "SlapMac"
// app reads). Opening this HID device requires root, which is why this lives
// in a separate privileged helper instead of inside the main, unprivileged
// TheftAlert app.
//
// We don't know the exact per-axis scaling/offsets Apple uses internally, so
// instead of trying to report real g-forces, this treats any sudden jump
// across the HID elements this device reports as "impact energy" and fires
// once that crosses --threshold. On a hit it posts a distributed
// notification ("com.theftalert.impact") so the unprivileged main app can
// react without any custom IPC of its own, and also prints a line to stdout
// for manual debugging/calibration.

let threshold: Double = {
    let args = CommandLine.arguments
    if let index = args.firstIndex(of: "--threshold"), index + 1 < args.count, let value = Double(args[index + 1]) {
        return value
    }
    return 4000
}()

var lastValues: [IOHIDElementCookie: Int] = [:]
var energy: Double = 0
var lastEventTime: Date = .distantPast

let matching: [String: Any] = [
    kIOHIDDeviceUsagePageKey as String: 0xFF00,
    kIOHIDDeviceUsageKey as String: 3
]

guard let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone)) as IOHIDManager? else {
    FileHandle.standardError.write("Failed to create HID manager\n".data(using: .utf8)!)
    exit(1)
}

IOHIDManagerSetDeviceMatching(manager, matching as CFDictionary)

let callback: IOHIDValueCallback = { _, _, _, value in
    let element = IOHIDValueGetElement(value)
    let cookie = IOHIDElementGetCookie(element)
    let newValue = IOHIDValueGetIntegerValue(value)
    let previous = lastValues[cookie] ?? newValue
    lastValues[cookie] = newValue

    let delta = Double(abs(newValue - previous))
    energy = energy * 0.6 + delta

    if energy > threshold, Date().timeIntervalSince(lastEventTime) > 0.3 {
        lastEventTime = Date()
        DistributedNotificationCenter.default().postNotificationName(
            Notification.Name("com.theftalert.impact"),
            object: nil,
            userInfo: ["magnitude": energy],
            deliverImmediately: true
        )
        print("IMPACT \(energy)")
        fflush(stdout)
    }
}

IOHIDManagerRegisterInputValueCallback(manager, callback, nil)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)

let openResult = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
guard openResult == kIOReturnSuccess else {
    FileHandle.standardError.write("Failed to open HID manager, code \(openResult) (must run as root, and only exists on Apple Silicon M1 Pro/Max/Ultra or M2+)\n".data(using: .utf8)!)
    exit(1)
}

print("SensorHelper started, threshold=\(threshold)")
fflush(stdout)
CFRunLoopRun()
