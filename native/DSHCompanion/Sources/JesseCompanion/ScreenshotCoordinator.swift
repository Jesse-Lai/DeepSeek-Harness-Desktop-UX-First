import AppKit
import CoreGraphics
import ScreenCaptureKit

@MainActor
enum ScreenshotCoordinator {
    enum CaptureError: LocalizedError {
        case permissionDenied
        case unavailable
        case cancelled

        var errorDescription: String? {
            switch self {
            case .permissionDenied:
                InterfaceLanguage.current.text(
                    "需要在系统设置中允许 DSH 录制屏幕。",
                    "Allow DSH to record the screen in System Settings."
                )
            case .unavailable:
                InterfaceLanguage.current.text("无法截取所选区域。", "The selected area could not be captured.")
            case .cancelled:
                InterfaceLanguage.current.text("已取消截图。", "Screenshot cancelled.")
            }
        }
    }

    static func captureInteractiveRegion() async throws -> String {
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            throw CaptureError.permissionDenied
        }
        guard let selection = await RegionSelectionController.selectRegion() else {
            throw CaptureError.cancelled
        }
        try? await Task.sleep(for: .milliseconds(60))
        guard let image = try? await captureRegion(selection),
              let bitmap = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw CaptureError.unavailable
        }
        return "data:image/png;base64," + bitmap.base64EncodedString()
    }

    static func captureApplicationWindow(processID: pid_t) async throws -> String {
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            throw CaptureError.permissionDenied
        }

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let window = content.windows
            .filter({ window in
                window.owningApplication?.processID == processID
                    && window.isOnScreen
                    && window.frame.width >= 100
                    && window.frame.height >= 100
            })
            .max(by: { windowArea($0) < windowArea($1) }) else {
            throw CaptureError.unavailable
        }

        let outputSize = ScreenshotGeometry.outputSize(sourceRect: window.frame, displayScale: 2)
        let configuration = SCStreamConfiguration()
        configuration.width = outputSize.width
        configuration.height = outputSize.height
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        guard let bitmap = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [
            .compressionFactor: 0.86,
        ]) else {
            throw CaptureError.unavailable
        }
        return "data:image/jpeg;base64," + bitmap.base64EncodedString()
    }

    private static func windowArea(_ window: SCWindow) -> CGFloat {
        window.frame.width * window.frame.height
    }

    private static func captureRegion(_ selection: CGRect) async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays
            .filter({ $0.frame.intersects(selection) })
            .max(by: {
                ScreenshotGeometry.intersectionArea($0.frame, selection)
                    < ScreenshotGeometry.intersectionArea($1.frame, selection)
            }) else {
            throw CaptureError.unavailable
        }
        let clippedSelection = selection.intersection(display.frame)
        guard !clippedSelection.isNull, clippedSelection.width >= 1, clippedSelection.height >= 1 else {
            throw CaptureError.unavailable
        }
        let sourceRect = CGRect(
            x: clippedSelection.minX - display.frame.minX,
            y: clippedSelection.minY - display.frame.minY,
            width: clippedSelection.width,
            height: clippedSelection.height
        )
        let scale = display.frame.width > 0 ? CGFloat(display.width) / display.frame.width : 1
        let outputSize = ScreenshotGeometry.outputSize(sourceRect: sourceRect, displayScale: scale)
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = sourceRect
        configuration.width = outputSize.width
        configuration.height = outputSize.height
        configuration.showsCursor = false
        let filter = SCContentFilter(display: display, excludingWindows: [])
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    }
}

@MainActor
private final class RegionSelectionController: NSObject {
    private static var activeController: RegionSelectionController?
    private var windows: [SelectionWindow] = []
    private var continuation: CheckedContinuation<CGRect?, Never>?

    static func selectRegion() async -> CGRect? {
        await withCheckedContinuation { continuation in
            let controller = RegionSelectionController()
            activeController = controller
            controller.continuation = continuation
            controller.begin()
        }
    }

    private func begin() {
        windows = NSScreen.screens.map { screen in
            let window = SelectionWindow(contentRect: screen.frame, screen: screen)
            window.selectionDelegate = self
            window.orderFrontRegardless()
            return window
        }
        let pointer = NSEvent.mouseLocation
        (windows.first { NSMouseInRect(pointer, $0.frame, false) } ?? windows.first)?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.crosshair.push()
    }

