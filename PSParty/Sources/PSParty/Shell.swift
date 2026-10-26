import Foundation

enum Shell {
    struct Result {
        let status: Int32
        let output: String
        var succeeded: Bool { status == 0 }
    }

    /// Runs a tool to completion and returns its combined stdout/stderr.
    /// Blocks the calling thread, so never call it from the main thread.
    @discardableResult
    static func run(_ executable: URL, _ arguments: [String]) -> Result {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = Paths.androidEnvironment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
        } catch {
            return Result(status: -1, output: error.localizedDescription)
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(data: data, encoding: .utf8) ?? ""
        return Result(status: process.terminationStatus, output: output.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
