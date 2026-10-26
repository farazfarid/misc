// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PSParty",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "PSParty",
            path: "Sources/PSParty"
        )
    ]
)
