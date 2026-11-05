import AppKit
import OSLog
import SwiftUI
import UniformTypeIdentifiers

final class CompanionPanel: NSPanel {
    var allowsKeyboardFocus = false
    var pasteboardProvider: () -> NSPasteboard = { .general }
    var imagePasteHandler: ((String) -> Bool)?

    override var canBecomeKey: Bool { allowsKeyboardFocus }
    override var canBecomeMain: Bool { false }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        // Accessory apps do not have a normal Edit menu, so AppKit has no
        // key-equivalent route for Command-V. Capture clipboard images as
        // composer attachments, then let the focused field editor handle text.
        if allowsKeyboardFocus, Self.isPasteShortcut(event) {
            if let imagePasteHandler {
                do {
                    if let dataURL = try CompanionClipboardImage.dataURL(from: pasteboardProvider()),
                       imagePasteHandler(dataURL) {
                        return true
                    }
                } catch {
                    NSSound.beep()
                    return true
                }
            }
            if firstResponder?.tryToPerform(#selector(NSText.paste(_:)), with: self) == true {
                return true
            }
        }
        return super.performKeyEquivalent(with: event)
    }

    private static func isPasteShortcut(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown,
              event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command else {
            return false
        }
        return event.charactersIgnoringModifiers?.lowercased() == "v"
    }
}

enum CompanionClipboardImage {
    static func dataURL(from pasteboard: NSPasteboard) throws -> String? {
        let fileURLs = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        )?.compactMap { ($0 as? NSURL).map { $0 as URL } } ?? []
        if let fileURL = fileURLs.first {
            let mimeType: String
            switch fileURL.pathExtension.lowercased() {
            case "png": mimeType = "image/png"
            case "jpg", "jpeg": mimeType = "image/jpeg"
            case "webp": mimeType = "image/webp"
            default: throw ImageAttachmentError.unsupported
            }
            return try validatedDataURL(
                data: Data(contentsOf: fileURL, options: .mappedIfSafe),
                mimeType: mimeType,
                name: fileURL.lastPathComponent
            )
        }

        let directTypes: [(NSPasteboard.PasteboardType, String, String)] = [
            (.init(UTType.png.identifier), "image/png", "Pasted Image.png"),
            (.init(UTType.jpeg.identifier), "image/jpeg", "Pasted Image.jpg"),
            (.init(UTType.webP.identifier), "image/webp", "Pasted Image.webp"),
        ]
        for (type, mimeType, name) in directTypes {
            guard let data = pasteboard.data(forType: type) else { continue }
            return try validatedDataURL(data: data, mimeType: mimeType, name: name)
        }

        if let tiff = pasteboard.data(forType: .tiff),
           let representation = NSBitmapImageRep(data: tiff),
           let png = representation.representation(using: .png, properties: [:]) {
            return try validatedDataURL(data: png, mimeType: "image/png", name: "Pasted Image.png")
        }
        return nil
    }

    private static func validatedDataURL(data: Data, mimeType: String, name: String) throws -> String {
        let attachments = try ImageAttachmentValidator.appending(
            data: data,
            mimeType: mimeType,
            name: name,
            to: []
        )
        return attachments[0].dataURL
    }
}

final class CompanionHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
final class RingWindowController: NSObject {
    private static let logger = Logger(subsystem: "com.jesselai.dsh.companion", category: "window")

    private let panel: CompanionPanel
    private let hostingView: CompanionHostingView<CompanionRootView>
    private let viewModel: CompanionViewModel
    private let accessibility: AccessibilityService
    private let agentClient: AgentClient
    private let resultStore: ResultStore
    private let openAgentHandler: ((String?) -> Void)?

    private var capturedContext: CapturedContext = .empty
    private var results: [String: QuickTaskResult] = [:]
    private var targetContexts: [String: CapturedContext] = [:]
    private var outsideClickMonitor: Any?
    private var permissionPollingTask: Task<Void, Never>?
    private var ringRevealTask: Task<Void, Never>?
    private var ringDismissTask: Task<Void, Never>?
    private var currentSurface: CompanionSurface = .ring {
        didSet {
            updateWindowShadow(for: currentSurface)
        }
    }
    private var presentationPoint = NSPoint.zero
    private var pendingScreenshotDataURL: String?
    private var panelDragStartFrame: NSRect?
    private var agentRunStreamTasks: [String: Task<Void, Never>] = [:]
    private var agentSessionBootstrap: (id: UUID, task: Task<DoAnythingStartResponse, Error>)?
    private var agentImageTargetContext: CapturedContext?

