import AppKit
import ApplicationServices
import CoreGraphics
import OSLog

final class AccessibilityService {
    private static let chromiumBundleIdentifiers: Set<String> = [
        "com.google.Chrome",
        "com.google.Chrome.beta",
        "com.google.Chrome.dev",
        "com.google.Chrome.canary",
    ]
    private static let documentRoles: Set<String> = ["AXWebArea", "AXDocument"]
    private static let textEntryRoles: Set<String> = ["AXTextArea", "AXTextField"]
    private static let terminalTextRoles: Set<String> = ["AXStaticText", "AXInlineTextBox"]
    private static let leafSemanticRoles: Set<String> = [
        "AXHeading",
        "AXLink",
        "AXListItem",
        "AXCell",
        "AXRow",
        "AXParagraph",
    ]

    enum SelectionSource: String, Equatable {
        case accessibility
        case accessibilityRange
        case clipboard
        case none
    }

    struct SelectionResolution {
        let text: String?
        let selectedRange: CFRange?
        let originalValue: String?
        let source: SelectionSource
    }

    private static let logger = Logger(subsystem: "com.jesselai.dsh.companion", category: "accessibility")

    func captureFocusedContext(promptForPermission: Bool = false) -> CapturedContext {
        let frontmost = NSWorkspace.shared.frontmostApplication
        let trusted = isTrusted(prompt: promptForPermission)
        let screenGranted = CGPreflightScreenCaptureAccess()
        guard trusted else {
            // Reading the active Chrome/Safari tab through AppleScript does not
            // require the Accessibility grant. This keeps page-aware shortcuts
            // useful while still leaving selection capture and write-back off.
            let pageContext = scriptedBrowserPageContext(bundleIdentifier: frontmost?.bundleIdentifier)
            return CapturedContext(
                sourcePID: frontmost?.processIdentifier,
                sourceBundleIdentifier: frontmost?.bundleIdentifier,
                sourceAppName: frontmost?.localizedName,
                sourceURL: pageContext?.url,
                sourcePageTitle: pageContext?.title,
                focusedWindow: nil,
                focusedElement: nil,
                selectedText: nil,
                selectedRange: nil,
                originalValue: nil,
                canWriteBack: false,
                accessibilityGranted: false,
                screenRecordingGranted: screenGranted
            )
        }

        guard let runningApp = frontmost else {
            Self.logger.error("Cannot capture context because there is no frontmost application")
            return CapturedContext(
                sourcePID: nil,
                sourceBundleIdentifier: nil,
                sourceAppName: nil,
                sourceURL: nil,
                sourcePageTitle: nil,
                focusedWindow: nil,
                focusedElement: nil,
                selectedText: nil,
                selectedRange: nil,
                originalValue: nil,
                canWriteBack: false,
                accessibilityGranted: true,
                screenRecordingGranted: screenGranted
            )
        }

        let pid = runningApp.processIdentifier
        let focusedApplication = AXUIElementCreateApplication(pid)
        enableBrowserAccessibilityIfNeeded(
            bundleIdentifier: runningApp.bundleIdentifier,
            application: focusedApplication
        )
        let window = copyAXElement(focusedApplication, kAXFocusedWindowAttribute)
        let element = copyAXElement(focusedApplication, kAXFocusedUIElementAttribute)
        let axSelectedText = element.flatMap { copyAttribute($0, kAXSelectedTextAttribute) as? String }
        let originalValue = element.flatMap { copyAttribute($0, kAXValueAttribute) as? String }
        let range = element.flatMap(readSelectedRange).flatMap { $0.length > 0 ? $0 : nil }
        let rangedText = element.flatMap { focusedElement in
            range.flatMap { selectedRange in
                string(in: selectedRange, on: focusedElement)
                    ?? originalValue.flatMap { substring($0, range: selectedRange) }
            }
        }
        let resolution = Self.resolveSelection(
            axSelectedText: axSelectedText,
            rangedText: rangedText,
            selectedRange: range,
            originalValue: originalValue
        ) { [self] in
            if let element, isSecureTextField(element) { return nil }
            return copyFocusedSelectionPreservingClipboard()
        }
        let canWriteBack = resolution.text != nil
        let pageContext = browserPageContext(
            bundleIdentifier: runningApp.bundleIdentifier,
            focusedElement: element,
            window: window
        )
        let role = element.flatMap { copyAttribute($0, kAXRoleAttribute) as? String } ?? "none"
        let rangeDescription = resolution.selectedRange.map { "\($0.location):\($0.length)" } ?? "none"
        Self.logger.notice(
            "Captured context; app=\(runningApp.localizedName ?? "unknown", privacy: .public); role=\(role, privacy: .public); source=\(resolution.source.rawValue, privacy: .public); selectedLength=\(resolution.text?.utf16.count ?? 0); range=\(rangeDescription, privacy: .public)"
        )

        return CapturedContext(
            sourcePID: pid,
            sourceBundleIdentifier: runningApp.bundleIdentifier,
            sourceAppName: runningApp.localizedName,
            sourceURL: pageContext?.url,
            sourcePageTitle: pageContext?.title,
            focusedWindow: window,
            focusedElement: element,
            selectedText: resolution.text,
            selectedRange: resolution.selectedRange,
            originalValue: resolution.originalValue,
            canWriteBack: canWriteBack,
            accessibilityGranted: true,
            screenRecordingGranted: screenGranted
        )
    }

