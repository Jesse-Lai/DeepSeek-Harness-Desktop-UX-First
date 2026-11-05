import AppKit
import ApplicationServices
import Foundation

enum CompanionAction: String, Codable, CaseIterable {
    case ask
    case polish
    case translate
    case summarize
    case screenshot
    case image
    case results
    case tasks
}

struct CapturedContext {
    let sourcePID: pid_t?
    let sourceBundleIdentifier: String?
    let sourceAppName: String?
    let sourceURL: String?
    let sourcePageTitle: String?
    let focusedWindow: AXUIElement?
    let focusedElement: AXUIElement?
    let selectedText: String?
    let selectedRange: CFRange?
    let originalValue: String?
    let canWriteBack: Bool
    let accessibilityGranted: Bool
    let screenRecordingGranted: Bool

    static let empty = CapturedContext(
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
        accessibilityGranted: false,
        screenRecordingGranted: false
    )

    func withPermissionState(accessibilityGranted: Bool, screenRecordingGranted: Bool) -> CapturedContext {
        CapturedContext(
            sourcePID: sourcePID,
            sourceBundleIdentifier: sourceBundleIdentifier,
            sourceAppName: sourceAppName,
            sourceURL: sourceURL,
            sourcePageTitle: sourcePageTitle,
            focusedWindow: focusedWindow,
            focusedElement: focusedElement,
            selectedText: selectedText,
            selectedRange: selectedRange,
            originalValue: originalValue,
            canWriteBack: canWriteBack,
            accessibilityGranted: accessibilityGranted,
            screenRecordingGranted: screenRecordingGranted
        )
    }

}

struct QuickTaskRequest: Encodable {
    let action: CompanionAction
    let instruction: String?
    let selectedText: String?
    let sourceApp: String?
    let imageDataURL: String?
}

struct DoAnythingSourceContext: Encodable, Equatable {
    let sourceApp: String?
    let sourceBundleIdentifier: String?
    let sourceURL: String?
    let sourceTitle: String?
    let selectedText: String?
}

struct DoAnythingImageAttachment: Encodable, Equatable {
    let type = "image"
    let mimeType: String
    let dataURL: String
    let name: String
    let source = "user"

    init(dataURL: String, name requestedName: String? = nil) {
        self.dataURL = dataURL
        if dataURL.hasPrefix("data:image/jpeg;") {
            mimeType = "image/jpeg"
            name = requestedName ?? "Image.jpg"
        } else if dataURL.hasPrefix("data:image/webp;") {
            mimeType = "image/webp"
            name = requestedName ?? "Image.webp"
        } else {
            mimeType = "image/png"
            name = requestedName ?? "Image.png"
        }
    }
}

struct DoAnythingRequest: Encodable {
    let requestId = UUID().uuidString
    let prompt: String
    let sessionId: String?
    let permissionMode: String
    let context: DoAnythingSourceContext
    let attachments: [DoAnythingImageAttachment]?

    init(
        prompt: String,
        sessionId: String?,
        permissionMode: String,
        context: DoAnythingSourceContext,
        attachments: [DoAnythingImageAttachment]? = nil
    ) {
        self.prompt = prompt
        self.sessionId = sessionId
        self.permissionMode = permissionMode
        self.context = context
        self.attachments = attachments
    }
}

enum AgentRunStatus: String, Codable, Equatable {
    case queued
    case running
    case waitingApproval = "waiting_approval"
    case completed
    case failed
    case cancelled

    var isActive: Bool {
        self == .queued || self == .running || self == .waitingApproval
    }
}

struct AgentRunSource: Codable, Equatable {
    let app: String?
    let bundleIdentifier: String?
    let url: String?
    let title: String?
}

struct AgentRunSnapshot: Codable, Equatable, Identifiable {
    let id: String
    let sessionId: String
    let workspaceRoot: String
    let executionRoot: String
    let status: AgentRunStatus
    let source: AgentRunSource?
    let workspace: DesktopWorkspaceMetadata?
    let createdAt: String
    let updatedAt: String
    let finishedAt: String?
    let error: String?

    init(
        id: String,
        sessionId: String,
        workspaceRoot: String,
        executionRoot: String,
        status: AgentRunStatus,
        source: AgentRunSource?,
        workspace: DesktopWorkspaceMetadata? = nil,
        createdAt: String,
        updatedAt: String,
        finishedAt: String?,
        error: String?
    ) {
        self.id = id
        self.sessionId = sessionId
        self.workspaceRoot = workspaceRoot
        self.executionRoot = executionRoot
        self.status = status
        self.source = source
        self.workspace = workspace
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.finishedAt = finishedAt
        self.error = error
    }
}

struct DoAnythingStartResponse: Decodable {
    let run: AgentRunSnapshot
    let sessionId: String
    let runId: String
    let cursor: Int
}

struct AgentRunEnvelope: Decodable {
    let cursor: Int
    let run: AgentRunSnapshot
    let output: AgentRunOutput?
}

struct AgentRunOutput: Decodable {
    let type: String
    let event: AgentEventPayload?
    let request: AgentApprovalRequest?
    let id: String?
    let choice: String?
    let error: String?
    let cancelled: Bool?
}

struct AgentEventPayload: Decodable {
    let type: String
    let text: String?
    let name: String?
    let ok: Bool?
    let content: String?
    let reason: String?
    let attachment: AgentImageAttachment?

    init(
        type: String,
        text: String? = nil,
        name: String? = nil,
        ok: Bool? = nil,
        content: String? = nil,
        reason: String? = nil,
        attachment: AgentImageAttachment? = nil
    ) {
        self.type = type
        self.text = text
        self.name = name
        self.ok = ok
        self.content = content
        self.reason = reason
        self.attachment = attachment
    }
}

struct AgentImageAttachment: Decodable, Equatable {
    let type: String
    let mimeType: String
    let dataURL: String?
    let assetId: String?
    let url: String?
    let name: String?
    let source: String?

    init(
        type: String = "image",
        mimeType: String,
        dataURL: String? = nil,
        assetId: String? = nil,
        url: String? = nil,
        name: String? = nil,
        source: String? = nil
    ) {
        self.type = type
        self.mimeType = mimeType
        self.dataURL = dataURL
        self.assetId = assetId
        self.url = url
        self.name = name
        self.source = source
    }
}

struct AgentApprovalRequest: Decodable, Equatable {
    let id: String
    let toolName: String
    let title: String
    let detail: String
    let args: [String: AnyCodable]?
    let files: [String]?
    let diff: String?
    let previewError: String?
}

struct AnyCodable: Decodable, Equatable {
    let value: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) { value = string }
        else if let bool = try? container.decode(Bool.self) { value = String(bool) }
        else if let number = try? container.decode(Double.self) { value = String(number) }
        else { value = "…" }
    }
}

struct AgentStatus: Decodable, Equatable {
    let busy: Bool
    let pendingApprovals: Int
    let sessionId: String?
    let messageCount: Int
    let cwd: String?

}

struct QuickTaskResult: Codable, Identifiable, Equatable {
    let id: String
    let action: CompanionAction
    let title: String
    var text: String
    var state: State
    let sourceApp: String?
    let createdAt: Date
    var imageDataURL: String?
    var delivery: Delivery

    enum State: String, Codable {
        case running
        case completed
        case failed
    }

    enum Delivery: String, Codable {
        case pending
        case inserted
        case copied
        case fallbackCopied
        case saved
    }

}

enum WriteBackOutcome: Equatable {
    case replaced
    case pasted
    case copied
    case targetChanged
    case permissionDenied
    case unavailable
}