    var isVisible: Bool { panel.isVisible && ringDismissTask == nil }

    init(
        accessibility: AccessibilityService,
        agentClient: AgentClient,
        resultStore: ResultStore = ResultStore(),
        language: InterfaceLanguage = .current,
        openAgentHandler: ((String?) -> Void)? = nil
    ) {
        self.accessibility = accessibility
        self.agentClient = agentClient
        self.resultStore = resultStore
        self.openAgentHandler = openAgentHandler
        self.results = resultStore.load()

        let viewModel = CompanionViewModel(language: language)
        self.viewModel = viewModel
        self.hostingView = CompanionHostingView(rootView: CompanionRootView(model: viewModel))
        self.panel = CompanionPanel(
            contentRect: NSRect(origin: .zero, size: RingGeometry.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        super.init()

        viewModel.commandHandler = { [weak self] command in
            self?.handle(command)
        }
        panel.imagePasteHandler = { [weak self] dataURL in
            self?.attachPastedImage(dataURL) ?? false
        }

        hostingView.frame = NSRect(origin: .zero, size: RingGeometry.panelSize)
        hostingView.autoresizingMask = [.width, .height]
        hostingView.sizingOptions = []
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = NSColor.clear.cgColor

        let contentView = NSView(frame: NSRect(origin: .zero, size: RingGeometry.panelSize))
        contentView.wantsLayer = true
        contentView.layer?.backgroundColor = NSColor.clear.cgColor
        contentView.addSubview(hostingView)
        panel.contentView = contentView
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.acceptsMouseMovedEvents = true
        panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false

        syncViewModelResults()
    }

    func setLanguage(_ language: InterfaceLanguage) {
        viewModel.setLanguage(language)
    }

    func showRecentResults(near cursor: NSPoint) {
        show(context: .empty, near: cursor)
        showResults(surface: .results)
    }

    func show(context: CapturedContext, near cursor: NSPoint) {
        cancelPendingRingDismissal()
        cancelPendingRingReveal()
        // A hidden panel must not cancel the server-side Agent run. When a new
        // shortcut presentation begins, only detach the old local SSE observer
        // so its late events cannot overwrite the new draft/session UI.
        for task in agentRunStreamTasks.values { task.cancel() }
        agentRunStreamTasks.removeAll()
        agentSessionBootstrap?.task.cancel()
        agentSessionBootstrap = nil
        hostingView.alphaValue = 0
        pendingScreenshotDataURL = nil
        agentImageTargetContext = nil
        capturedContext = accessibility.refreshPermissionState(for: context, prompt: false)
        presentationPoint = cursor
        currentSurface = .ring
        panelDragStartFrame = nil
        panel.allowsKeyboardFocus = false
        viewModel.prepareForPresentation(context: capturedContext, results: Array(results.values))
        viewModel.setWritableResultIDs(Set(targetContexts.keys))
        let presentationID = viewModel.ringPresentationID

        let screen = RingGeometry.screen(containing: cursor)
        let visibleFrame = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let frame = RingGeometry.frame(
            near: cursor,
            visibleFrame: visibleFrame,
            panelSize: currentRingSpec.panelSize,
            originAdjustment: RingGeometry.ringPanelOriginAdjustment(for: currentRingSpec)
        )
        panel.setFrame(frame, display: true)
        hostingView.layoutSubtreeIfNeeded()
        hostingView.displayIfNeeded()
        panel.orderFrontRegardless()
        installOutsideClickMonitor()

        ringRevealTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(16))
            guard let self, !Task.isCancelled else { return }
            self.hostingView.alphaValue = 1
            self.viewModel.revealRing(for: presentationID)
        }

        if capturedContext.accessibilityGranted {
            stopPermissionPolling()
        } else {
            startPermissionPolling()
        }
        Self.logger.notice(
            "Panel shown at \(String(describing: frame), privacy: .public); visible=\(self.panel.isVisible); accessibility=\(self.capturedContext.accessibilityGranted)"
        )
    }

