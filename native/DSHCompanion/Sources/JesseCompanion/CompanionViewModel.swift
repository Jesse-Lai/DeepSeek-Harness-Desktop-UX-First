import Combine
import Foundation

@MainActor
final class CompanionViewModel: ObservableObject {
    @Published private(set) var language: InterfaceLanguage
    @Published private(set) var surface: CompanionSurface = .ring
    @Published private(set) var context: CompanionDisplayContext = .empty
    @Published private(set) var results: [QuickTaskResult] = []
    @Published private(set) var selectedResultID: String?
    @Published private(set) var agentStatus: AgentStatus?
    @Published private(set) var composerAttachment: CompanionComposerAttachment?
    @Published private(set) var agentSession: CompanionAgentSession?
    @Published private(set) var isSourceContextAttached = true
    @Published private(set) var writableResultIDs: Set<String> = []
    @Published private(set) var focusRequest: CompanionFocusRequest?
    @Published private(set) var ringPresentationID: UInt = 0
    @Published private(set) var isRingEntranceRevealed = true
    @Published var askDraft = ""
    @Published var resultDraft = ""
    @Published var isEditingResult = false

    var commandHandler: ((CompanionCommand) -> Void)?

    init(language: InterfaceLanguage = .current) {
        self.language = language
    }

    var selectedResult: QuickTaskResult? {
        guard let selectedResultID else { return nil }
        return results.first { $0.id == selectedResultID }
    }

    var runningResults: [QuickTaskResult] {
        results.filter { $0.state == .running }
    }

