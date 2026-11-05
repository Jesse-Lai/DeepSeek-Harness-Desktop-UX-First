import Foundation

private struct AgentServiceError: LocalizedError, Sendable {
    let statusCode: Int
    let detail: String

    var errorDescription: String? {
        let language = InterfaceLanguage.current
        if statusCode == 404 {
            return language.text(
                "DSH 本地服务版本不匹配（HTTP 404）。请退出并重新打开 DSH。服务返回：\(detail)",
                "The local DSH service version does not match (HTTP 404). Quit and reopen DSH. Service response: \(detail)"
            )
        }
        return language.text(
            "DSH 服务请求失败（HTTP \(statusCode)）：\(detail)",
            "DSH request failed (HTTP \(statusCode)): \(detail)"
        )
    }
}

enum QuickTaskStreamEvent {
    case delta(String)
    case completed(String, imageDataURL: String?)
    case failed(String)
}

final class AgentClient: @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    private func authorizedRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("Bearer " + (ProcessInfo.processInfo.environment["DSH_COMPANION_TOKEN"] ?? ""), forHTTPHeaderField: "Authorization")
        return request
    }

    func streamQuickTask(_ input: QuickTaskRequest) -> AsyncThrowingStream<QuickTaskStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await requestWhenServerIsReady(input)
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                        throw URLError(.badServerResponse)
                    }

                    var finalText = ""
                    var receivedTerminalEvent = false
                    streamLoop: for try await line in bytes.lines {
                        guard !line.isEmpty,
                              let data = line.data(using: .utf8),
                              let event = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let type = event["type"] as? String else { continue }
                        switch type {
                        case "delta":
                            let text = event["text"] as? String ?? ""
                            finalText += text
                            continuation.yield(.delta(text))
                        case "done":
                            receivedTerminalEvent = true
                            continuation.yield(.completed(
                                event["text"] as? String ?? finalText,
                                imageDataURL: event["imageDataURL"] as? String
                            ))
                            break streamLoop
                        case "error":
                            receivedTerminalEvent = true
                            continuation.yield(.failed(
                                event["error"] as? String
                                    ?? InterfaceLanguage.current.text("快捷任务失败", "Quick task failed")
                            ))
                            break streamLoop
                        default:
                            continue
                        }
                    }
                    if !receivedTerminalEvent {
                        continuation.yield(.failed(InterfaceLanguage.current.text(
                            "DSH 连接意外中断，请重试。",
                            "The DSH connection ended unexpectedly. Try again."
                        )))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func fetchAgentStatus() async throws -> AgentStatus {
        let url = baseURL.appending(path: "api/agent-status")
        let (data, response) = try await session.data(for: authorizedRequest(url: url))
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AgentServiceError(statusCode: http.statusCode, detail: Self.responseDetail(from: data))
        }
        return try JSONDecoder().decode(AgentStatus.self, from: data)
    }

    func startDoAnything(_ input: DoAnythingRequest) async throws -> DoAnythingStartResponse {
        var lastError: Error = URLError(.cannotConnectToHost)
        for attempt in 0..<60 {
            do {
                var request = authorizedRequest(url: baseURL.appending(path: "api/do-anything"))
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONEncoder().encode(input)
                request.timeoutInterval = 30
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                guard (200..<300).contains(http.statusCode) else {
                    throw AgentServiceError(statusCode: http.statusCode, detail: Self.responseDetail(from: data))
                }
                return try JSONDecoder().decode(DoAnythingStartResponse.self, from: data)
            } catch let error as AgentServiceError {
                lastError = error
                if error.statusCode == 404, attempt < 59 {
                    try await Task.sleep(for: .milliseconds(250))
                    continue
                }
                throw error
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
                if attempt < 59 {
                    try await Task.sleep(for: .milliseconds(250))
                    continue
                }
            }
        }
        throw lastError
    }

    func streamAgentRun(runID: String, after cursor: Int = 0) -> AsyncThrowingStream<AgentRunEnvelope, Error> {
        streamAgentRuns(runID: runID, after: cursor, stopAtTerminalEvent: true)
    }

    func streamAllAgentRuns(after cursor: Int = 0) -> AsyncThrowingStream<AgentRunEnvelope, Error> {
        streamAgentRuns(runID: nil, after: cursor, stopAtTerminalEvent: false)
    }

    private func streamAgentRuns(
        runID: String?,
        after cursor: Int,
        stopAtTerminalEvent: Bool
    ) -> AsyncThrowingStream<AgentRunEnvelope, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var nextCursor = max(0, cursor)
                var failures = 0
                while !Task.isCancelled {
                    do {
                        var components = URLComponents(
                            url: baseURL.appending(path: "api/runs/events"),
                            resolvingAgainstBaseURL: false
                        )
                        var queryItems = [URLQueryItem(name: "after", value: String(nextCursor))]
                        if let runID { queryItems.insert(URLQueryItem(name: "runId", value: runID), at: 0) }
                        components?.queryItems = queryItems
                        guard let url = components?.url else { throw URLError(.badURL) }
                        var request = authorizedRequest(url: url)
                        request.timeoutInterval = 60 * 60
                        let (bytes, response) = try await session.bytes(for: request)
                        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                            throw URLError(.badServerResponse)
                        }

                        failures = 0
                        let decoder = JSONDecoder()
                        for try await line in bytes.lines {
                            guard line.hasPrefix("data: "),
                                  let data = String(line.dropFirst(6)).data(using: .utf8) else { continue }
                            let envelope = try decoder.decode(AgentRunEnvelope.self, from: data)
                            guard envelope.cursor > nextCursor else { continue }
                            nextCursor = envelope.cursor
                            continuation.yield(envelope)
                            if stopAtTerminalEvent && envelope.output?.type == "done" {
                                continuation.finish()
                                return
                            }
                        }
                    } catch is CancellationError {
                        continuation.finish()
                        return
                    } catch {
                        failures += 1
                        if failures >= 120 {
                            continuation.finish(throwing: error)
                            return
                        }
                    }
                    try? await Task.sleep(for: .milliseconds(min(2_000, 250 + failures * 100)))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func submitApproval(id: String, choice: String) async throws {
        try await submitApproval(id: id, choice: choice, runID: nil)
    }

    func submitApproval(id: String, choice: String, runID: String?) async throws {
        var body = ["id": id, "choice": choice]
        if let runID { body["runId"] = runID }
        try await postJSON(path: "api/approval", body: body)
    }

    func cancelAgentRun(runID: String? = nil) async throws {
        try await postJSON(path: "api/cancel", body: runID.map { ["runId": $0] } ?? [:])
    }

    func fetchProjects() async throws -> [DesktopProject] {
        try await getJSON(path: "api/projects", as: DesktopProjectsResponse.self).projects
    }

    func fetchChatWorkspace() async throws -> String {
        try await getJSON(path: "api/chat", as: DesktopChatResponse.self).workspaceRoot
    }

    func fetchSessions(workspaceRoot: String, limit: Int = 20) async throws -> [DesktopSessionSummary] {
        let query = "api/sessions?limit=\(limit)&workspaceRoot=\(Self.query(workspaceRoot))"
        return try await getJSON(path: query, as: DesktopSessionsResponse.self).sessions
    }

    func readSession(workspaceRoot: String, sessionID: String) async throws -> DesktopSessionReadResponse {
        try await requestJSON(
            path: "api/session/read",
            method: "POST",
            body: ["workspaceRoot": workspaceRoot, "sessionId": sessionID],
            as: DesktopSessionReadResponse.self
        )
    }

    func startRun(_ requestBody: DesktopRunStartRequest) async throws -> DesktopRunStartResponse {
        try await requestJSON(path: "api/runs", method: "POST", body: requestBody, as: DesktopRunStartResponse.self)
    }

    func fetchRuns(sessionID: String? = nil, includeEvents: Bool = false) async throws -> DesktopRunsResponse {
        var parts: [String] = []
        if let sessionID { parts.append("sessionId=\(Self.query(sessionID))") }
        if includeEvents { parts.append("includeEvents=1") }
        let path = "api/runs" + (parts.isEmpty ? "" : "?" + parts.joined(separator: "&"))
        return try await getJSON(path: path, as: DesktopRunsResponse.self)
    }

    func pickProject() async throws -> DesktopProjectMutationResponse {
        try await requestJSON(path: "api/projects/pick", method: "POST", body: [String: String](), as: DesktopProjectMutationResponse.self)
    }

    func renameProject(path: String, name: String) async throws {
        let _: DesktopProjectsResponse = try await requestJSON(
            path: "api/projects", method: "PATCH", body: ["path": path, "name": name], as: DesktopProjectsResponse.self
        )
    }

    func removeProject(path: String) async throws {
        let _: DesktopProjectsResponse = try await requestJSON(
            path: "api/projects", method: "DELETE", body: ["path": path], as: DesktopProjectsResponse.self
        )
    }

    func registerProject(path: String) async throws {
        let _: DesktopProjectMutationResponse = try await requestJSON(
            path: "api/projects", method: "POST", body: ["path": path], as: DesktopProjectMutationResponse.self
        )
    }

    func renameSession(workspaceRoot: String, sessionID: String, title: String) async throws {
        let _: BasicOKResponse = try await requestJSON(
            path: "api/session/title", method: "PATCH",
            body: ["workspaceRoot": workspaceRoot, "sessionId": sessionID, "title": title],
            as: BasicOKResponse.self
        )
    }

    func archiveSession(workspaceRoot: String, sessionID: String) async throws {
        let _: BasicOKResponse = try await requestJSON(
            path: "api/session/archive", method: "POST",
            body: ["workspaceRoot": workspaceRoot, "sessionId": sessionID],
            as: BasicOKResponse.self
        )
    }

    func fetchChangelogs(projectPath: String) async throws -> [DesktopDailyChangelog] {
        let path = "api/changelogs?projectPath=\(Self.query(projectPath))&limit=20"
        return try await getJSON(path: path, as: DesktopChangelogsResponse.self).changelogs
    }

    func fetchChangelog(projectPath: String, date: String) async throws -> DesktopDailyChangelogDetail {
        let path = "api/changelogs/\(Self.query(date))?projectPath=\(Self.query(projectPath))"
        return try await getJSON(path: path, as: DesktopChangelogDetailResponse.self).changelog
    }

    func changelogImageURL(projectPath: String, date: String) -> URL {
        let path = "api/changelogs/\(Self.query(date))/image?projectPath=\(Self.query(projectPath))"
        return URL(string: path, relativeTo: baseURL)!.absoluteURL
    }

    func promoteWorkspace(workspaceRoot: String, sessionID: String, name: String) async throws -> DesktopWorkspacePromotionResponse {
        try await requestJSON(
            path: "api/workspace/promote",
            method: "POST",
            body: ["workspaceRoot": workspaceRoot, "sessionId": sessionID, "name": name],
            as: DesktopWorkspacePromotionResponse.self
        )
    }

    private func postJSON(path: String, body: [String: String]) async throws {
        var request = authorizedRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            throw AgentServiceError(statusCode: http.statusCode, detail: Self.responseDetail(from: data))
        }
    }

    private func getJSON<T: Decodable>(path: String, as type: T.Type) async throws -> T {
        let request = authorizedRequest(url: Self.url(baseURL: baseURL, path: path))
        let (data, response) = try await session.data(for: request)
        return try Self.decodeResponse(data: data, response: response, as: type)
    }

    private func requestJSON<Body: Encodable, T: Decodable>(
        path: String,
        method: String,
        body: Body,
        as type: T.Type
    ) async throws -> T {
        var request = authorizedRequest(url: Self.url(baseURL: baseURL, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        return try Self.decodeResponse(data: data, response: response, as: type)
    }

    private static func decodeResponse<T: Decodable>(data: Data, response: URLResponse, as type: T.Type) throws -> T {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            throw AgentServiceError(statusCode: http.statusCode, detail: responseDetail(from: data))
        }
        return try JSONDecoder().decode(type, from: data)
    }

    private static func url(baseURL: URL, path: String) -> URL {
        guard let question = path.firstIndex(of: "?") else { return baseURL.appending(path: path) }
        let route = String(path[..<question])
        let query = String(path[path.index(after: question)...])
        var components = URLComponents(url: baseURL.appending(path: route), resolvingAgainstBaseURL: false)!
        components.percentEncodedQuery = query
        return components.url!
    }

    private static func query(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    private func requestWhenServerIsReady(_ input: QuickTaskRequest) async throws -> (URLSession.AsyncBytes, URLResponse) {
        var lastError: Error = URLError(.cannotConnectToHost)
        for attempt in 0..<60 {
            do {
                var request = authorizedRequest(url: baseURL.appending(path: "api/quick-tasks"))
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONEncoder().encode(input)
                request.timeoutInterval = 190
                let (bytes, response) = try await session.bytes(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                if (200..<300).contains(http.statusCode) {
                    return (bytes, response)
                }

                let detail = await Self.responseDetail(from: bytes)
                let serviceError = AgentServiceError(statusCode: http.statusCode, detail: detail)
                lastError = serviceError
                if http.statusCode == 404, attempt < 59 {
                    try await Task.sleep(for: .milliseconds(250))
                    continue
                }
                throw serviceError
            } catch let error as AgentServiceError {
                throw error
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
                if attempt < 59 { try await Task.sleep(for: .milliseconds(250)) }
            }
        }
        throw lastError
    }

    private static func responseDetail(from bytes: URLSession.AsyncBytes) async -> String {
        var data = Data()
        do {
            for try await byte in bytes {
                if data.count >= 8_192 { break }
                data.append(byte)
            }
        } catch {
            return InterfaceLanguage.current.text(
                "无法读取服务响应",
                "The service response could not be read"
            )
        }
        return responseDetail(from: data)
    }

    private static func responseDetail(from data: Data) -> String {
        if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for key in ["error", "message"] {
                if let value = payload[key] as? String, !value.isEmpty { return value }
            }
        }
        let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return text?.isEmpty == false
            ? text!
            : InterfaceLanguage.current.text(
                "服务未返回错误详情",
                "The service did not provide error details"
            )
    }
}

private struct BasicOKResponse: Decodable {
    let ok: Bool
}