    private func browserPageContext(
        bundleIdentifier: String?,
        focusedElement: AXUIElement?,
        window: AXUIElement?
    ) -> (url: String, title: String?)? {
        let documentRoot = nearestDocumentRoot(from: focusedElement)
            ?? window.flatMap(findDocumentRoot)
        if let documentRoot,
           let rawURL = firstURLAttribute(of: documentRoot),
           let normalizedURL = Self.normalizedPageURL(rawURL) {
            let title = firstTextAttribute(
                of: documentRoot,
                attributes: [kAXTitleAttribute, kAXDescriptionAttribute]
            )
            return (normalizedURL, title)
        }

        return scriptedBrowserPageContext(bundleIdentifier: bundleIdentifier)
    }

    private func firstURLAttribute(of element: AXUIElement) -> String? {
        for attribute in ["AXURL", "AXDocument"] {
            guard let value = copyAttribute(element, attribute) else { continue }
            if let url = value as? URL { return url.absoluteString }
            if let text = value as? String { return text }
        }
        return nil
    }

    private func scriptedBrowserPageContext(bundleIdentifier: String?) -> (url: String, title: String?)? {
        let source: String
        switch bundleIdentifier {
        case "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary":
            source = """
            tell application id "(bundleIdentifier ?? "com.google.Chrome")"
                if (count of windows) is 0 then return ""
                set currentTab to active tab of front window
                return (URL of currentTab) & linefeed & (title of currentTab)
            end tell
            """
        case "com.apple.Safari", "com.apple.SafariTechnologyPreview":
            source = """
            tell application id "(bundleIdentifier ?? "com.apple.Safari")"
                if (count of windows) is 0 then return ""
                set currentTab to current tab of front window
                return (URL of currentTab) & linefeed & (name of currentTab)
            end tell
            """
        default:
            return nil
        }

        var error: NSDictionary?
        guard let result = NSAppleScript(source: source)?.executeAndReturnError(&error).stringValue else {
            if let error {
                Self.logger.debug("Could not read browser URL through AppleScript: \(String(describing: error), privacy: .public)")
            }
            return nil
        }
        let parts = result.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        guard let rawURL = parts.first.map(String.init),
              let normalizedURL = Self.normalizedPageURL(rawURL) else { return nil }
        let title = parts.count > 1 ? String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines) : nil
        return (normalizedURL, title?.isEmpty == false ? title : nil)
    }

    static func normalizedPageURL(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty,
              value.count <= 4_000,
              let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https", "file"].contains(scheme) else { return nil }
        return components.url?.absoluteString
    }

    func refreshPermissionState(for context: CapturedContext, prompt: Bool) -> CapturedContext {
        let trusted = isTrusted(prompt: prompt)
        return context.withPermissionState(
            accessibilityGranted: trusted,
            screenRecordingGranted: CGPreflightScreenCaptureAccess()
        )
    }

    func documentText(for context: CapturedContext, maximumLength: Int = 48_000) -> String? {
        guard maximumLength > 0,
              isTrusted(prompt: false),
              let pid = context.sourcePID else { return nil }

        let application = AXUIElementCreateApplication(pid)
        enableBrowserAccessibilityIfNeeded(
            bundleIdentifier: context.sourceBundleIdentifier,
            application: application
        )
        let window = context.focusedWindow ?? copyAXElement(application, kAXFocusedWindowAttribute)
        let focusedElement = context.focusedElement
            ?? copyAXElement(application, kAXFocusedUIElementAttribute)
        if let focusedElement, isSecureTextField(focusedElement) { return nil }

        let documentRoot = nearestDocumentRoot(from: focusedElement)
            ?? window.flatMap(findDocumentRoot)
        let focusedRole = focusedElement.flatMap(role)
        let semanticRoot: AXUIElement = documentRoot
            ?? ((focusedRole.map { Self.textEntryRoles.contains($0) } == true) ? focusedElement : nil)
            ?? window
            ?? focusedElement
            ?? application
        let rootRole = role(of: semanticRoot) ?? "unknown"
        let chunks = readableTextChunks(from: semanticRoot, characterBudget: maximumLength)
        let semanticText = Self.normalizedDocumentText(chunks, limit: maximumLength)

        var copiedText: String?
        if Self.utf16Length(of: semanticText) < 120,
           let wholeDocumentText = copyWholeDocumentPreservingClipboard(
               context: context,
               documentRoot: documentRoot,
               maximumLength: maximumLength
           ) {
            copiedText = wholeDocumentText
        }

        let resolvedText = Self.preferredDocumentText(
            semanticText: semanticText,
            copiedText: copiedText,
            hasDocumentRoot: documentRoot != nil,
            hasPageURL: context.sourceURL != nil
        )
        let source: String
        if resolvedText == nil, context.sourceURL != nil, documentRoot == nil {
            source = "page-url-fallback"
        } else if resolvedText == copiedText, copiedText != nil {
            source = "clipboard"
        } else {
            source = "accessibility"
        }

        let appName = context.sourceAppName ?? "unknown"
        let resolvedLength = Self.utf16Length(of: resolvedText)
        Self.logger.notice(
            "Captured document text; app=\(appName, privacy: .public); rootRole=\(rootRole, privacy: .public); source=\(source, privacy: .public); length=\(resolvedLength)"
        )
        return resolvedText
    }

    static func preferredDocumentText(
        semanticText: String?,
        copiedText: String?,
        hasDocumentRoot: Bool,
        hasPageURL: Bool
    ) -> String? {
        // If a browser exposes only its AXWindow, the collected strings are
        // toolbar labels rather than page content. Returning nil lets the
        // caller use the captured page URL instead of summarizing browser UI.
        guard !hasPageURL || hasDocumentRoot else { return nil }
        return utf16Length(of: copiedText) > utf16Length(of: semanticText)
            ? copiedText
            : semanticText
    }

    static func normalizedDocumentText(_ chunks: [String], limit: Int = 48_000) -> String? {
        guard limit > 0 else { return nil }
        var output = ""
        var previousLine: String?

        for chunk in chunks {
            let canonical = chunk
                .replacingOccurrences(of: "\r\n", with: "\n")
                .replacingOccurrences(of: "\r", with: "\n")
                .replacingOccurrences(of: "\u{00a0}", with: " ")
            for rawLine in canonical.components(separatedBy: "\n") {
                let line = rawLine.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
                guard !line.isEmpty, line != previousLine else { continue }

                let separator = output.isEmpty ? "" : "\n"
                let remaining = limit - Self.utf16Length(of: output) - separator.utf16.count
                guard remaining > 0 else { return output.isEmpty ? nil : output }
                let fitted = truncateUTF16(line, to: remaining)
                guard !fitted.isEmpty else { return output.isEmpty ? nil : output }
                output += separator + fitted
                previousLine = line
                if fitted != line { return output }
            }
        }
        return output.isEmpty ? nil : output
    }

    func writeBack(_ text: String, to context: CapturedContext, requireUnchangedSelection: Bool) async -> WriteBackOutcome {
        guard isTrusted(prompt: false) else {
            copyToClipboard(text)
            return .permissionDenied
        }
        guard let element = context.focusedElement else {
            return await writeBackWithKeyboard(
                text: text,
                context: context,
                requireUnchangedSelection: requireUnchangedSelection
            )
        }

        await activateAndFocus(context: context, element: element)
        if requireUnchangedSelection && !targetStillMatches(context, element: element) {
            copyToClipboard(text)
            return .targetChanged
        }

        if let range = context.selectedRange {
            setSelectedRange(range, on: element)
        }
        if isSettable(element, attribute: kAXSelectedTextAttribute) {
            let error = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
            if error == .success { return .replaced }
        }

        copyToClipboard(text)
        return await paste(element: element, insertionRange: context.selectedRange)
    }

    func writeBackImage(_ dataURL: String, to context: CapturedContext, requireUnchangedSelection: Bool) async -> WriteBackOutcome {
        guard isTrusted(prompt: false) else {
            copyImageToClipboard(dataURL)
            return .permissionDenied
        }
        guard let element = context.focusedElement else {
            copyImageToClipboard(dataURL)
            return .unavailable
        }
        await activateAndFocus(context: context, element: element)
        guard copyImageToClipboard(dataURL) else { return .unavailable }
        if requireUnchangedSelection && !targetStillMatches(context, element: element) {
            return .targetChanged
        }
        let insertionRange = context.selectedRange.map {
            CFRange(location: $0.location + $0.length, length: 0)
        }
        return await paste(
            element: element,
            insertionRange: insertionRange,
            collapseSelectionToEnd: true
        )
    }

    func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    @discardableResult
    func copyImageToClipboard(_ dataURL: String) -> Bool {
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let image = NSImage(data: data) else { return false }
        NSPasteboard.general.clearContents()
        return NSPasteboard.general.writeObjects([image])
    }

    func isTrusted(prompt: Bool) -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    private func enableBrowserAccessibilityIfNeeded(
        bundleIdentifier: String?,
        application: AXUIElement
    ) {
        guard let bundleIdentifier,
              Self.chromiumBundleIdentifiers.contains(bundleIdentifier) else { return }
        // Chromium lazily builds its renderer accessibility tree. This custom
        // application attribute is the same opt-in used by assistive clients.
        _ = AXUIElementSetAttributeValue(
            application,
            "AXManualAccessibility" as CFString,
            kCFBooleanTrue
        )
    }

    static func resolveSelection(
        axSelectedText: String?,
        rangedText: String?,
        selectedRange: CFRange?,
        originalValue: String?,
        clipboardText: () -> String?
    ) -> SelectionResolution {
        if let text = nonEmptyText(axSelectedText) {
            let rangeMatches = nonEmptyText(rangedText) == text && (selectedRange?.length ?? 0) > 0
            return SelectionResolution(
                text: text,
                selectedRange: rangeMatches ? selectedRange : nil,
                originalValue: rangeMatches ? originalValue : nil,
                source: .accessibility
            )
        }
        if let text = nonEmptyText(rangedText), let selectedRange, selectedRange.length > 0 {
            return SelectionResolution(
                text: text,
                selectedRange: selectedRange,
                originalValue: originalValue,
                source: .accessibilityRange
            )
        }
        if let text = nonEmptyText(clipboardText()) {
            return SelectionResolution(text: text, selectedRange: nil, originalValue: nil, source: .clipboard)
        }
        return SelectionResolution(text: nil, selectedRange: nil, originalValue: nil, source: .none)
    }

    private static func nonEmptyText(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }

    private func targetStillMatches(_ context: CapturedContext, element: AXUIElement) -> Bool {
        guard let originalSelection = context.selectedText, !originalSelection.isEmpty else { return true }
        if let currentSelection = Self.nonEmptyText(copyAttribute(element, kAXSelectedTextAttribute) as? String),
           currentSelection == originalSelection {
            return true
        }
        if let range = context.selectedRange {
            let currentRangeText = string(in: range, on: element)
                ?? (copyAttribute(element, kAXValueAttribute) as? String).flatMap { substring($0, range: range) }
            if currentRangeText == originalSelection { return true }
        }
        guard let pid = context.sourcePID,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              focusedElementMatches(element, pid: pid),
              !isSecureTextField(element) else { return false }
        return Self.nonEmptyText(copyFocusedSelectionPreservingClipboard()) == originalSelection
    }

    private func paste(
        element: AXUIElement,
        insertionRange: CFRange?,
        collapseSelectionToEnd: Bool = false
    ) async -> WriteBackOutcome {
        let positionedByRange = insertionRange.map { setSelectedRange($0, on: element) } ?? false
        if collapseSelectionToEnd && !positionedByRange {
            guard postKey(virtualKey: 0x7C) else { return .copied }
            try? await Task.sleep(for: .milliseconds(40))
        }

        guard postCommandKey(virtualKey: 0x09) else {
            return .copied
        }
        return .pasted
    }

    private func activateAndFocus(context: CapturedContext, element: AXUIElement?) async {
        if let pid = context.sourcePID,
           let app = NSRunningApplication(processIdentifier: pid) {
            app.activate(options: [.activateAllWindows])
        }
        if let window = context.focusedWindow {
            AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
            AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        }
        if let element {
            AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        }
        try? await Task.sleep(for: .milliseconds(180))
    }

    private func focusedElementMatches(_ expected: AXUIElement, pid: pid_t) -> Bool {
        let application = AXUIElementCreateApplication(pid)
        guard let focused = copyAXElement(application, kAXFocusedUIElementAttribute) else { return false }
        return CFEqual(focused, expected)
    }

    private func copyFocusedSelectionPreservingClipboard() -> String? {
        waitForShortcutModifiersToRelease()
        let pasteboard = NSPasteboard.general
        let snapshot = pasteboard.pasteboardItems?.map(clonePasteboardItem) ?? []
        let previousChangeCount = pasteboard.changeCount
        guard postCommandKey(virtualKey: 0x08) else { return nil }

        let deadline = Date().addingTimeInterval(0.5)
        while pasteboard.changeCount == previousChangeCount && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        guard pasteboard.changeCount != previousChangeCount else { return nil }
        let copied = pasteboard.string(forType: .string)
        pasteboard.clearContents()
        if !snapshot.isEmpty { pasteboard.writeObjects(snapshot) }
        return copied?.isEmpty == false ? copied : nil
    }

    private func copyWholeDocumentPreservingClipboard(
        context: CapturedContext,
        documentRoot: AXUIElement?,
        maximumLength: Int
    ) -> String? {
        guard let pid = context.sourcePID,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return nil }

        let candidates = [context.focusedElement, documentRoot].compactMap { $0 }
        guard let restoration = candidates.lazy.compactMap({ element -> (AXUIElement, CFRange)? in
            guard !self.isSecureTextField(element),
                  let range = self.readSelectedRange(element),
                  range.length == 0,
                  self.isSettable(element, attribute: kAXSelectedTextRangeAttribute) else { return nil }
            return (element, range)
        }).first else { return nil }

        waitForShortcutModifiersToRelease()
        let pasteboard = NSPasteboard.general
        let snapshot = pasteboard.pasteboardItems?.map(clonePasteboardItem) ?? []
        defer {
            _ = setSelectedRange(restoration.1, on: restoration.0)
            if let focusedElement = context.focusedElement {
                AXUIElementSetAttributeValue(
                    focusedElement,
                    kAXFocusedAttribute as CFString,
                    kCFBooleanTrue
                )
            }
            pasteboard.clearContents()
            if !snapshot.isEmpty { pasteboard.writeObjects(snapshot) }
        }

        guard postCommandKey(virtualKey: 0x00) else { return nil }
        RunLoop.current.run(until: Date().addingTimeInterval(0.04))
        let previousChangeCount = pasteboard.changeCount
        guard postCommandKey(virtualKey: 0x08) else { return nil }

        let deadline = Date().addingTimeInterval(0.75)
        while pasteboard.changeCount == previousChangeCount && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        guard pasteboard.changeCount != previousChangeCount,
              let copied = pasteboard.string(forType: .string) else { return nil }
        return Self.normalizedDocumentText([copied], limit: maximumLength)
    }

    private func writeBackWithKeyboard(
        text: String,
        context: CapturedContext,
        requireUnchangedSelection: Bool
    ) async -> WriteBackOutcome {
        guard let pid = context.sourcePID,
              let app = NSRunningApplication(processIdentifier: pid) else {
            copyToClipboard(text)
            return .unavailable
        }
        _ = app
        await activateAndFocus(context: context, element: nil)
        if requireUnchangedSelection,
           copyFocusedSelectionPreservingClipboard() != context.selectedText {
            copyToClipboard(text)
            return .targetChanged
        }
        copyToClipboard(text)
        guard postCommandKey(virtualKey: 0x09) else { return .copied }
        return .pasted
    }

    private func waitForShortcutModifiersToRelease() {
        let shortcutModifiers: CGEventFlags = [.maskAlternate, .maskCommand, .maskControl, .maskShift]
        let deadline = Date().addingTimeInterval(0.35)
        while !CGEventSource.flagsState(.combinedSessionState).intersection(shortcutModifiers).isEmpty,
              Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
    }

    private func clonePasteboardItem(_ source: NSPasteboardItem) -> NSPasteboardItem {
        let copy = NSPasteboardItem()
        for type in source.types {
            if let data = source.data(forType: type) { copy.setData(data, forType: type) }
        }
        return copy
    }

    private func postCommandKey(virtualKey: CGKeyCode) -> Bool {
        postKey(virtualKey: virtualKey, flags: .maskCommand)
    }

    private func postKey(virtualKey: CGKeyCode, flags: CGEventFlags = []) -> Bool {
        guard let source = CGEventSource(stateID: .combinedSessionState),
              let keyDown = CGEvent(keyboardEventSource: source, virtualKey: virtualKey, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: virtualKey, keyDown: false) else { return false }
        keyDown.flags = flags
        keyUp.flags = flags
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
        return true
    }

    private func isSecureTextField(_ element: AXUIElement) -> Bool {
        (copyAttribute(element, kAXSubroleAttribute) as? String) == kAXSecureTextFieldSubrole
    }

    private func nearestDocumentRoot(from element: AXUIElement?) -> AXUIElement? {
        var current = element
        var visited = Set<CFHashCode>()
        for _ in 0..<40 {
            guard let candidate = current else { return nil }
            let identity = CFHash(candidate)
            guard visited.insert(identity).inserted else { return nil }
            if let role = role(of: candidate), Self.documentRoles.contains(role) {
                return candidate
            }
            current = copyAXElement(candidate, kAXParentAttribute)
        }
        return nil
    }

    private func findDocumentRoot(in root: AXUIElement) -> AXUIElement? {
        var stack = [root]
        var visited = Set<CFHashCode>()
        var inspected = 0
        while let element = stack.popLast(), inspected < 4_000 {
            inspected += 1
            let identity = CFHash(element)
            guard visited.insert(identity).inserted else { continue }
            if let role = role(of: element), Self.documentRoles.contains(role) {
                return element
            }
            stack.append(contentsOf: children(of: element).reversed())
        }
        return nil
    }

    private func readableTextChunks(from root: AXUIElement, characterBudget: Int) -> [String] {
        var stack = [root]
        var visited = Set<CFHashCode>()
        var chunks: [String] = []
        var collectedLength = 0
        var inspected = 0

        while let element = stack.popLast(),
              inspected < 12_000,
              collectedLength < characterBudget * 2 {
            inspected += 1
            let identity = CFHash(element)
            guard visited.insert(identity).inserted else { continue }

            let elementRole = role(of: element) ?? ""
            let isTerminal = Self.terminalTextRoles.contains(elementRole)
                || Self.textEntryRoles.contains(elementRole)
            let elementChildren = isTerminal ? [] : children(of: element)
            if let text = readableText(
                from: element,
                role: elementRole,
                hasChildren: !elementChildren.isEmpty,
                isRoot: CFEqual(element, root)
            ) {
                chunks.append(text)
                collectedLength += text.utf16.count
            }

            if !isTerminal {
                stack.append(contentsOf: elementChildren.reversed())
            }
        }
        return chunks
    }

    private func readableText(
        from element: AXUIElement,
        role: String,
        hasChildren: Bool,
        isRoot: Bool
    ) -> String? {
        if Self.terminalTextRoles.contains(role) || Self.textEntryRoles.contains(role) {
            return firstTextAttribute(
                of: element,
                attributes: [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute]
            )
        }
        if isRoot && Self.documentRoles.contains(role) {
            return firstTextAttribute(
                of: element,
                attributes: [kAXTitleAttribute, kAXDescriptionAttribute]
            )
        }
        if !hasChildren && Self.leafSemanticRoles.contains(role) {
            return firstTextAttribute(
                of: element,
                attributes: [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute]
            )
        }
        return nil
    }

    private func firstTextAttribute(of element: AXUIElement, attributes: [String]) -> String? {
        for attribute in attributes {
            guard let value = copyAttribute(element, attribute) else { continue }
            if let text = value as? String, !text.isEmpty { return text }
            if let attributed = value as? NSAttributedString, !attributed.string.isEmpty {
                return attributed.string
            }
        }
        return nil
    }

    private func children(of element: AXUIElement) -> [AXUIElement] {
        guard let value = copyAttribute(element, kAXChildrenAttribute) else { return [] }
        if let children = value as? [AXUIElement] { return children }
        if let children = value as? NSArray {
            return children.compactMap { child in
                let value = child as CFTypeRef
                guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
                return unsafeDowncast(value, to: AXUIElement.self)
            }
        }
        return []
    }

    private func role(of element: AXUIElement) -> String? {
        copyAttribute(element, kAXRoleAttribute) as? String
    }

    private static func utf16Length(of text: String?) -> Int {
        text?.utf16.count ?? 0
    }

    private static func truncateUTF16(_ text: String, to limit: Int) -> String {
        guard limit > 0 else { return "" }
        let value = text as NSString
        guard value.length > limit else { return text }
        let boundary = value.rangeOfComposedCharacterSequence(at: limit - 1)
        let end = NSMaxRange(boundary) > limit ? boundary.location : limit
        return value.substring(to: end)
    }

    private func copyAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return error == .success ? value : nil
    }

    private func copyAXElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        guard let value = copyAttribute(element, attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    private func isSettable(_ element: AXUIElement, attribute: String) -> Bool {
        var settable = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success && settable.boolValue
    }

    private func readSelectedRange(_ element: AXUIElement) -> CFRange? {
        guard let value = copyAttribute(element, kAXSelectedTextRangeAttribute) else { return nil }
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cfRange else { return nil }
        var range = CFRange()
        return AXValueGetValue(axValue, .cfRange, &range) ? range : nil
    }

    private func string(in range: CFRange, on element: AXUIElement) -> String? {
        var mutableRange = range
        guard let rangeValue = AXValueCreate(.cfRange, &mutableRange) else { return nil }
        var value: CFTypeRef?
        let error = AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXStringForRangeParameterizedAttribute as CFString,
            rangeValue,
            &value
        )
        guard error == .success else { return nil }
        return Self.nonEmptyText(value as? String)
    }

    @discardableResult
    private func setSelectedRange(_ range: CFRange, on element: AXUIElement) -> Bool {
        var mutableRange = range
        guard let value = AXValueCreate(.cfRange, &mutableRange) else { return false }
        return AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, value) == .success
    }

    private func substring(_ value: String, range: CFRange) -> String? {
        guard range.location >= 0, range.length >= 0 else { return nil }
        let nsValue = value as NSString
        guard NSMaxRange(NSRange(location: range.location, length: range.length)) <= nsValue.length else { return nil }
        return nsValue.substring(with: NSRange(location: range.location, length: range.length))
    }
}
