import AppKit
import SwiftUI
import XCTest
@testable import JesseCompanion

@MainActor
final class CompanionHostingTests: XCTestCase {
    private final class PasteRecordingView: NSView {
        private(set) var pasteCount = 0

        @objc func paste(_ sender: Any?) {
            pasteCount += 1
        }
    }

    func testTransparentSurfacesNeverUseNativeWindowShadow() {
        XCTAssertFalse(CompanionSurface.ring.usesNativeWindowShadow)
        XCTAssertFalse(CompanionSurface.ask.usesNativeWindowShadow)
        XCTAssertFalse(CompanionSurface.result.usesNativeWindowShadow)
        XCTAssertFalse(CompanionSurface.results.usesNativeWindowShadow)
        XCTAssertFalse(CompanionSurface.tasks.usesNativeWindowShadow)
    }

    func testPanelOnlyAcceptsKeyboardFocusWhenRequested() {
        let panel = CompanionPanel(
            contentRect: NSRect(origin: .zero, size: RingGeometry.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        XCTAssertFalse(panel.canBecomeKey)
        XCTAssertFalse(panel.canBecomeMain)

        panel.allowsKeyboardFocus = true

        XCTAssertTrue(panel.canBecomeKey)
        XCTAssertFalse(panel.canBecomeMain)
    }

    func testHostingViewAcceptsTheFirstMouseClick() {
        let model = CompanionViewModel()
        let host = CompanionHostingView(rootView: CompanionRootView(model: model))

        XCTAssertTrue(host.acceptsFirstMouse(for: nil))
    }

    func testPanelForwardsCommandVToFocusedEditor() throws {
        let panel = CompanionPanel(
            contentRect: NSRect(origin: .zero, size: RingGeometry.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        let editor = PasteRecordingView(frame: panel.contentView?.bounds ?? .zero)
        panel.contentView = editor
        panel.allowsKeyboardFocus = true
        XCTAssertTrue(panel.makeFirstResponder(editor))

        let event = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: .command,
            timestamp: 0,
            windowNumber: panel.windowNumber,
            context: nil,
            characters: "v",
            charactersIgnoringModifiers: "v",
            isARepeat: false,
            keyCode: 9
        ))

        XCTAssertTrue(panel.performKeyEquivalent(with: event))
        XCTAssertEqual(editor.pasteCount, 1)
    }

    func testPanelTurnsPastedImageIntoComposerAttachment() throws {
        let panel = CompanionPanel(
            contentRect: NSRect(origin: .zero, size: RingGeometry.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        let editor = PasteRecordingView(frame: panel.contentView?.bounds ?? .zero)
        panel.contentView = editor
        panel.allowsKeyboardFocus = true
        XCTAssertTrue(panel.makeFirstResponder(editor))

        let pasteboard = NSPasteboard(name: .init("DSH.CompanionHostingTests.\(UUID().uuidString)"))
        pasteboard.clearContents()
        pasteboard.setData(Data([1, 2, 3]), forType: .init("public.png"))
        panel.pasteboardProvider = { pasteboard }
        var pastedDataURL: String?
        panel.imagePasteHandler = { dataURL in
            pastedDataURL = dataURL
            return true
        }

        let event = try pasteEvent(for: panel)
        XCTAssertTrue(panel.performKeyEquivalent(with: event))
        XCTAssertEqual(pastedDataURL, "data:image/png;base64,AQID")
        XCTAssertEqual(editor.pasteCount, 0)
    }

    func testPanelStillForwardsTextPasteWhenImageHandlerIsInstalled() throws {
        let panel = CompanionPanel(
            contentRect: NSRect(origin: .zero, size: RingGeometry.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        let editor = PasteRecordingView(frame: panel.contentView?.bounds ?? .zero)
        panel.contentView = editor
        panel.allowsKeyboardFocus = true
        XCTAssertTrue(panel.makeFirstResponder(editor))

        let pasteboard = NSPasteboard(name: .init("DSH.CompanionHostingTests.\(UUID().uuidString)"))
        pasteboard.clearContents()
        pasteboard.setString("clipboard text", forType: .string)
        panel.pasteboardProvider = { pasteboard }
        panel.imagePasteHandler = { _ in
            XCTFail("Text paste must not invoke the image handler")
            return true
        }

        XCTAssertTrue(panel.performKeyEquivalent(with: try pasteEvent(for: panel)))
        XCTAssertEqual(editor.pasteCount, 1)
    }

    func testMainMenuProvidesStandardPasteKeyEquivalent() throws {
        let mainMenu = CompanionMainMenu.make(language: .simplifiedChinese)
        let editMenu = try XCTUnwrap(mainMenu.items.first?.submenu)
        let copyItem = try XCTUnwrap(editMenu.items.first(where: { $0.action == #selector(NSText.copy(_:)) }))
        let pasteItem = try XCTUnwrap(editMenu.items.first(where: { $0.action == #selector(NSText.paste(_:)) }))

        XCTAssertEqual(mainMenu.items.first?.title, "编辑")
        XCTAssertEqual(copyItem.title, "复制")
        XCTAssertEqual(copyItem.keyEquivalent, "c")
        XCTAssertEqual(copyItem.keyEquivalentModifierMask, .command)
        XCTAssertEqual(pasteItem.title, "粘贴")
        XCTAssertEqual(pasteItem.action, #selector(NSText.paste(_:)))
        XCTAssertEqual(pasteItem.keyEquivalent, "v")
        XCTAssertEqual(pasteItem.keyEquivalentModifierMask, .command)
    }

    private func pasteEvent(for panel: NSPanel) throws -> NSEvent {
        try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: .command,
            timestamp: 0,
            windowNumber: panel.windowNumber,
            context: nil,
            characters: "v",
            charactersIgnoringModifiers: "v",
            isARepeat: false,
            keyCode: 9
        ))
    }
}
