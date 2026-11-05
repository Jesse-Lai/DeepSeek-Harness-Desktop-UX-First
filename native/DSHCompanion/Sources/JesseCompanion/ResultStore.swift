import Foundation

final class ResultStore {
    private let fileManager: FileManager
    private let root: URL
    private let metadataURL: URL
    private let maxResults: Int

    init(fileManager: FileManager = .default, root: URL? = nil, maxResults: Int = 30) {
        self.fileManager = fileManager
        let base = root ?? ProcessInfo.processInfo.environment["DSH_COMPANION_DATA"].map { URL(fileURLWithPath: $0).appending(path: "results") } ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "DSH Companion", directoryHint: .isDirectory)
        self.root = base
        self.metadataURL = base.appending(path: "results.json")
        self.maxResults = maxResults
    }

    func load() -> [String: QuickTaskResult] {
        guard let data = try? Data(contentsOf: metadataURL),
              var values = try? decoder.decode([QuickTaskResult].self, from: data) else { return [:] }
        for index in values.indices where values[index].imageDataURL == nil {
            let imageURL = root.appending(path: "\(values[index].id).png")
            if let imageData = try? Data(contentsOf: imageURL) {
                values[index].imageDataURL = "data:image/png;base64," + imageData.base64EncodedString()
            }
            if values[index].state == .running {
                values[index].state = .failed
                values[index].text = InterfaceLanguage.current.text(
                    "DSH 上次退出时任务仍在运行。",
                    "The task was still running when DSH last quit."
                )
            }
        }
        return Dictionary(uniqueKeysWithValues: values.map { ($0.id, $0) })
    }

    func save(_ values: [QuickTaskResult]) {
        let retained = values.sorted { $0.createdAt > $1.createdAt }.prefix(maxResults)
        do {
            try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
            var metadata: [QuickTaskResult] = []
            for var value in retained {
                if let dataURL = value.imageDataURL, let data = decodeImage(dataURL) {
                    try data.write(to: root.appending(path: "\(value.id).png"), options: .atomic)
                }
                value.imageDataURL = nil
                metadata.append(value)
            }
            try encoder.encode(metadata).write(to: metadataURL, options: .atomic)
            removeUnreferencedImages(keeping: Set(retained.map(\.id)))
        } catch {
            return
        }
    }

    private func decodeImage(_ dataURL: String) -> Data? {
        guard let comma = dataURL.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
    }

    private func removeUnreferencedImages(keeping identifiers: Set<String>) {
        guard let files = try? fileManager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
        for file in files where file.pathExtension == "png" && !identifiers.contains(file.deletingPathExtension().lastPathComponent) {
            try? fileManager.removeItem(at: file)
        }
    }

    private var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
