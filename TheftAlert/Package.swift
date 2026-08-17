// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TheftAlert",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "TheftAlert",
            path: "Sources/TheftAlert"
        ),
        .executableTarget(
            name: "SensorHelper",
            path: "Sources/SensorHelper"
        )
    ]
)
