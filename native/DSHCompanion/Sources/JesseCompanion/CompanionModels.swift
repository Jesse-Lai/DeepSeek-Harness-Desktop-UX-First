import AppKit
import Foundation

enum CompanionSurface: String, CaseIterable, Equatable {
    case ring
    case result
    case ask
    case results
    case tasks

    var usesNativeWindowShadow: Bool {
        // The companion content is inset inside a transparent, borderless
        // NSPanel. AppKit shadows the panel's rectangular window bounds rather
        // than the rounded glass surface, which leaves a dark box around it.
        false
    }
}

enum CompanionFocusTarget: Hashable {
    case askEditor
    case resultEditor
}

struct CompanionFocusRequest: Equatable {
    let id = UUID()
    let target: CompanionFocusTarget
}

struct CompanionDisplayContext: Equatable {
    let sourceApp: String
    let sourceURL: String?
    let sourcePageTitle: String?
    let selectedText: String
    let canWriteBack: Bool
    let accessibilityGranted: Bool
    let screenRecordingGranted: Bool

    static let empty = CompanionDisplayContext(
        sourceApp: InterfaceLanguage.current.text("当前应用", "Current App"),
        sourceURL: nil,
        sourcePageTitle: nil,
        selectedText: "",
        canWriteBack: false,
        accessibilityGranted: false,
        screenRecordingGranted: false
    )

    init(context: CapturedContext) {
        self.sourceApp = context.sourceAppName
            ?? InterfaceLanguage.current.text("当前应用", "Current App")
        self.sourceURL = context.sourceURL
        self.sourcePageTitle = context.sourcePageTitle
        self.selectedText = context.selectedText ?? ""
        self.canWriteBack = context.canWriteBack
        self.accessibilityGranted = context.accessibilityGranted
        self.screenRecordingGranted = context.screenRecordingGranted
    }

    init(
        sourceApp: String,
        sourceURL: String? = nil,
        sourcePageTitle: String? = nil,
        selectedText: String,
        canWriteBack: Bool,
        accessibilityGranted: Bool,
        screenRecordingGranted: Bool
    ) {
        self.sourceApp = sourceApp
        self.sourceURL = sourceURL
        self.sourcePageTitle = sourcePageTitle
        self.selectedText = selectedText
        self.canWriteBack = canWriteBack
        self.accessibilityGranted = accessibilityGranted
        self.screenRecordingGranted = screenRecordingGranted
    }
}

struct CompanionAgentMessage: Identifiable, Equatable {
    let id = UUID()
    let role: String
    var text: String
    var imageDataURL: String?
    var imageDelivery: QuickTaskResult.Delivery?
    var runKey: String?

    init(
        role: String,
        text: String,
        imageDataURL: String? = nil,
        imageDelivery: QuickTaskResult.Delivery? = nil,
        runKey: String? = nil
    ) {
        self.role = role
        self.text = text
        self.imageDataURL = imageDataURL
        self.imageDelivery = imageDelivery
        self.runKey = runKey
    }
}

struct CompanionAgentRunState: Identifiable, Equatable {
    let id: String
    var runID: String?
    var status: AgentRunStatus
    var activity: String
    var pendingApproval: AgentApprovalRequest?
    var error: String?
    var assistantMessageID: UUID?

    var isActive: Bool { status.isActive }
}

struct CompanionAgentSession: Equatable {
    var sessionID: String?
    var runID: String?
    var executionRoot: String?
    var status: AgentRunStatus
    var messages: [CompanionAgentMessage]
    var activity: String
    var pendingApproval: AgentApprovalRequest?
    var error: String?
    var runs: [CompanionAgentRunState]

    static let empty = CompanionAgentSession(
        sessionID: nil,
        runID: nil,
        executionRoot: nil,
        status: .queued,
        messages: [],
        activity: "",
        pendingApproval: nil,
        error: nil,
        runs: []
    )
}

struct CompanionComposerAttachment: Equatable {
    let imageDataURL: String
    let sourceApp: String
}

enum CompanionCommand: Equatable {
    case selectAction(CompanionAction)
    case submitDoAnything(String)
    case returnToRing
    case showResult(String)
    case updateResult(id: String, text: String)
    case copyResult(id: String, text: String)
    case writeBack(id: String, text: String)
    case retryResult(id: String, text: String)
    case activateFocus(CompanionFocusTarget)
    case clearComposerAttachment
    case clearSourceContext
    case copyAgentImage(id: UUID, dataURL: String)
    case writeBackAgentImage(id: UUID, dataURL: String)
    case approveAgentRun(runID: String, id: String, choice: String)
    case cancelAgentRun(runID: String)
    case openAgentSession
    case requestAccessibility
    case refreshTasks
    case contentSizeChanged(surface: CompanionSurface, size: CGSize)
    case beginPanelDrag
    case dragPanel(CGSize)
    case endPanelDrag
    case openAgent
    case close
}