    var hasSelection: Bool {
        !context.selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var availableActions: [CompanionAction] {
        CompanionAction.available(hasSelection: hasSelection)
    }

    func send(_ command: CompanionCommand) {
        commandHandler?(command)
    }

    func setLanguage(_ language: InterfaceLanguage) {
        guard self.language != language else { return }
        self.language = language
        if var session = agentSession {
            for index in session.runs.indices where session.runs[index].error == nil {
                session.runs[index].activity = activityText(for: session.runs[index].status)
            }
            if let latest = session.runs.last {
                syncLegacyFields(in: &session, from: latest)
            }
            agentSession = session
        }
    }

    func prepareForPresentation(context: CapturedContext, results: [QuickTaskResult]) {
        ringPresentationID &+= 1
        isRingEntranceRevealed = false
        self.context = CompanionDisplayContext(context: context)
        self.results = Self.normalized(results)
        selectedResultID = nil
        surface = .ring
        composerAttachment = nil
        agentSession = nil
        isSourceContextAttached = true
        askDraft = ""
        resultDraft = ""
        isEditingResult = false
    }

    func updateContext(_ context: CapturedContext) {
        self.context = CompanionDisplayContext(context: context)
    }

    func showSurface(_ surface: CompanionSurface) {
        self.surface = surface
        if surface != .result {
            selectedResultID = nil
            isEditingResult = false
        }
    }

    func showRing() {
        isRingEntranceRevealed = true
        surface = .ring
        selectedResultID = nil
        composerAttachment = nil
        agentSession = nil
        isSourceContextAttached = true
        askDraft = ""
        resultDraft = ""
        isEditingResult = false
    }

    func revealRing(for presentationID: UInt) {
        guard presentationID == ringPresentationID, surface == .ring else { return }
        isRingEntranceRevealed = true
    }

    func concealRing(for presentationID: UInt) {
        guard presentationID == ringPresentationID, surface == .ring else { return }
        isRingEntranceRevealed = false
    }

    func setComposerAttachment(_ attachment: CompanionComposerAttachment?) {
        composerAttachment = attachment
    }

    func clearSourceContext() {
        isSourceContextAttached = false
    }

    @discardableResult
    func beginAgentTurn(
        prompt: String,
        imageDataURL: String? = nil,
        startsNewSession: Bool = false
    ) -> String {
        var session = startsNewSession ? .empty : agentSession ?? .empty
        let runKey = UUID().uuidString
        let activity = language.text(
            "正在创建 DSH Session…",
            "Creating a DSH session..."
        )
        session.runID = nil
        session.status = .queued
        session.activity = activity
        session.pendingApproval = nil
        session.error = nil
        session.runs.append(CompanionAgentRunState(
            id: runKey,
            runID: nil,
            status: .queued,
            activity: activity,
            pendingApproval: nil,
            error: nil,
            assistantMessageID: nil
        ))
        session.messages.append(CompanionAgentMessage(
            role: "user",
            text: prompt,
            imageDataURL: imageDataURL,
            runKey: runKey
        ))
        agentSession = session
        return runKey
    }

    func attachAgentRun(_ run: AgentRunSnapshot, localRunID: String? = nil) {
        var session = agentSession ?? .empty
        session.sessionID = run.sessionId
        session.executionRoot = run.executionRoot
        let index = session.runs.firstIndex(where: { $0.runID == run.id })
            ?? localRunID.flatMap { id in session.runs.firstIndex(where: { $0.id == id }) }
            ?? session.runs.lastIndex(where: { $0.runID == nil })
        let state = CompanionAgentRunState(
            id: index.map { session.runs[$0].id } ?? localRunID ?? run.id,
            runID: run.id,
            status: run.status,
            activity: activityText(for: run.status),
            pendingApproval: index.map { session.runs[$0].pendingApproval } ?? nil,
            error: run.error,
            assistantMessageID: index.map { session.runs[$0].assistantMessageID } ?? nil
        )
        if let index { session.runs[index] = state }
        else { session.runs.append(state) }
        syncLegacyFields(in: &session, from: state)
        agentSession = session
    }

    func applyAgentRunEnvelope(_ envelope: AgentRunEnvelope) {
        attachAgentRun(envelope.run)
        guard let output = envelope.output else { return }
        var session = agentSession ?? .empty
        guard let runIndex = session.runs.firstIndex(where: { $0.runID == envelope.run.id }) else { return }
        var run = session.runs[runIndex]

        switch output.type {
        case "agent_event":
            if let event = output.event {
                apply(event: event, run: &run, session: &session)
            }
        case "approval_request":
            run.pendingApproval = output.request
            run.activity = language.text("等待你确认操作", "Waiting for your approval")
        case "approval_response":
            run.pendingApproval = nil
            run.activity = language.text("已收到确认，继续执行…", "Approved. Continuing...")
        case "error":
            let fallback = language.text("Agent 执行失败", "Agent run failed")
            run.error = output.error ?? fallback
            run.activity = run.error ?? fallback
        case "done":
            run.pendingApproval = nil
            run.activity = output.cancelled == true
                ? language.text("任务已停止", "Task stopped")
                : activityText(for: envelope.run.status)
        default:
            break
        }
        session.runs[runIndex] = run
        syncLegacyFields(in: &session, from: run)
        agentSession = session
    }

    func failAgentTurn(_ message: String, runKey: String? = nil) {
        var session = agentSession ?? .empty
        if let index = session.runs.lastIndex(where: {
            runKey == nil ? $0.status.isActive : ($0.id == runKey || $0.runID == runKey)
        }) {
            session.runs[index].status = .failed
            session.runs[index].error = message
            session.runs[index].activity = message
            let run = session.runs[index]
            syncLegacyFields(in: &session, from: run)
        } else {
            session.status = .failed
            session.error = message
            session.activity = message
        }
        agentSession = session
    }

    func setAgentImageDelivery(messageID: UUID, delivery: QuickTaskResult.Delivery) {
        guard var session = agentSession,
              let index = session.messages.firstIndex(where: { $0.id == messageID }) else { return }
        session.messages[index].imageDelivery = delivery
        agentSession = session
    }

    private func apply(
        event: AgentEventPayload,
        run: inout CompanionAgentRunState,
        session: inout CompanionAgentSession
    ) {
        switch event.type {
        case "assistant_delta":
            appendAssistant(event.text ?? "", run: &run, session: &session)
        case "assistant_text":
            setAssistant(event.text ?? "", run: &run, session: &session)
        case "assistant_attachment":
            if let dataURL = event.attachment?.dataURL {
                attachAssistantImage(dataURL, run: &run, session: &session)
            }
        case "turn_start":
            run.activity = language.text("Agent 正在思考…", "Agent is thinking...")
        case "tool_start":
            run.assistantMessageID = nil
            run.activity = event.name.map {
                language.text("正在执行 \($0)…", "Running \($0)...")
            } ?? language.text("正在执行工具…", "Running a tool...")
        case "tool_result":
            run.activity = event.ok == false
                ? language.text("工具执行失败，正在处理…", "The tool failed. Handling the issue...")
                : language.text("工具执行完成，继续处理…", "Tool finished. Continuing...")
        case "error":
            let fallback = language.text("Agent 执行失败", "Agent run failed")
            run.error = event.reason ?? fallback
            run.activity = run.error ?? fallback
        case "max_turns":
            run.activity = language.text("已达到本轮执行上限", "This run reached its turn limit")
        default:
            break
        }
    }

    private func appendAssistant(
        _ text: String,
        run: inout CompanionAgentRunState,
        session: inout CompanionAgentSession
    ) {
        guard !text.isEmpty else { return }
        if let index = assistantMessageIndex(for: run, in: session) {
            session.messages[index].text += text
        } else {
            let message = CompanionAgentMessage(role: "assistant", text: text, runKey: run.id)
            run.assistantMessageID = message.id
            session.messages.append(message)
        }
    }

    private func setAssistant(
        _ text: String,
        run: inout CompanionAgentRunState,
        session: inout CompanionAgentSession
    ) {
        guard !text.isEmpty else { return }
        if let index = assistantMessageIndex(for: run, in: session) {
            session.messages[index].text = text
        } else {
            let message = CompanionAgentMessage(role: "assistant", text: text, runKey: run.id)
            run.assistantMessageID = message.id
            session.messages.append(message)
        }
    }

    private func attachAssistantImage(
        _ dataURL: String,
        run: inout CompanionAgentRunState,
        session: inout CompanionAgentSession
    ) {
        guard !dataURL.isEmpty else { return }
        if let index = assistantMessageIndex(for: run, in: session) {
            if session.messages[index].imageDataURL == dataURL { return }
            if session.messages[index].imageDataURL == nil {
                session.messages[index].imageDataURL = dataURL
                session.messages[index].imageDelivery = .saved
                return
            }
        }
        let message = CompanionAgentMessage(
            role: "assistant",
            text: "",
            imageDataURL: dataURL,
            imageDelivery: .saved,
            runKey: run.id
        )
        run.assistantMessageID = message.id
        session.messages.append(message)
    }

    private func assistantMessageIndex(
        for run: CompanionAgentRunState,
        in session: CompanionAgentSession
    ) -> Int? {
        guard let messageID = run.assistantMessageID else { return nil }
        return session.messages.firstIndex(where: { $0.id == messageID })
    }

    private func syncLegacyFields(
        in session: inout CompanionAgentSession,
        from run: CompanionAgentRunState
    ) {
        session.runID = run.runID
        session.status = run.status
        session.activity = run.activity
        session.pendingApproval = run.pendingApproval
        session.error = run.error
    }

    private func activityText(for status: AgentRunStatus) -> String {
        switch status {
        case .queued: language.text("任务已排队", "Task queued")
        case .running: language.text("Agent 正在执行…", "Agent is running...")
        case .waitingApproval: language.text("等待你确认操作", "Waiting for your approval")
        case .completed: language.text("本轮已完成，可以继续优化", "Run complete. You can keep refining it")
        case .failed: language.text("本轮执行失败", "Run failed")
        case .cancelled: language.text("任务已停止", "Task stopped")
        }
    }

    func setWritableResultIDs(_ resultIDs: Set<String>) {
        writableResultIDs = resultIDs
    }

    func replaceResults(_ values: [QuickTaskResult]) {
        results = Self.normalized(values)
        if let selectedResultID, !results.contains(where: { $0.id == selectedResultID }) {
            self.selectedResultID = nil
        }
    }

    func mergeResult(_ result: QuickTaskResult, present: Bool = false) {
        results = Self.normalized([result] + results.filter { $0.id != result.id })
        if present {
            selectedResultID = result.id
            resultDraft = result.text
            isEditingResult = false
            surface = .result
        } else if selectedResultID == result.id, !isEditingResult {
            resultDraft = result.text
        }
    }

    func setAgentStatus(_ status: AgentStatus?) {
        agentStatus = status
    }

    func requestFocus(_ target: CompanionFocusTarget) {
        focusRequest = CompanionFocusRequest(target: target)
    }

    private static func normalized(_ values: [QuickTaskResult]) -> [QuickTaskResult] {
        var seen = Set<String>()
        return values
            .sorted { $0.createdAt > $1.createdAt }
            .filter { seen.insert($0.id).inserted }
            .prefix(30)
            .map { $0 }
    }
}
