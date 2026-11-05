import Foundation
import XCTest
@testable import JesseCompanion

final class ResultStoreTests: XCTestCase {
    func testPersistsTextAndImageResultsWithoutEmbeddingImageInMetadata() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ResultStore(root: root)
        let image = "data:image/png;base64," + onePixelPNG.base64EncodedString()
        let result = QuickTaskResult(
            id: "image-result",
            action: .image,
            title: "生成配图",
            text: "配图已生成",
            state: .completed,
            sourceApp: "Notion",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            imageDataURL: image,
            delivery: .saved
        )

        store.save([result])

        let metadata = try String(contentsOf: root.appending(path: "results.json"), encoding: .utf8)
        XCTAssertFalse(metadata.contains(onePixelPNG.base64EncodedString()))
        let loaded = try XCTUnwrap(store.load()[result.id])
        XCTAssertEqual(loaded.imageDataURL, image)
        XCTAssertEqual(loaded.sourceApp, "Notion")
    }

    func testMarksInterruptedTaskAsFailed() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ResultStore(root: root)
        let result = QuickTaskResult(
            id: "running-result",
            action: .polish,
            title: "润色",
            text: "",
            state: .running,
            sourceApp: "Teams",
            createdAt: Date(),
            imageDataURL: nil,
            delivery: .pending
        )

        store.save([result])

        let loaded = try XCTUnwrap(store.load()[result.id])
        XCTAssertEqual(loaded.state, .failed)
    }

    private var onePixelPNG: Data {
        Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==")!
    }
}