extension CompanionAction {
    var title: String {
        title(in: .current)
    }

    func title(in language: InterfaceLanguage) -> String {
        switch self {
        case .ask: language.text("做任何事", "Do Anything")
        case .polish: language.text("润色", "Polish")
        case .translate: language.text("翻译", "Translate")
        case .summarize: language.text("总结", "Summarize")
        case .screenshot: language.text("截图", "Screenshot")
        case .image: language.text("配图", "Image")
        case .results: language.text("最近结果", "Recent Results")
        case .tasks: language.text("任务进度", "Task Progress")
        }
    }

    var fluentIconName: String {
        switch self {
        case .ask: "ic_fluent_sparkle_24_regular"
        case .polish: "ic_fluent_text_grammar_wand_24_regular"
        case .translate: "ic_fluent_translate_24_regular"
        case .summarize: "ic_fluent_text_bullet_list_ltr_24_regular"
        case .screenshot: "ic_fluent_screenshot_24_regular"
        case .image: "ic_fluent_image_24_regular"
        case .results: "ic_fluent_history_24_regular"
        case .tasks: "ic_fluent_task_list_square_24_regular"
        }
    }

    var requiresSelection: Bool {
        switch self {
        case .polish, .translate, .image: true
        case .ask, .summarize, .screenshot, .results, .tasks: false
        }
    }

    var supportsWriteBack: Bool {
        switch self {
        case .polish, .image: true
        case .ask, .translate, .summarize, .screenshot, .results, .tasks: false
        }
    }

    var isVisibleInRing: Bool {
        switch self {
        case .results, .tasks: false
        default: true
        }
    }

    static func available(hasSelection: Bool) -> [CompanionAction] {
        allCases.filter {
            $0.isVisibleInRing && (!$0.requiresSelection || hasSelection)
        }
    }

    var processingDescription: String {
        processingDescription(in: .current)
    }

    func processingDescription(in language: InterfaceLanguage) -> String {
        switch self {
        case .polish:
            language.text("正在优化表达、语气和清晰度…", "Improving wording, tone, and clarity...")
        case .translate:
            language.text("正在翻译所选内容并保留原格式…", "Translating the selection and preserving its format...")
        case .summarize:
            language.text("正在提炼关键信息和行动项…", "Extracting key points and action items...")
        case .screenshot:
            language.text("正在分析截图中的关键信息…", "Analyzing key information in the screenshot...")
        case .image:
            language.text("正在根据所选内容生成配图…", "Creating an image from the selection...")
        case .ask:
            language.text("Agent 正在完成这件事…", "Agent is working on it...")
        case .results, .tasks:
            language.text("Jesse 正在处理你的内容…", "Jesse is processing your content...")
        }
    }

    func agentInstruction(in language: InterfaceLanguage) -> String? {
        switch self {
        case .image:
            language.text(
                "请根据附带的内容生成一张配图，以清晰简要的方式可视化内容表达",
                "Create an illustration based on the attached content that visualizes its meaning clearly and concisely."
            )
        case .ask, .polish, .translate, .summarize, .screenshot, .results, .tasks:
            nil
        }
    }
}

extension AgentRunStatus {
    func title(in language: InterfaceLanguage) -> String {
        switch self {
        case .queued: language.text("已排队", "Queued")
        case .running: language.text("执行中", "Running")
        case .waitingApproval: language.text("等待确认", "Waiting for Approval")
        case .completed: language.text("已完成", "Completed")
        case .failed: language.text("失败", "Failed")
        case .cancelled: language.text("已停止", "Stopped")
        }
    }
}

enum DataURLDecoder {
    static func decode(_ value: String) -> Data? {
        guard let comma = value.firstIndex(of: ","),
              value[..<comma].contains(";base64") else { return nil }
        return Data(
            base64Encoded: String(value[value.index(after: comma)...]),
            options: .ignoreUnknownCharacters
        )
    }

    static func image(_ value: String) -> NSImage? {
        decode(value).flatMap(NSImage.init(data:))
    }
}
