import Foundation
import CoreWLAN

/// Detects the Mac leaving a known trusted Wi-Fi network, used as a proxy
/// for "the Mac left the house/office" since macOS exposes no accelerometer
/// or GPS on most Macs. Reading the SSID requires Location Services
/// permission (see NSLocationWhenInUseUsageDescription in Info.plist).
final class TrustedNetworkMonitor {
    private var timer: Timer?
    private var lastSSID: String?
    var trustedSSID: String?
    var onLeftTrustedNetwork: (() -> Void)?

    func start() {
        guard trustedSSID != nil else { return }
        lastSSID = CWWiFiClient.shared().interface()?.ssid()
        timer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func poll() {
        guard let trustedSSID else { return }
        let currentSSID = CWWiFiClient.shared().interface()?.ssid()
        if lastSSID == trustedSSID, currentSSID != trustedSSID {
            onLeftTrustedNetwork?()
        }
        lastSSID = currentSSID
    }
}
