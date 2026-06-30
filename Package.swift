// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "pass-safari",
    platforms: [
        .macOS(.v11)
    ],
    dependencies: [
        .package(url: "https://github.com/outfoxx/PotentCodables.git", from: "3.2.0")
    ],
    targets: [
        .target(
            name: "pass-safari",
            dependencies: [
                .product(name: "PotentCBOR", package: "PotentCodables")
            ]
        )
    ]
)
