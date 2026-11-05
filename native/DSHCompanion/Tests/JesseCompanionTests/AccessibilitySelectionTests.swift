import Foundation
import XCTest
@testable import JesseCompanion

final class AccessibilitySelectionTests: XCTestCase {
    func testEmptyAccessibilitySelectionFallsBackToClipboard() {
        var clipboardReadCount = 0
        let resolution = AccessibilityService.resolveSelection(
            axSelectedText: "",
            rangedText: "",
            selectedRange: CFRange(location: 0, length: 0),
            originalValue: "Chrome editor value"
        ) {
            clipboardReadCount += 1
            return "selected in Chrome"
        }

        XCTAssertEqual(resolution.text, "selected in Chrome")
        XCTAssertEqual(resolution.source, .clipboard)
        XCTAssertNil(resolution.selectedRange)
        XCTAssertNil(resolution.originalValue)
        XCTAssertEqual(clipboardReadCount, 1)
    }

    func testAccessibilitySelectionAvoidsClipboardFallback() {
        var clipboardReadCount = 0
        let range = CFRange(location: 2, length: 5)
        let resolution = AccessibilityService.resolveSelection(
            axSelectedText: "hello",
            rangedText: "hello",
            selectedRange: range,
            originalValue: "--hello--"
        ) {
            clipboardReadCount += 1
            return "clipboard"
        }

        XCTAssertEqual(resolution.text, "hello")
        XCTAssertEqual(resolution.source, .accessibility)
        XCTAssertEqual(resolution.selectedRange?.location, range.location)
        XCTAssertEqual(resolution.selectedRange?.length, range.length)
        XCTAssertEqual(resolution.originalValue, "--hello--")
        XCTAssertEqual(clipboardReadCount, 0)
    }

    func testRangeSelectionIsUsedWhenDirectAttributeIsEmpty() {
        let range = CFRange(location: 1, length: 4)
        let resolution = AccessibilityService.resolveSelection(
            axSelectedText: nil,
            rangedText: "text",
            selectedRange: range,
            originalValue: " text "
        ) {
            XCTFail("Clipboard should not be read when the range has text")
            return nil
        }

        XCTAssertEqual(resolution.text, "text")
        XCTAssertEqual(resolution.source, .accessibilityRange)
        XCTAssertEqual(resolution.selectedRange?.location, range.location)
        XCTAssertEqual(resolution.selectedRange?.length, range.length)
    }

    func testDocumentTextNormalizationRemovesNoiseAndAdjacentDuplicates() {
        let text = AccessibilityService.normalizedDocumentText([
            "  文章标题\u{00a0} ",
            "第一段\r\n  第二行  ",
            "第二行",
            "\t",
        ])

        XCTAssertEqual(text, "文章标题\n第一段\n第二行")
    }

    func testDocumentTextNormalizationRespectsUTF16Limit() {
        let text = AccessibilityService.normalizedDocumentText(["A😀BC"], limit: 4)

        XCTAssertEqual(text, "A😀B")
        XCTAssertEqual(text?.utf16.count, 4)
        XCTAssertEqual(AccessibilityService.normalizedDocumentText(["A😀BC"], limit: 2), "A")
    }

    func testRejectsBrowserChromeTextWhenPageDocumentTreeIsUnavailable() {
        let text = AccessibilityService.preferredDocumentText(
            semanticText: "Back Reload Address and search bar",
            copiedText: nil,
            hasDocumentRoot: false,
            hasPageURL: true
        )

        XCTAssertNil(text)
    }

    func testKeepsSemanticTextFromARealPageDocumentTree() {
        let text = AccessibilityService.preferredDocumentText(
            semanticText: "Article title\nArticle body",
            copiedText: nil,
            hasDocumentRoot: true,
            hasPageURL: true
        )

        XCTAssertEqual(text, "Article title\nArticle body")
    }

    func testNormalizesSafePageURLsAndRejectsExecutableSchemes() {
        XCTAssertEqual(
            AccessibilityService.normalizedPageURL(" https://github.com/vercel/next.js "),
            "https://github.com/vercel/next.js"
        )
        XCTAssertEqual(
            AccessibilityService.normalizedPageURL("file:///tmp/demo.html"),
            "file:///tmp/demo.html"
        )
        XCTAssertNil(AccessibilityService.normalizedPageURL("javascript:alert(1)"))
        XCTAssertNil(AccessibilityService.normalizedPageURL("data:text/html,hello"))
    }
}
