import Foundation

struct DesktopProject: Codable, Identifiable, Equatable {
    var id: String { path }
    let name: String
    let path: String
    let lastUsedAt: String
    let source: String
}

struct DesktopProjectsResponse: Decodable {
    let projects: [DesktopProject]
}

struct DesktopChatResponse: Decodable {
    let workspaceRoot: String
}

struct DesktopWorkspaceMetadata: Codable, Equatable {
    let id: String
    let kind: String
    let path: String
    let displayName: String
}

struct DesktopSessionMetadata: Codable, Equatable {
    let origin: String?
    let source: AgentRunSource?
    let executionRoot: String?
    let workspace: DesktopWorkspaceMetadata?
}

struct DesktopSessionRunState: Codable, Equatable {
    let runId: String
    let status: AgentRunStatus
    let startedAt: String
    let updatedAt: String
    let finishedAt: String?
    let error: String?
}

struct DesktopSessionSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let lastUserMessage: String?
    let pinned: Bool?
    let metadata: DesktopSessionMetadata?
    let lastRun: DesktopSessionRunState?
}

struct DesktopSessionsResponse: Decodable {
    let sessions: [DesktopSessionSummary]
}

struct DesktopSessionMessage: Decodable, Identifiable, Equatable {
    var id: String { "\(role)-\(createdAt ?? "")-\(content.hashValue)" }
    let role: String
    let content: String
    let createdAt: String?
    let attachments: [AgentImageAttachment]?
}

struct DesktopSessionReadResponse: Decodable {
    let sessionId: String?
    let title: String?
    let workspaceRoot: String?
    let executionRoot: String?
    let metadata: DesktopSessionMetadata?
    let messages: [DesktopSessionMessage]?
}

struct DesktopRunStartRequest: Encodable {
    let prompt: String
    let sessionId: String?
    let permissionMode: String
    let context: Context
    let attachments: [DoAnythingImageAttachment]?

    struct Context: Encodable {
        let workspaceRoot: String
        let chatMode: Bool?
        let origin = "mac"
    }
}

struct DesktopRunStartResponse: Decodable {
    let run: AgentRunSnapshot
    let sessionId: String
    let runId: String
    let cursor: Int
}

struct DesktopRunsResponse: Decodable {
    let cursor: Int
    let runs: [AgentRunSnapshot]
    let events: [AgentRunEnvelope]?
}

struct DesktopProjectMutationResponse: Decodable {
    let canceled: Bool?
    let projectPath: String?
    let projects: [DesktopProject]?
}

struct DesktopWorkspacePromotionResponse: Decodable {
    let executionRoot: String
    let workspace: DesktopWorkspaceMetadata
}

struct DesktopDailyChangelog: Codable, Identifiable, Equatable {
    var id: String { date }
    let date: String
    let projectName: String
    let headline: String
    let summary: String
    let highlightCount: Int
    let illustrationStatus: String
    let imageAvailable: Bool
    let finalizedAt: String?
}

struct DesktopChangelogsResponse: Decodable {
    let changelogs: [DesktopDailyChangelog]
}

struct DesktopChangelogHighlight: Codable, Equatable {
    let title: String
    let detail: String
}

struct DesktopDailyChangelogDetail: Codable, Identifiable, Equatable {
    var id: String { date }
    let date: String
    let projectName: String
    let headline: String
    let summary: String
    let highlightCount: Int
    let illustrationStatus: String
    let imageAvailable: Bool
    let finalizedAt: String?
    let highlights: [DesktopChangelogHighlight]
    let verification: [String]
    let changedFiles: [String]
    let sourceSessions: [String]
}

struct DesktopChangelogDetailResponse: Decodable {
    let changelog: DesktopDailyChangelogDetail
}

struct DesktopOutputItem: Identifiable, Equatable {
    let id = UUID()
    let kind: Kind
    let title: String
    let detail: String
    let succeeded: Bool?
    let runID: String?

    init(kind: Kind, title: String, detail: String, succeeded: Bool?, runID: String? = nil) {
        self.kind = kind
        self.title = title
        self.detail = detail
        self.succeeded = succeeded
        self.runID = runID
    }

    enum Kind: Equatable {
        case file
        case diff
        case command
        case source
        case activity
    }
}
