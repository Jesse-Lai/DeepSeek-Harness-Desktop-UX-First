import AppKit
import SwiftUI

struct FluentIcon: View {
    let name: String

    var body: some View {
        Group {
            if let image = FluentIconAssets.image(named: name) {
                Image(nsImage: image)
                    .resizable()
                    .renderingMode(.template)
                    .aspectRatio(contentMode: .fit)
            } else {
                Color.clear
            }
        }
        .accessibilityHidden(true)
    }
}

@MainActor
enum FluentIconAssets {
    private static var cache: [String: NSImage] = [:]

    static func image(named name: String) -> NSImage? {
        if let cached = cache[name] {
            return cached
        }
        guard let url = resourceURL(named: name),
              let image = NSImage(contentsOf: url) else {
            return nil
        }
        image.isTemplate = true
        cache[name] = image
        return image
    }

    private static func resourceURL(named name: String) -> URL? {
        if let resourceRoot = Bundle.main.resourceURL {
            let packagedURL = resourceRoot
                .appendingPathComponent("FluentIcons")
                .appendingPathComponent("\(name).svg")
            if FileManager.default.fileExists(atPath: packagedURL.path) {
                return packagedURL
            }
        }
#if DEBUG
        let sourceDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
        let developmentURL = sourceDirectory
            .appendingPathComponent("Resources/FluentIcons")
            .appendingPathComponent("\(name).svg")
        return FileManager.default.fileExists(atPath: developmentURL.path)
            ? developmentURL
            : nil
#else
        return nil
#endif
    }
}
