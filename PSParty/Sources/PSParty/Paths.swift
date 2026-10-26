import Foundation

/// Everything PS Party installs lives under one folder, separate from any
/// Android Studio setup the user might already have. Must match
/// `Scripts/setup_runtime.sh`.
enum Paths {
    static let avdName = "PSParty"

    static let supportDir: URL = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("PSParty", isDirectory: true)

    static let sdkRoot = supportDir.appendingPathComponent("sdk", isDirectory: true)
    static let avdHome = supportDir.appendingPathComponent("avd", isDirectory: true)
    static let emulatorLog = supportDir.appendingPathComponent("emulator.log")

    static let emulator = sdkRoot.appendingPathComponent("emulator/emulator")
    static let adb = sdkRoot.appendingPathComponent("platform-tools/adb")

    static var setupScript: URL? {
        Bundle.main.url(forResource: "setup_runtime", withExtension: "sh")
    }

    /// True once the setup script has put the emulator, adb and the AVD in place.
    static var isRuntimeInstalled: Bool {
        let fm = FileManager.default
        return fm.isExecutableFile(atPath: emulator.path)
            && fm.isExecutableFile(atPath: adb.path)
            && fm.fileExists(atPath: avdHome.appendingPathComponent("\(avdName).ini").path)
    }

    /// Environment the Android tools need to find our private SDK and AVD.
    static var androidEnvironment: [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["ANDROID_SDK_ROOT"] = sdkRoot.path
        env["ANDROID_HOME"] = sdkRoot.path
        env["ANDROID_AVD_HOME"] = avdHome.path
        return env
    }
}
