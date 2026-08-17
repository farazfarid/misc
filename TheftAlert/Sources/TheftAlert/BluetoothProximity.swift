import Foundation
import IOBluetooth

/// Checks whether a specific paired iPhone is currently connected over
/// classic Bluetooth. Classic-pairing status is used instead of BLE scanning
/// because iPhones randomize their BLE advertising address for privacy,
/// making them unreliable to identify without a paired connection.
enum BluetoothProximity {
    static func isDeviceNearby(address: String) -> Bool {
        guard let devices = IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] else { return false }
        return devices.contains { device in
            device.addressString?.caseInsensitiveCompare(address) == .orderedSame && device.isConnected()
        }
    }

    static var pairedDeviceOptions: [(name: String, address: String)] {
        guard let devices = IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] else { return [] }
        return devices.compactMap { device in
            guard let address = device.addressString else { return nil }
            return (device.name ?? "Unknown device", address)
        }
    }
}
