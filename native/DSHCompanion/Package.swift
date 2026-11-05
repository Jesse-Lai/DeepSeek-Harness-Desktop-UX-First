// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "JesseCompanion",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "JesseCompanion", targets: ["JesseCompanion"]),
    ],
    targets: [
        .executableTarget(
            name: "JesseCompanion",
            exclude: ["Resources"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("Carbon"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("ServiceManagement"),
            ]
        ),
        .testTarget(
            name: "JesseCompanionTests",
            dependencies: ["JesseCompanion"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