    fileprivate func complete(rect: CGRect?) {
        windows.forEach { $0.orderOut(nil) }
        windows.removeAll()
        NSCursor.pop()
        continuation?.resume(returning: rect)
        continuation = nil
        Self.activeController = nil
    }
}

@MainActor
private final class SelectionWindow: NSWindow {
    weak var selectionDelegate: RegionSelectionController?

    init(contentRect: NSRect, screen: NSScreen) {
        super.init(contentRect: contentRect, styleMask: .borderless, backing: .buffered, defer: false)
        setFrame(contentRect, display: false)
        level = .screenSaver
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isOpaque = false
        backgroundColor = .clear
        ignoresMouseEvents = false
        acceptsMouseMovedEvents = true
        contentView = SelectionView(frame: NSRect(origin: .zero, size: contentRect.size))
        (contentView as? SelectionView)?.windowOwner = self
    }

    override var canBecomeKey: Bool { true }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { selectionDelegate?.complete(rect: nil) }
        else { super.keyDown(with: event) }
    }
}

@MainActor
private final class SelectionView: NSView {
    weak var windowOwner: SelectionWindow?
    private var start: NSPoint?
    private var current: NSPoint?

    override func mouseDown(with event: NSEvent) {
        start = convert(event.locationInWindow, from: nil)
        current = start
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        guard let localRect = selectionRect, localRect.width >= 4, localRect.height >= 4, let window else {
            windowOwner?.selectionDelegate?.complete(rect: nil)
            return
        }
        let screenRect = window.convertToScreen(localRect)
        guard let screen = window.screen else {
            windowOwner?.selectionDelegate?.complete(rect: nil)
            return
        }
        let displayBounds = CGDisplayBounds(screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID ?? 0)
        let quartzRect = ScreenshotGeometry.quartzRect(
            screenRect: screenRect,
            screenFrame: screen.frame,
            displayBounds: displayBounds
        )
        windowOwner?.selectionDelegate?.complete(rect: quartzRect)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.42).setFill()
        bounds.fill()
        guard let selectionRect else { return }
        NSGraphicsContext.current?.saveGraphicsState()
        NSBezierPath(rect: selectionRect).addClip()
        NSColor.clear.setFill()
        selectionRect.fill(using: .copy)
        NSGraphicsContext.current?.restoreGraphicsState()
        NSColor.white.withAlphaComponent(0.9).setStroke()
        let border = NSBezierPath(rect: selectionRect.insetBy(dx: 0.5, dy: 0.5))
        border.lineWidth = 1
        border.stroke()
    }

    private var selectionRect: NSRect? {
        guard let start, let current else { return nil }
        return NSRect(
            x: min(start.x, current.x),
            y: min(start.y, current.y),
            width: abs(start.x - current.x),
            height: abs(start.y - current.y)
        )
    }
}

enum ScreenshotGeometry {
    static let maximumOutputDimension = 4_096

    static func quartzRect(screenRect: CGRect, screenFrame: CGRect, displayBounds: CGRect) -> CGRect {
        CGRect(
            x: displayBounds.minX + screenRect.minX - screenFrame.minX,
            y: displayBounds.minY + screenFrame.maxY - screenRect.maxY,
            width: screenRect.width,
            height: screenRect.height
        )
    }

    static func outputSize(
        sourceRect: CGRect,
        displayScale: CGFloat,
        maximumDimension: Int = maximumOutputDimension
    ) -> (width: Int, height: Int) {
        let nativeWidth = max(1, sourceRect.width * max(displayScale, 1))
        let nativeHeight = max(1, sourceRect.height * max(displayScale, 1))
        let limitScale = min(1, CGFloat(maximumDimension) / max(nativeWidth, nativeHeight))
        return (
            width: max(1, Int((nativeWidth * limitScale).rounded())),
            height: max(1, Int((nativeHeight * limitScale).rounded()))
        )
    }

    static func intersectionArea(_ lhs: CGRect, _ rhs: CGRect) -> CGFloat {
        let intersection = lhs.intersection(rhs)
        return intersection.isNull ? 0 : intersection.width * intersection.height
    }
}