    func hide(animated: Bool = true) {
        cancelPendingRingReveal()
        stopPermissionPolling()
        panelDragStartFrame = nil
        panel.allowsKeyboardFocus = false
        removeOutsideClickMonitor()

        let shouldAnimate = animated
            && currentSurface == .ring
            && viewModel.isRingEntranceRevealed
            && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        guard shouldAnimate else {
            completeHide()
            return
        }

        cancelPendingRingDismissal()
        let presentationID = viewModel.ringPresentationID
        viewModel.concealRing(for: presentationID)
        ringDismissTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(RingAppearance.entranceDuration))
            guard let self, !Task.isCancelled else { return }
            guard self.currentSurface == .ring,
                  self.viewModel.ringPresentationID == presentationID,
                  !self.viewModel.isRingEntranceRevealed else { return }
            self.completeHide()
        }
    }

    private func handle(_ command: CompanionCommand) {
        switch command {
        case .selectAction(let action):
            Self.logger.notice("Ring action selected: \(action.rawValue, privacy: .public)")
            select(action)
        case .submitDoAnything(let instruction):
            let imageDataURL = pendingScreenshotDataURL
            guard !instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || imageDataURL != nil else { return }
            pendingScreenshotDataURL = nil
            viewModel.setComposerAttachment(nil)
            runDoAnything(instruction, imageDataURL: imageDataURL)
        case .returnToRing:
            returnToRing()
        case .showResult(let resultID):
            guard let result = results[resultID] else { return }
            present(result)
        case .updateResult(let resultID, let text):
            if let updated = updateResultText(text, resultID: resultID) {
                viewModel.mergeResult(updated)
            }
        case .copyResult(let resultID, let text):
            copyResult(resultID: resultID, editedText: text)
        case .writeBack(let resultID, let text):
            writeBackResult(resultID: resultID, editedText: text)
        case .retryResult(let resultID, let text):
            retryResult(resultID: resultID, editedText: text)
        case .activateFocus(let target):
            activateFocus(target)
        case .clearComposerAttachment:
            pendingScreenshotDataURL = nil
            viewModel.setComposerAttachment(nil)
        case .clearSourceContext:
            viewModel.clearSourceContext()
        case .copyAgentImage(let messageID, let dataURL):
            if accessibility.copyImageToClipboard(dataURL) {
                viewModel.setAgentImageDelivery(messageID: messageID, delivery: .copied)
            }
        case .writeBackAgentImage(let messageID, let dataURL):
            writeBackAgentImage(messageID: messageID, dataURL: dataURL)
        case .approveAgentRun(let runID, let id, let choice):
            Task {
                do {
                    try await agentClient.submitApproval(id: id, choice: choice, runID: runID)
                } catch {
                    viewModel.failAgentTurn(error.localizedDescription, runKey: runID)
                }
            }
        case .cancelAgentRun(let runID):
            Task {
                do {
                    try await agentClient.cancelAgentRun(runID: runID)
                } catch {
                    viewModel.failAgentTurn(error.localizedDescription, runKey: runID)
                }
            }
        case .openAgentSession:
            guard let sessionID = viewModel.agentSession?.sessionID else { return }
            if let openAgentHandler { openAgentHandler(sessionID) }
            else { NSWorkspace.shared.open(AgentServerManager.sessionURL(sessionID)) }
        case .requestAccessibility:
            capturedContext = accessibility.refreshPermissionState(for: capturedContext, prompt: true)
            viewModel.updateContext(capturedContext)
            if currentSurface == .ring { resizePanel(to: currentRingPanelSize, for: .ring) }
            if capturedContext.accessibilityGranted { stopPermissionPolling() }
            else { startPermissionPolling() }
        case .refreshTasks:
            refreshAgentStatus()
        case .contentSizeChanged(let surface, let size):
            resizePanel(to: NSSize(width: size.width, height: size.height), for: surface)
        case .beginPanelDrag:
            guard currentSurface != .ring else { return }
            panelDragStartFrame = panel.frame
        case .dragPanel(let translation):
            guard let start = panelDragStartFrame else { return }
            panel.setFrameOrigin(NSPoint(
                x: start.origin.x + translation.width,
                y: start.origin.y - translation.height
            ))
        case .endPanelDrag:
            panelDragStartFrame = nil
            presentationPoint = RingGeometry.anchorPoint(
                for: panel.frame,
                originAdjustment: RingGeometry.popoverPanelOriginAdjustment
            )
        case .openAgent:
            if let openAgentHandler { openAgentHandler(nil) }
            else { NSWorkspace.shared.open(AgentServerManager.baseURL) }
            hide()
        case .close:
            hide()
        }
    }

    private func runDoAnything(
        _ prompt: String,
        imageDataURL: String? = nil,
        startsNewSession: Bool = false
    ) {
        let existingSessionID = startsNewSession ? nil : viewModel.agentSession?.sessionID
        if existingSessionID == nil {
            agentImageTargetContext = capturedContext
        }
        let includeSource = viewModel.isSourceContextAttached
        let localRunID = viewModel.beginAgentTurn(
            prompt: prompt,
            imageDataURL: imageDataURL,
            startsNewSession: startsNewSession
        )
        let makeRequest: (String?) -> DoAnythingRequest = { sessionID in
            DoAnythingRequest(
                prompt: prompt,
                sessionId: sessionID,
                permissionMode: "default",
                context: DoAnythingSourceContext(
                    sourceApp: includeSource ? self.capturedContext.sourceAppName : nil,
                    sourceBundleIdentifier: includeSource ? self.capturedContext.sourceBundleIdentifier : nil,
                    sourceURL: includeSource ? self.capturedContext.sourceURL : nil,
                    sourceTitle: includeSource ? self.capturedContext.sourcePageTitle : nil,
                    selectedText: includeSource ? self.capturedContext.selectedText : nil
                ),
                attachments: imageDataURL.map { [DoAnythingImageAttachment(dataURL: $0)] }
            )
        }

        let startTask: Task<DoAnythingStartResponse, Error>
        let bootstrapID: UUID?
        if let existingSessionID {
            startTask = Task { try await agentClient.startDoAnything(makeRequest(existingSessionID)) }
            bootstrapID = nil
        } else if let bootstrap = agentSessionBootstrap {
            startTask = Task {
                let first = try await bootstrap.task.value
                return try await self.agentClient.startDoAnything(makeRequest(first.sessionId))
            }
            bootstrapID = nil
        } else {
            let id = UUID()
            let task = Task { try await agentClient.startDoAnything(makeRequest(nil)) }
            agentSessionBootstrap = (id, task)
            startTask = task
            bootstrapID = id
        }

        let streamTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.agentRunStreamTasks[localRunID] = nil }
            do {
                let response = try await startTask.value
                guard !Task.isCancelled,
                      self.viewModel.agentSession?.runs.contains(where: { $0.id == localRunID }) == true else { return }
                if let bootstrapID, self.agentSessionBootstrap?.id == bootstrapID {
                    self.agentSessionBootstrap = nil
                }
                self.viewModel.attachAgentRun(response.run, localRunID: localRunID)
                for try await envelope in self.agentClient.streamAgentRun(
                    runID: response.runId,
                    after: max(0, response.cursor - 1)
                ) {
                    guard self.viewModel.agentSession?.runs.contains(where: { $0.runID == response.runId }) == true else { continue }
                    self.viewModel.applyAgentRunEnvelope(envelope)
                }
            } catch is CancellationError {
                return
            } catch {
                self.viewModel.askDraft = prompt
                self.viewModel.failAgentTurn(error.localizedDescription, runKey: localRunID)
                if let bootstrapID, self.agentSessionBootstrap?.id == bootstrapID {
                    self.agentSessionBootstrap = nil
                }
            }
        }
        agentRunStreamTasks[localRunID] = streamTask
    }

    private func select(_ action: CompanionAction) {
        if action.requiresSelection,
           capturedContext.selectedText?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            NSSound.beep()
            return
        }

        switch action {
        case .ask:
            pendingScreenshotDataURL = nil
            viewModel.setComposerAttachment(nil)
            transition(to: .ask)
            activateFocus(.askEditor)
        case .results:
            showResults(surface: .results)
        case .tasks:
            showResults(surface: .tasks)
            refreshAgentStatus()
        case .screenshot:
            Task { await captureScreenshotForQuestion() }
        case .summarize:
            Task { await summarizeCurrentContent() }
        case .image:
            guard let instruction = action.agentInstruction(in: viewModel.language) else { return }
            transition(to: .ask)
            activateFocus(.askEditor)
            runDoAnything(instruction, startsNewSession: true)
        case .polish, .translate:
            runQuickTask(action: action, instruction: nil, imageDataURL: nil)
        }
    }

    private func attachPastedImage(_ dataURL: String) -> Bool {
        guard currentSurface == .ask else { return false }
        pendingScreenshotDataURL = dataURL
        viewModel.setComposerAttachment(CompanionComposerAttachment(
            imageDataURL: dataURL,
            sourceApp: viewModel.language.text("剪贴板", "Clipboard")
        ))
        activateFocus(.askEditor)
        return true
    }

    private func summarizeCurrentContent() async {
        let selectedText = capturedContext.selectedText?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let selectedText, !selectedText.isEmpty {
            runQuickTask(
                action: .summarize,
                instruction: nil,
                imageDataURL: nil,
                selectedTextOverride: selectedText
            )
            return
        }

        if let documentText = accessibility.documentText(for: capturedContext)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !documentText.isEmpty {
            runQuickTask(
                action: .summarize,
                instruction: nil,
                imageDataURL: nil,
                selectedTextOverride: documentText
            )
            return
        }

        if let sourceURL = capturedContext.sourceURL,
           let scheme = URL(string: sourceURL)?.scheme?.lowercased(),
           scheme == "http" || scheme == "https" {
            Self.logger.notice(
                "Page text unavailable; starting URL-backed Agent summary for \(sourceURL, privacy: .private(mask: .hash))"
            )
            transition(to: .ask)
            runDoAnything(viewModel.language.text(
                "请打开并读取附带的当前页面链接，基于页面的实际内容生成一份简洁摘要，保留关键事实、核心结论和行动项。不要只根据页面标题或 URL 猜测；若页面无法访问，请明确说明原因。",
                "Open and read the attached current-page link, then summarize its actual content concisely, preserving key facts, conclusions, and action items. Do not guess from only the title or URL; if the page cannot be accessed, explain why."
            ))
            return
        }

        let sourceContext = capturedContext
        guard let processID = sourceContext.sourcePID else {
            presentQuickTaskFailure(
                action: .summarize,
                message: viewModel.language.text(
                    "无法识别当前应用窗口，请先选中要总结的文字。",
                    "The current app window could not be identified. Select the text you want to summarize."
                )
            )
            return
        }

        hide(animated: false)
        do {
            let imageDataURL = try await ScreenshotCoordinator.captureApplicationWindow(processID: processID)
            show(context: sourceContext, near: presentationPoint)
            runQuickTask(
                action: .summarize,
                instruction: nil,
                imageDataURL: imageDataURL,
                selectedTextOverride: "",
                targetContext: sourceContext
            )
        } catch {
            show(context: sourceContext, near: presentationPoint)
            presentQuickTaskFailure(
                action: .summarize,
                message: viewModel.language.text(
                    "无法读取当前页面，也无法截取窗口：\(error.localizedDescription)",
                    "The current page could not be read or captured: \(error.localizedDescription)"
                )
            )
        }
    }

    private func presentQuickTaskFailure(action: CompanionAction, message: String) {
        let result = QuickTaskResult(
            id: UUID().uuidString,
            action: action,
            title: action.title(in: viewModel.language),
            text: message,
            state: .failed,
            sourceApp: capturedContext.sourceAppName,
            createdAt: Date(),
            imageDataURL: nil,
            delivery: .saved
        )
        results[result.id] = result
        trimResults()
        persistResults()
        present(result)
    }

    private func transition(to surface: CompanionSurface) {
        if surface != .ring {
            cancelPendingRingReveal()
        }
        currentSurface = surface
        viewModel.showSurface(surface)
        if surface == .ring {
            resizePanel(to: currentRingPanelSize, for: surface)
        } else if surface == .ask || surface == .results || surface == .tasks {
            resizePanel(to: RingGeometry.panelSize, for: surface)
        }
        if surface != .ask && surface != .result {
            panel.allowsKeyboardFocus = false
        }
    }

    private func returnToRing() {
        cancelPendingRingReveal()
        pendingScreenshotDataURL = nil
        panel.allowsKeyboardFocus = false
        panel.resignKey()
        restoreSourceApplicationActivation()

        // Liquid Glass resolves its backdrop from the window geometry and
        // activation state that are current when the glass view enters the
        // hierarchy. Prepare the final nonactivating ring window while the host
        // is hidden, then reveal the newly laid-out glass on the next display
        // cycle so it cannot inherit the popover's capture surface.
        hostingView.alphaValue = 0
        currentSurface = .ring
        resizePanel(to: currentRingPanelSize, for: .ring)
        viewModel.showRing()
        hostingView.layoutSubtreeIfNeeded()
        hostingView.displayIfNeeded()

        let presentationID = viewModel.ringPresentationID
        ringRevealTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(16))
            guard let self, !Task.isCancelled else { return }
            guard self.currentSurface == .ring,
                  self.viewModel.ringPresentationID == presentationID else { return }
            self.hostingView.alphaValue = 1
            self.ringRevealTask = nil
        }
    }

    private func restoreSourceApplicationActivation() {
        let companionProcessID = ProcessInfo.processInfo.processIdentifier
        if let sourceProcessID = capturedContext.sourcePID,
           sourceProcessID != companionProcessID,
           let sourceApplication = NSRunningApplication(processIdentifier: sourceProcessID) {
            sourceApplication.activate()
        } else {
            NSApp.deactivate()
        }
        // The panel uses a nonactivating style and stays above the restored
        // source app without taking keyboard focus back from it.
        panel.orderFrontRegardless()
    }

    private func runQuickTask(
        action: CompanionAction,
        instruction: String?,
        imageDataURL: String?,
        selectedTextOverride: String? = nil,
        sourceAppOverride: String? = nil,
        targetContext: CapturedContext? = nil,
        captureCurrentTarget: Bool = true
    ) {
        let id = UUID().uuidString
        let resolvedTarget = targetContext ?? (captureCurrentTarget ? capturedContext : nil)
        let sourceApp = sourceAppOverride ?? resolvedTarget?.sourceAppName ?? capturedContext.sourceAppName
        var result = QuickTaskResult(
            id: id,
            action: action,
            title: action.title(in: viewModel.language),
            text: "",
            state: .running,
            sourceApp: sourceApp,
            createdAt: Date(),
            imageDataURL: nil,
            delivery: .pending
        )
        results[id] = result
        if action.supportsWriteBack, let resolvedTarget {
            targetContexts[id] = resolvedTarget
        }
        trimResults()
        persistResults()
        viewModel.setWritableResultIDs(Set(targetContexts.keys))
        present(result)

        let request = QuickTaskRequest(
            action: action,
            instruction: instruction,
            selectedText: selectedTextOverride ?? resolvedTarget?.selectedText ?? capturedContext.selectedText,
            sourceApp: sourceApp,
            imageDataURL: imageDataURL
        )
        Task {
            do {
                for try await event in agentClient.streamQuickTask(request) {
                    switch event {
                    case .delta(let text):
                        result.text += text
                    case .completed(let text, let imageDataURL):
                        if !text.isEmpty { result.text = text }
                        result.imageDataURL = imageDataURL
                        result.state = .completed
                    case .failed(let message):
                        result.text = message
                        result.state = .failed
                    }
                    results[id] = result
                    updateVisibleResult(result)
                }
                if result.state == .completed {
                    result.delivery = .saved
                    results[id] = result
                }
                persistResults()
                updateVisibleResult(result)
            } catch {
                result.text = error.localizedDescription
                result.state = .failed
                results[id] = result
                persistResults()
                updateVisibleResult(result)
            }
        }
    }

    private func captureScreenshotForQuestion() async {
        let sourceContext = capturedContext
        hide(animated: false)
        do {
            let imageDataURL = try await ScreenshotCoordinator.captureInteractiveRegion()
            show(context: sourceContext, near: NSEvent.mouseLocation)
            pendingScreenshotDataURL = imageDataURL
            viewModel.setComposerAttachment(CompanionComposerAttachment(
                imageDataURL: imageDataURL,
                sourceApp: sourceContext.sourceAppName
                    ?? viewModel.language.text("当前应用", "Current App")
            ))
            transition(to: .ask)
            activateFocus(.askEditor)
        } catch ScreenshotCoordinator.CaptureError.cancelled {
            return
        } catch {
            show(context: sourceContext, near: NSEvent.mouseLocation)
            let result = QuickTaskResult(
                id: UUID().uuidString,
                action: .screenshot,
                title: CompanionAction.screenshot.title(in: viewModel.language),
                text: error.localizedDescription,
                state: .failed,
                sourceApp: capturedContext.sourceAppName,
                createdAt: Date(),
                imageDataURL: nil,
                delivery: .saved
            )
            results[result.id] = result
            persistResults()
            present(result)
        }
    }

    private func startPermissionPolling() {
        permissionPollingTask?.cancel()
        permissionPollingTask = Task { @MainActor [weak self] in
            for _ in 0..<40 {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled, let self else { return }
                let refreshed = self.accessibility.refreshPermissionState(
                    for: self.capturedContext,
                    prompt: false
                )
                guard refreshed.accessibilityGranted != self.capturedContext.accessibilityGranted else {
                    continue
                }
                self.capturedContext = refreshed
                self.viewModel.updateContext(refreshed)
                if self.currentSurface == .ring {
                    self.resizePanel(to: self.currentRingPanelSize, for: .ring)
                }
                Self.logger.notice("Accessibility permission changed: \(refreshed.accessibilityGranted)")
                if refreshed.accessibilityGranted {
                    self.permissionPollingTask = nil
                    return
                }
            }
            self?.permissionPollingTask = nil
        }
    }

    private func stopPermissionPolling() {
        permissionPollingTask?.cancel()
        permissionPollingTask = nil
    }

    private func present(_ result: QuickTaskResult) {
        currentSurface = .result
        panel.allowsKeyboardFocus = false
        resizePanel(
            to: NSSize(width: RingGeometry.panelSize.width, height: RingGeometry.compactResultHeight),
            for: .result
        )
        viewModel.mergeResult(result, present: true)
        Self.logger.notice(
            "Result presented; action=\(result.action.rawValue, privacy: .public); visible=\(self.panel.isVisible); frame=\(String(describing: self.panel.frame), privacy: .public)"
        )
    }

    private func updateVisibleResult(_ result: QuickTaskResult) {
        viewModel.mergeResult(result)
    }

    private func showResults(surface: CompanionSurface) {
        guard surface == .results || surface == .tasks else { return }
        syncViewModelResults()
        transition(to: surface)
    }

    private func refreshAgentStatus() {
        guard currentSurface == .tasks else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                let status = try await self.agentClient.fetchAgentStatus()
                guard self.currentSurface == .tasks else { return }
                self.viewModel.setAgentStatus(status)
            } catch {
                Self.logger.error("Could not refresh Agent status: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func copyResult(resultID: String, editedText: String) {
        guard var result = results[resultID] else { return }
        if result.imageDataURL == nil,
           let updated = updateResultText(editedText, resultID: resultID) {
            result = updated
        }
        if let image = result.imageDataURL {
            accessibility.copyImageToClipboard(image)
        } else {
            accessibility.copyToClipboard(result.text)
        }
        updateDelivery(.copied, resultID: resultID)
    }

    private func writeBackResult(resultID: String, editedText: String) {
        guard var result = results[resultID], result.action.supportsWriteBack else { return }
        if result.imageDataURL == nil,
           let updated = updateResultText(editedText, resultID: resultID) {
            result = updated
        }
        Self.logger.notice("Writeback requested for result \(resultID, privacy: .public)")
        Task { await writeBack(result, explicit: true) }
    }

    private func writeBackAgentImage(messageID: UUID, dataURL: String) {
        guard let target = agentImageTargetContext else {
            if accessibility.copyImageToClipboard(dataURL) {
                viewModel.setAgentImageDelivery(messageID: messageID, delivery: .fallbackCopied)
            }
            return
        }

        hide()
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .milliseconds(100))
            let outcome = await self.accessibility.writeBackImage(
                dataURL,
                to: target,
                requireUnchangedSelection: true
            )
            let inserted = outcome == .replaced || outcome == .pasted
            self.viewModel.setAgentImageDelivery(
                messageID: messageID,
                delivery: inserted ? .inserted : .fallbackCopied
            )
            if !inserted { self.presentWriteBackFailure() }
        }
    }

    private func writeBack(_ result: QuickTaskResult, explicit: Bool) async {
        guard result.state == .completed, result.action.supportsWriteBack else { return }
        if explicit {
            hide()
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard let target = targetContexts[result.id] else {
            if let image = result.imageDataURL {
                accessibility.copyImageToClipboard(image)
            } else {
                accessibility.copyToClipboard(result.text)
            }
            updateDelivery(.fallbackCopied, resultID: result.id)
            if explicit { presentWriteBackFailure() }
            return
        }

        let outcome: WriteBackOutcome
        if let image = result.imageDataURL {
            outcome = await accessibility.writeBackImage(image, to: target, requireUnchangedSelection: true)
        } else {
            outcome = await accessibility.writeBack(result.text, to: target, requireUnchangedSelection: true)
        }
        let inserted = outcome == .replaced || outcome == .pasted
        Self.logger.notice(
            "Explicit writeback finished; action=\(result.action.rawValue, privacy: .public); app=\(target.sourceAppName ?? "unknown", privacy: .public); outcome=\(String(describing: outcome), privacy: .public)"
        )
        updateDelivery(inserted ? .inserted : .fallbackCopied, resultID: result.id)
        if explicit && !inserted { presentWriteBackFailure() }
    }

    private func presentWriteBackFailure() {
        cancelPendingRingReveal()
        panel.allowsKeyboardFocus = false
        panel.orderFrontRegardless()
        installOutsideClickMonitor()
    }

    private func retryResult(resultID: String, editedText: String) {
        let text = editedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty,
              var result = results[resultID],
              result.state == .completed,
              result.imageDataURL == nil else { return }
        if let updated = updateResultText(editedText, resultID: resultID) {
            result = updated
        }
        runQuickTask(
            action: result.action,
            instruction: nil,
            imageDataURL: nil,
            selectedTextOverride: editedText,
            sourceAppOverride: result.sourceApp,
            targetContext: targetContexts[resultID],
            captureCurrentTarget: false
        )
    }

    @discardableResult
    private func updateResultText(_ text: String, resultID: String) -> QuickTaskResult? {
        guard text.utf8.count <= 200_000,
              var result = results[resultID],
              result.state == .completed,
              result.imageDataURL == nil else { return nil }
        guard result.text != text else { return result }
        result.text = text
        result.delivery = .saved
        results[resultID] = result
        persistResults()
        return result
    }

    private func updateDelivery(_ delivery: QuickTaskResult.Delivery, resultID: String) {
        guard var result = results[resultID] else { return }
        result.delivery = delivery
        results[resultID] = result
        persistResults()
        updateVisibleResult(result)
    }

    private func activateFocus(_ target: CompanionFocusTarget) {
        switch target {
        case .askEditor where currentSurface != .ask:
            return
        case .resultEditor where currentSurface != .result:
            return
        default:
            break
        }
        panel.allowsKeyboardFocus = true
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(hostingView)
        viewModel.requestFocus(target)
    }

    private func cancelPendingRingReveal() {
        ringRevealTask?.cancel()
        ringRevealTask = nil
        hostingView.alphaValue = 1
    }

    private func cancelPendingRingDismissal() {
        ringDismissTask?.cancel()
        ringDismissTask = nil
    }

    private func completeHide() {
        cancelPendingRingDismissal()
        panel.orderOut(nil)
        Self.logger.notice("Panel hidden")
    }

    private func removeOutsideClickMonitor() {
        guard let outsideClickMonitor else { return }
        NSEvent.removeMonitor(outsideClickMonitor)
        self.outsideClickMonitor = nil
    }

    private func resizePanel(to requestedSize: NSSize, for surface: CompanionSurface) {
        guard currentSurface == surface else { return }
        let screen = RingGeometry.screen(containing: presentationPoint)
        let visibleFrame = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let size: NSSize
        switch surface {
        case .ring:
            size = requestedSize
        case .result:
            size = RingGeometry.resultPanelSize(requested: requestedSize, visibleFrame: visibleFrame)
        case .ask, .results, .tasks:
            size = RingGeometry.panelSize
        }
        let frame = RingGeometry.frame(
            near: presentationPoint,
            visibleFrame: visibleFrame,
            panelSize: size,
            originAdjustment: surface == .ring
                ? RingGeometry.ringPanelOriginAdjustment(for: currentRingSpec)
                : RingGeometry.popoverPanelOriginAdjustment
        )
        if abs(panel.frame.width - frame.width) < 0.5,
           abs(panel.frame.height - frame.height) < 0.5,
           abs(panel.frame.minX - frame.minX) < 0.5,
           abs(panel.frame.minY - frame.minY) < 0.5 {
            refreshWindowShadow()
            return
        }
        panel.setFrame(frame, display: true)
        hostingView.needsLayout = true
        refreshWindowShadow()
    }

    private var currentRingPanelSize: NSSize {
        currentRingSpec.panelSize
    }

    private var currentRingSpec: RingGeometry.Spec {
        RingGeometry.ringSpec(for: viewModel.availableActions.count)
    }

    private func updateWindowShadow(for surface: CompanionSurface) {
        panel.hasShadow = surface.usesNativeWindowShadow
        refreshWindowShadow()
    }

    private func refreshWindowShadow() {
        guard panel.hasShadow else { return }
        panel.invalidateShadow()
        DispatchQueue.main.async { [weak self] in
            guard let self, self.currentSurface.usesNativeWindowShadow else { return }
            self.panel.invalidateShadow()
        }
    }

    private func persistResults() {
        resultStore.save(Array(results.values))
    }

    private func trimResults() {
        let removed = results.values.sorted { $0.createdAt > $1.createdAt }.dropFirst(30)
        for result in removed {
            results.removeValue(forKey: result.id)
            targetContexts.removeValue(forKey: result.id)
        }
    }

    private func syncViewModelResults() {
        viewModel.replaceResults(Array(results.values))
        viewModel.setWritableResultIDs(Set(targetContexts.keys))
    }

    private func installOutsideClickMonitor() {
        if let outsideClickMonitor {
            NSEvent.removeMonitor(outsideClickMonitor)
        }
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            let location = NSEvent.mouseLocation
            Task { @MainActor in
                guard let self, self.panel.isVisible else { return }
                guard !self.panel.frame.contains(location) else {
                    Self.logger.debug("Ignored click inside panel at \(String(describing: location), privacy: .public)")
                    return
                }
                Self.logger.debug("Outside click at \(String(describing: location), privacy: .public)")
                self.hide()
            }
        }
    }
}
