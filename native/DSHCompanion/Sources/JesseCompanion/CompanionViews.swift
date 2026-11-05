import AppKit
import SwiftUI

struct CompanionRootView: View {
    @ObservedObject var model: CompanionViewModel
    @FocusState private var focusedField: CompanionFocusTarget?

    var body: some View {
        Group {
            switch model.surface {
            case .ring:
                CommandRingView(model: model)
            case .ask:
                AskCompanionView(model: model, focusedField: $focusedField)
                    .padding(RingGeometry.popoverInset)
            case .result:
                ResultDetailView(model: model, focusedField: $focusedField)
                    .padding(RingGeometry.popoverInset)
                    .frame(maxHeight: .infinity, alignment: .top)
            case .results:
                ResultListView(model: model, mode: .results)
                    .padding(RingGeometry.popoverInset)
            case .tasks:
                ResultListView(model: model, mode: .tasks)
                    .padding(RingGeometry.popoverInset)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.clear)
        .environment(\.locale, model.language.locale)
        // The panel deliberately stays nonactivating so the source selection
        // remains available for writeback. Keep controls visually active so
        // prominent actions retain their accent treatment in that window.
        .environment(\.appearsActive, true)
        .onChange(of: model.focusRequest) { _, request in
            guard let request else { return }
            DispatchQueue.main.async {
                focusedField = request.target
            }
        }
        .onChange(of: focusedField) { _, field in
            model.isEditingResult = field == .resultEditor
        }
        .onExitCommand {
            model.send(model.surface == .ring ? .close : .returnToRing)
        }
    }
}

private struct RingGlassShape: Shape {
    let holeDiameter: CGFloat

    init(holeDiameter: CGFloat = RingGeometry.ringHoleDiameter) {
        self.holeDiameter = holeDiameter
    }

    nonisolated func path(in rect: CGRect) -> Path {
        let diameter = min(rect.width, rect.height)
        let thickness = max(1, (diameter - holeDiameter) / 2)
        let centerline = rect.insetBy(dx: thickness / 2, dy: thickness / 2)
        return Path(ellipseIn: centerline).strokedPath(
            StrokeStyle(lineWidth: thickness)
        )
    }
}

struct RingRevealShape: Shape {
    let holeDiameter: CGFloat
    var progress: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    nonisolated func path(in rect: CGRect) -> Path {
        let diameter = min(rect.width, rect.height)
        let thickness = max(1, (diameter - holeDiameter) / 2)
        let clampedProgress = min(max(progress, 0), 1)
        guard clampedProgress > 0 else { return Path() }

        let circle = Circle().inset(by: thickness / 2)
        if clampedProgress >= 0.999 {
            return circle
                .stroke(style: StrokeStyle(lineWidth: thickness))
                .path(in: rect)
        }

        return circle
            .trim(from: 0, to: clampedProgress)
            .stroke(style: StrokeStyle(lineWidth: thickness, lineCap: .round))
            .rotation(.degrees(RingAppearance.entranceStartAngle))
            .path(in: rect)
    }
}

struct RingSectorShape: Shape {
    let index: Int
    let actionCount: Int
    let holeDiameter: CGFloat

    init(
        index: Int,
        actionCount: Int = RingGeometry.actionCount,
        holeDiameter: CGFloat = RingGeometry.ringHoleDiameter
    ) {
        self.index = index
        self.actionCount = actionCount
        self.holeDiameter = holeDiameter
    }

    nonisolated func path(in rect: CGRect) -> Path {
        let diameter = min(rect.width, rect.height)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outerRadius = diameter / 2
        let innerRadius = min(outerRadius - 1, holeDiameter / 2)
        let sectorAngle = 2 * CGFloat.pi / CGFloat(max(1, actionCount))
        let centerAngle = CGFloat.pi + CGFloat(index) * sectorAngle
        let startAngle = centerAngle - sectorAngle / 2
        let endAngle = centerAngle + sectorAngle / 2
        let segmentCount = 48

        func point(radius: CGFloat, angle: CGFloat) -> CGPoint {
            CGPoint(
                x: center.x + cos(angle) * radius,
                y: center.y + sin(angle) * radius
            )
        }

        var path = Path()
        path.move(to: point(radius: outerRadius, angle: startAngle))
        for segment in 1...segmentCount {
            let progress = CGFloat(segment) / CGFloat(segmentCount)
            let angle = startAngle + (endAngle - startAngle) * progress
            path.addLine(to: point(radius: outerRadius, angle: angle))
        }
        path.addLine(to: point(radius: innerRadius, angle: endAngle))
        for segment in 1...segmentCount {
            let progress = CGFloat(segment) / CGFloat(segmentCount)
            let angle = endAngle - (endAngle - startAngle) * progress
            path.addLine(to: point(radius: innerRadius, angle: angle))
        }
        path.closeSubpath()
        return path
    }
}

enum RingAppearance {
    static let lightTintOpacity: Double = 0.02
    static let darkTintOpacity: Double = 0.03

    static let selectionGlow = Color(red: 0.02, green: 0.48, blue: 1.0)
    static let selectionGlowHighlight = Color(red: 0.26, green: 0.68, blue: 1.0)
    static let selectionGlowDuration: TimeInterval = 2.8

    static let ambientShadowOpacity: Double = 0.12
    static let ambientShadowRadius: CGFloat = 36
    static let ambientShadowYOffset: CGFloat = 8

    static let contactShadowOpacity: Double = 0.14
    static let contactShadowRadius: CGFloat = 10
    static let contactShadowYOffset: CGFloat = 3

    static let entranceStartAngle: Double = -135
    static let entranceDuration: Double = 0.42
    static let actionEntranceDuration: Double = 0.14

    static func actionRevealFraction(index: Int, actionCount: Int) -> Double {
        guard actionCount > 0 else { return 0 }
        let actionAngle = -180 + Double(index) * 360 / Double(actionCount)
        let offset = (actionAngle - entranceStartAngle)
            .truncatingRemainder(dividingBy: 360)
        return (offset < 0 ? offset + 360 : offset) / 360
    }

    static func actionRevealDelay(index: Int, actionCount: Int) -> Double {
        let fraction = actionRevealFraction(index: index, actionCount: actionCount)
        let finalActionFraction = actionRevealFraction(index: 0, actionCount: actionCount)
        let normalizedFraction = finalActionFraction > 0
            ? min(fraction / finalActionFraction, 1)
            : 0
        return max(0, entranceDuration - actionEntranceDuration) * normalizedFraction
    }

}

private struct CommandRingView: View {
    @ObservedObject var model: CompanionViewModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @State private var hoveredAction: CompanionAction?

    var body: some View {
        let actions = model.availableActions
        let spec = RingGeometry.ringSpec(for: actions.count)
        let isRevealed = model.isRingEntranceRevealed
        let revealProgress: CGFloat = isRevealed ? 1 : 0
        let hoveredIndex = hoveredAction.flatMap { actions.firstIndex(of: $0) }
        ZStack {
            ringShadows(spec: spec, progress: revealProgress)
                .frame(width: spec.ringDiameter, height: spec.ringDiameter)
                .allowsHitTesting(false)
                .animation(entranceAnimation, value: isRevealed)

            GlassEffectContainer(spacing: 0) {
                ZStack {
                    ringSurface(
                        spec: spec,
                        progress: revealProgress
                    )

                    if let hoveredIndex {
                        hoverSurface(index: hoveredIndex, spec: spec)
                            .transition(.identity)
                    }
                }
                .frame(width: spec.ringDiameter, height: spec.ringDiameter)
                .allowsHitTesting(false)
            }
            .animation(entranceAnimation, value: isRevealed)

            ForEach(Array(actions.enumerated()), id: \.element) { index, action in
                RingActionLabel(
                    action: action,
                    index: index,
                    spec: spec,
                    isHovered: hoveredAction == action,
                    language: model.language
                )
                .opacity(isRevealed ? 1 : 0)
                .blur(radius: isRevealed ? 0 : 4)
                .animation(
                    actionEntranceAnimation(index: index, actionCount: actions.count),
                    value: isRevealed
                )
                .accessibilityIdentifier("companion-ring-\(action.rawValue)")
            }

            interactionLayer(actions: actions, spec: spec)
                .allowsHitTesting(isRevealed)
        }
        .frame(width: spec.ringDiameter, height: spec.ringDiameter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: model.ringPresentationID) {
            setHoveredAction(nil)
            NSCursor.arrow.set()
        }
        .onChange(of: isRevealed) { _, revealed in
            guard !revealed else { return }
            setHoveredAction(nil)
            NSCursor.arrow.set()
        }
        .onDisappear {
            NSCursor.arrow.set()
        }
    }

    private var entranceAnimation: Animation? {
        guard !accessibilityReduceMotion else { return nil }
        return .smooth(duration: RingAppearance.entranceDuration, extraBounce: 0)
    }

    private func actionEntranceAnimation(index: Int, actionCount: Int) -> Animation? {
        guard !accessibilityReduceMotion else { return nil }
        let animation = Animation.smooth(
            duration: RingAppearance.actionEntranceDuration,
            extraBounce: 0
        )
        return model.isRingEntranceRevealed
            ? animation.delay(
                RingAppearance.actionRevealDelay(index: index, actionCount: actionCount)
            )
            : animation
    }

    private func ringShadows(spec: RingGeometry.Spec, progress: CGFloat) -> some View {
        ZStack {
            RingShadowLayer(
                shape: RingRevealShape(
                    holeDiameter: spec.ringHoleDiameter,
                    progress: progress
                ),
                opacity: RingAppearance.ambientShadowOpacity,
                radius: RingAppearance.ambientShadowRadius,
                y: RingAppearance.ambientShadowYOffset
            )
            RingShadowLayer(
                shape: RingRevealShape(
                    holeDiameter: spec.ringHoleDiameter,
                    progress: progress
                ),
                opacity: RingAppearance.contactShadowOpacity,
                radius: RingAppearance.contactShadowRadius,
                y: RingAppearance.contactShadowYOffset
            )
        }
    }

    private func interactionLayer(actions: [CompanionAction], spec: RingGeometry.Spec) -> some View {
        let shape = RingGlassShape(holeDiameter: spec.ringHoleDiameter)
        return shape
            // A nearly transparent fill gives AppKit a concrete mouse target while
            // keeping the visual glass and hover layers passive.
            .fill(Color.white.opacity(0.001))
            .contentShape(shape)
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    let action = action(at: location, actions: actions, spec: spec)
                    setHoveredAction(action)
                    (action == nil ? NSCursor.arrow : NSCursor.pointingHand).set()
                case .ended:
                    setHoveredAction(nil)
                    NSCursor.arrow.set()
                }
            }
            .gesture(
                SpatialTapGesture()
                    .onEnded { value in
                        guard let action = action(at: value.location, actions: actions, spec: spec) else { return }
                        model.send(.selectAction(action))
                    }
            )
    }

    private func setHoveredAction(_ action: CompanionAction?) {
        guard hoveredAction != action else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            hoveredAction = action
        }
    }

    private func action(
        at location: CGPoint,
        actions: [CompanionAction],
        spec: RingGeometry.Spec
    ) -> CompanionAction? {
        let bounds = NSRect(
            origin: .zero,
            size: NSSize(width: spec.ringDiameter, height: spec.ringDiameter)
        )
        guard let index = RingGeometry.actionIndex(
            atSwiftUIPoint: location,
            in: bounds,
            spec: spec
        ) else {
            return nil
        }

        return actions[index]
    }

    private func ringSurface(
        spec: RingGeometry.Spec,
        progress: CGFloat
    ) -> some View {
        let isDark = colorScheme == .dark
        let tint = Color.primary.opacity(
            isDark ? RingAppearance.darkTintOpacity : RingAppearance.lightTintOpacity
        )
        let ringShape = RingRevealShape(
            holeDiameter: spec.ringHoleDiameter,
            progress: progress
        )
        return Color.clear
            // The ring remains one continuous Liquid Glass surface while
            // hovering. Only the glow overlay below is sector-scoped.
            .glassEffect(.clear.tint(tint).interactive(), in: ringShape)
            .environment(\.appearsActive, true)
            .overlay {
                ZStack {
                    Circle()
                        .inset(by: 1.2)
                        .trim(from: 0, to: progress)
                        .rotation(.degrees(RingAppearance.entranceStartAngle))
                        .stroke(
                            Color.white.opacity(isDark ? 0.32 : 0.72),
                            style: StrokeStyle(lineWidth: 1.1, lineCap: .round)
                        )
                    Circle()
                        .trim(from: 0, to: progress)
                        .rotation(.degrees(RingAppearance.entranceStartAngle))
                        .stroke(
                            Color.white.opacity(isDark ? 0.30 : 0.68),
                            style: StrokeStyle(lineWidth: 1.0, lineCap: .round)
                        )
                        .frame(
                            width: spec.ringHoleDiameter + 2,
                            height: spec.ringHoleDiameter + 2
                        )
                }
            }
    }

    private func hoverSurface(index: Int, spec: RingGeometry.Spec) -> some View {
        RingHoverSurface(
            index: index,
            actionCount: spec.actionCount,
            holeDiameter: spec.ringHoleDiameter,
            reduceMotion: accessibilityReduceMotion
        )
    }
}

private struct RingHoverSurface: View {
    let index: Int
    let actionCount: Int
    let holeDiameter: CGFloat
    let reduceMotion: Bool

    var body: some View {
        let shape = RingSectorShape(
            index: index,
            actionCount: actionCount,
            holeDiameter: holeDiameter
        )

        TimelineView(
            .animation(
                minimumInterval: 1.0 / 30.0,
                paused: reduceMotion
            )
        ) { context in
            glowLayer(
                phase: reduceMotion ? 0.25 : animationPhase(at: context.date)
            )
        }
        // The sector exists only as an invisible glow mask. It never creates a
        // second glass surface, border, highlight, or refraction seam.
        .mask {
            shape.fill(Color.white)
        }
    }

    private func glowLayer(phase: Double) -> some View {
        GeometryReader { proxy in
            let resolvedSize = proxy.size
            let diameter = min(resolvedSize.width, resolvedSize.height)
            let pulse = 0.5 - 0.5 * cos(phase * 2 * Double.pi)
            let sectorAngle = 2 * Double.pi / Double(max(1, actionCount))
            let angle = Double.pi
                + Double(index) * sectorAngle
                + sin(phase * 2 * Double.pi) * sectorAngle * 0.08
            let middleRadius = (diameter + holeDiameter) / 4
            let radialDrift = diameter * 0.025 * cos(phase * 2 * Double.pi)
            let center = UnitPoint(
                x: 0.5 + cos(angle) * (middleRadius + radialDrift) / resolvedSize.width,
                y: 0.5 + sin(angle) * (middleRadius + radialDrift) / resolvedSize.height
            )
            let glowRadius = diameter * (0.20 + 0.10 * pulse)
            let haloRadius = diameter * (0.26 + 0.08 * pulse)

            ZStack {
                RadialGradient(
                    colors: [
                        RingAppearance.selectionGlow.opacity(0.40 + 0.28 * pulse),
                        RingAppearance.selectionGlow.opacity(0.20 + 0.08 * pulse),
                        RingAppearance.selectionGlow.opacity(0.04),
                        .clear,
                    ],
                    center: center,
                    startRadius: 0,
                    endRadius: haloRadius
                )

                RadialGradient(
                    colors: [
                        RingAppearance.selectionGlowHighlight.opacity(0.42 + 0.25 * pulse),
                        RingAppearance.selectionGlow.opacity(0.22 + 0.10 * pulse),
                        .clear,
                    ],
                    center: center,
                    startRadius: 0,
                    endRadius: glowRadius
                )
                .blur(radius: diameter * (0.025 + 0.022 * pulse))
            }
        }
    }

    private func animationPhase(at date: Date) -> Double {
        date.timeIntervalSinceReferenceDate
            .truncatingRemainder(dividingBy: RingAppearance.selectionGlowDuration)
            / RingAppearance.selectionGlowDuration
    }
}

private struct RingShadowLayer: View {
    let shape: RingRevealShape
    let opacity: Double
    let radius: CGFloat
    let y: CGFloat

    var body: some View {
        ZStack {
            shape
                .fill(.black)
                .shadow(color: .black.opacity(opacity), radius: radius, y: y)
            shape
                .fill(.black)
                .blendMode(.destinationOut)
        }
        .compositingGroup()
    }
}

private struct RingActionLabel: View {
    let action: CompanionAction
    let index: Int
    let spec: RingGeometry.Spec
    let isHovered: Bool
    let language: InterfaceLanguage

    var body: some View {
        VStack(spacing: RingGeometry.actionLabelSpacing) {
            FluentIcon(name: action.fluentIconName)
                .frame(width: RingGeometry.actionIconSize, height: RingGeometry.actionIconSize)
                .frame(width: RingGeometry.actionIconFrame, height: RingGeometry.actionIconFrame)
                .foregroundStyle(itemColor)
            Text(action.title(in: language))
                .font(.system(size: RingGeometry.actionTitleSize))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .frame(maxWidth: RingGeometry.actionTitleMaxWidth)
                .foregroundStyle(itemColor)
        }
        .frame(width: RingGeometry.actionDiameter, height: RingGeometry.actionDiameter)
        .position(actionPosition)
        .frame(width: spec.ringDiameter, height: spec.ringDiameter)
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(action.title(in: language))
    }

    private var itemColor: Color {
        isHovered ? Color(nsColor: .controlAccentColor) : Color.secondary
    }

    private var actionPosition: CGPoint {
        let size = NSSize(width: spec.ringDiameter, height: spec.ringDiameter)
        let point = RingGeometry.actionCenter(
            for: index,
            in: NSRect(origin: .zero, size: size),
            spec: spec
        )
        return CGPoint(x: point.x, y: size.height - point.y)
    }
}

private struct AskCompanionView: View {
    @ObservedObject var model: CompanionViewModel
    @FocusState.Binding var focusedField: CompanionFocusTarget?

    var body: some View {
        CompanionGlassPanel {
            VStack(spacing: 0) {
                CompanionPanelHeader(
                    title: CompanionAction.ask.title(in: model.language),
                    subtitle: headerSubtitle,
                    model: model
                )

                Divider().opacity(0.6)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if let session = model.agentSession {
                            ForEach(session.messages) { message in
                                agentMessage(message)
                            }
                            ForEach(session.runs) { run in
                                agentActivity(run)
                                if let approval = run.pendingApproval, let runID = run.runID {
                                    approvalCard(approval, runID: runID)
                                }
                            }
                        }
                    }
                    .padding(14)
                }
                .frame(maxHeight: .infinity)

                Divider().opacity(0.6)

                if let attachment = model.composerAttachment {
                    screenshotCard(attachment)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, 2)
                }

                TextField(
                    model.language.text("问问题，或让我完成一件事…", "Ask a question, or tell me what to do..."),
                    text: $model.askDraft,
                    axis: .vertical
                )
                    .font(.system(size: 14))
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .frame(maxWidth: .infinity, minHeight: 42, alignment: .topLeading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .focused($focusedField, equals: .askEditor)
                    .onKeyPress(.return, phases: .down) { press in
                        guard !press.modifiers.contains(.shift) else { return .ignored }
                        submit()
                        return .handled
                    }

                HStack {
                    Spacer()
                    Button(action: submit) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 16, height: 18)
                    }
                    .buttonStyle(WebComposerSendButtonStyle())
                    .disabled(!canSubmit)
                    .accessibilityLabel(model.language.text("发送", "Send"))
                    .help(model.language.text("发送", "Send"))
                }
                .frame(height: 55)
                .padding(.horizontal, 12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func screenshotCard(_ attachment: CompanionComposerAttachment) -> some View {
        DataURLImageView(dataURL: attachment.imageDataURL)
            .frame(width: 112, height: 84)
            .background(Color.primary.opacity(0.045))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.primary.opacity(0.12), lineWidth: 0.7)
            }
            .overlay(alignment: .topTrailing) {
                Button {
                    model.send(.clearComposerAttachment)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .frame(width: 20, height: 20)
                        .background(.regularMaterial)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .padding(6)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func agentMessage(_ message: CompanionAgentMessage) -> some View {
        VStack(
            alignment: message.role == "user" ? .trailing : .leading,
            spacing: 9
        ) {
            if let imageDataURL = message.imageDataURL {
                MessageImageView(
                    dataURL: imageDataURL,
                    isUser: message.role == "user"
                )
                if message.role == "assistant" {
                    agentImageActions(message, dataURL: imageDataURL)
                }
            }
            if !message.text.isEmpty {
                messageCopy(message)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
    }

    private func agentImageActions(
        _ message: CompanionAgentMessage,
        dataURL: String
    ) -> some View {
        let finished = message.imageDelivery == .inserted
            || message.imageDelivery == .fallbackCopied
        return HStack(spacing: 8) {
            PanelIconButton(
                systemImage: message.imageDelivery == .copied ? "checkmark" : "doc.on.doc",
                help: message.imageDelivery == .copied
                    ? model.language.text("图片已复制", "Image Copied")
                    : model.language.text("复制图片", "Copy Image"),
                isEnabled: true
            ) {
                model.send(.copyAgentImage(id: message.id, dataURL: dataURL))
            }

            Button {
                model.send(.writeBackAgentImage(id: message.id, dataURL: dataURL))
            } label: {
                Text(agentImageWriteBackTitle(message))
                    .lineLimit(1)
                    .frame(height: PanelControlMetrics.labelHeight)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
            .disabled(finished)
        }
        .frame(maxWidth: 320, alignment: .trailing)
    }

    private func agentImageWriteBackTitle(_ message: CompanionAgentMessage) -> String {
        switch message.imageDelivery {
        case .inserted:
            model.language.text("已插入", "Inserted")
        case .fallbackCopied:
            model.language.text("已复制，可手动粘贴", "Copied. Paste Manually")
        default:
            model.language.text(
                "插入到 \(localizedSourceApp)",
                "Insert into \(localizedSourceApp)"
            )
        }
    }

    @ViewBuilder
    private func messageCopy(_ message: CompanionAgentMessage) -> some View {
        if message.role == "user" {
            Text(message.text)
                .font(.system(size: 13))
                .textSelection(.enabled)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.accentColor.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            Text(message.text)
                .font(.system(size: 13))
                .textSelection(.enabled)
        }
    }

    private func agentActivity(_ run: CompanionAgentRunState) -> some View {
        HStack(spacing: 8) {
            if run.status.isActive {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: run.status == .completed ? "checkmark.circle.fill" : "exclamationmark.circle")
                    .foregroundStyle(run.status == .completed ? Color(nsColor: .systemGreen) : Color.secondary)
            }
            Text(run.activity)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 6)
            if run.isActive, let runID = run.runID {
                Button {
                    model.send(.cancelAgentRun(runID: runID))
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 9, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(model.language.text("停止此任务", "Stop this task"))
                .help(model.language.text("停止此任务", "Stop this task"))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func approvalCard(_ approval: AgentApprovalRequest, runID: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(approval.title)
                .font(.system(size: 12, weight: .semibold))
            Text(approval.detail)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack {
                Button(model.language.text("拒绝", "Reject")) {
                    model.send(.approveAgentRun(runID: runID, id: approval.id, choice: "reject_once"))
                }
                Button(model.language.text("允许一次", "Allow Once")) {
                    model.send(.approveAgentRun(runID: runID, id: approval.id, choice: "allow_once"))
                }
                .buttonStyle(.borderedProminent)
            }
            .controlSize(.small)
        }
        .padding(10)
        .background(Color.orange.opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private var canSubmit: Bool {
        !model.askDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || model.composerAttachment != nil
    }

    private var localizedSourceApp: String {
        if model.context.sourceApp == "当前应用" || model.context.sourceApp == "Current App" {
            return model.language.text("当前应用", "Current App")
        }
        return model.context.sourceApp
    }

    private var headerSubtitle: String {
        if let attachment = model.composerAttachment {
            return model.language.text(
                "引用截图 · \(attachment.sourceApp)",
                "Screenshot from \(attachment.sourceApp)"
            )
        }
        if model.context.sourceURL != nil || !model.context.selectedText.isEmpty {
            return model.language.text(
                "引用 \(localizedSourceApp)",
                "Using \(localizedSourceApp)"
            )
        }
        return localizedSourceApp
    }

    private func submit() {
        let value = model.askDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSubmit else { return }
        model.askDraft = ""
        model.send(.submitDoAnything(value))
    }
}

private struct ResultDetailView: View {
    @ObservedObject var model: CompanionViewModel
    @FocusState.Binding var focusedField: CompanionFocusTarget?
    @State private var editorWidth: CGFloat = 390

    var body: some View {
        if let result = model.selectedResult {
            CompanionGlassPanel {
                VStack(spacing: 0) {
                    CompanionPanelHeader(
                        title: result.action.title(in: model.language),
                        subtitle: nil,
                        model: model
                    )

                    Divider().opacity(0.6)
                    resultBody(result)

                    if result.state != .running {
                        Divider().opacity(0.6)
                        resultActions(result)
                    }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGSize.self, of: { $0.size }) { size in
                model.send(.contentSizeChanged(
                    surface: .result,
                    size: CGSize(
                        width: size.width + RingGeometry.popoverInset * 2,
                        height: size.height + RingGeometry.popoverInset * 2
                    )
                ))
            }
            .task(id: model.resultDraft) {
                guard result.state == .completed,
                      result.imageDataURL == nil,
                      model.resultDraft != result.text else { return }
                do {
                    try await Task.sleep(for: .milliseconds(200))
                } catch {
                    return
                }
                model.send(.updateResult(id: result.id, text: model.resultDraft))
            }
        }
    }

    @ViewBuilder
    private func resultBody(_ result: QuickTaskResult) -> some View {
        switch result.state {
        case .running where !result.text.isEmpty:
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(result.text)
                                .font(.system(size: 14))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .topLeading)

                            Color.clear
                                .frame(height: 1)
                                .id(result.id)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }
                    .frame(height: textBodyHeight(for: result.text))
                    .onAppear {
                        proxy.scrollTo(result.id, anchor: .bottom)
                    }
                    .onChange(of: result.text) { _, _ in
                        DispatchQueue.main.async {
                            proxy.scrollTo(result.id, anchor: .bottom)
                        }
                    }
                }

                HStack(spacing: 8) {
                    ProgressView().controlSize(.mini)
                    Text(model.language.text("正在生成…", "Generating..."))
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .frame(height: 32)
                .background(Color.primary.opacity(0.025))
            }
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width in
                editorWidth = width
            }
            .accessibilityIdentifier("companion-result-stream")
        case .running:
            HStack(spacing: 11) {
                ProgressView().controlSize(.small)
                Text(result.action.processingDescription(in: model.language))
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .frame(height: 66)
        case .completed where result.imageDataURL != nil:
            if let imageDataURL = result.imageDataURL {
                DataURLImageView(dataURL: imageDataURL)
                    .frame(height: 260)
                    .frame(maxWidth: .infinity)
                    .background(Color.primary.opacity(0.035))
                    .padding(12)
            }
        case .completed:
            TextEditor(text: $model.resultDraft)
                .font(.system(size: 14))
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .frame(height: editorHeight)
                .focused($focusedField, equals: .resultEditor)
                .simultaneousGesture(TapGesture().onEnded {
                    model.send(.activateFocus(.resultEditor))
                })
                .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width in
                    editorWidth = width
                }
        case .failed:
            Text(result.text.isEmpty
                ? model.language.text("处理失败，请重试。", "Processing failed. Try again.")
                : result.text
            )
                .font(.system(size: 14))
                .foregroundStyle(Color(nsColor: .systemRed))
                .frame(maxWidth: .infinity, minHeight: 68, alignment: .topLeading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(16)
        }
    }

    private func resultActions(_ result: QuickTaskResult) -> some View {
        let hasText = !model.resultDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let completed = result.state == .completed
        let inserted = result.delivery == .inserted
        let fallbackCopied = result.delivery == .fallbackCopied
        let canWriteBack = result.action.supportsWriteBack
            && model.writableResultIDs.contains(result.id)

        return HStack(spacing: 8) {
            Spacer()
            if result.imageDataURL == nil {
                PanelIconButton(
                    systemImage: "arrow.clockwise",
                    help: model.language.text("使用当前文字重新执行", "Run Again with Current Text"),
                    isEnabled: completed && hasText
                ) {
                    model.send(.retryResult(id: result.id, text: model.resultDraft))
                }
            }
            PanelIconButton(
                systemImage: "doc.on.doc",
                help: result.imageDataURL == nil
                    ? model.language.text("复制结果", "Copy Result")
                    : model.language.text("复制图片", "Copy Image"),
                isEnabled: completed && (result.imageDataURL != nil || hasText)
            ) {
                model.send(.copyResult(id: result.id, text: model.resultDraft))
            }
            if completed && canWriteBack {
                Button {
                    model.send(.writeBack(id: result.id, text: model.resultDraft))
                } label: {
                    Text(writeBackTitle(result))
                        .lineLimit(1)
                        .frame(height: PanelControlMetrics.labelHeight)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .disabled(inserted || fallbackCopied || (result.imageDataURL == nil && !hasText))
            }
        }
        .frame(height: 55)
        .padding(.horizontal, 12)
    }

    private var editorHeight: CGFloat {
        textBodyHeight(for: model.resultDraft)
    }

    private func textBodyHeight(for text: String) -> CGFloat {
        let width = max(1, editorWidth - 32)
        let font = NSFont.systemFont(ofSize: 14)
        let measuredText = text.isEmpty ? " " : text
        let rect = (measuredText as NSString).boundingRect(
            with: NSSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font]
        )
        return min(320, max(68, ceil(rect.height) + 30))
    }

    private func writeBackTitle(_ result: QuickTaskResult) -> String {
        switch result.delivery {
        case .inserted:
            return model.language.text("已回填", "Inserted")
        case .fallbackCopied:
            return model.language.text("已复制，可手动粘贴", "Copied. Paste Manually")
        default:
            let destination = result.sourceApp ?? model.language.text("原位置", "Original Location")
            return result.imageDataURL == nil
                ? model.language.text("回填到 \(destination)", "Replace in \(destination)")
                : model.language.text("插入到 \(destination)", "Insert into \(destination)")
        }
    }
}

private struct ResultListView: View {
    @ObservedObject var model: CompanionViewModel
    let mode: CompanionSurface

    private var visibleResults: [QuickTaskResult] {
        mode == .tasks ? model.runningResults : model.results
    }

    var body: some View {
        CompanionGlassPanel {
            VStack(spacing: 0) {
                CompanionPanelHeader(
                    title: mode == .tasks
                        ? CompanionAction.tasks.title(in: model.language)
                        : CompanionAction.results.title(in: model.language),
                    subtitle: mode == .tasks
                        ? model.language.text(
                            "\(visibleResults.count) 个快捷任务",
                            "\(visibleResults.count) Quick Tasks"
                        )
                        : model.language.text(
                            "\(visibleResults.count) 个结果",
                            "\(visibleResults.count) Results"
                        ),
                    model: model
                )

                Divider().opacity(0.6)

                ScrollView {
                    LazyVStack(spacing: 2) {
                        if mode == .tasks, let status = model.agentStatus {
                            AgentStatusRow(status: status, language: model.language)
                            Divider().padding(.horizontal, 10).opacity(0.6)
                        }

                        if visibleResults.isEmpty && !(mode == .tasks && model.agentStatus != nil) {
                            Text(mode == .tasks
                                ? model.language.text(
                                    "当前没有正在运行的快捷任务",
                                    "No quick tasks are running"
                                )
                                : model.language.text("还没有快捷结果", "No quick results yet")
                            )
                                .font(.system(size: 13))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 70)
                        } else {
                            ForEach(visibleResults) { result in
                                ResultListRow(result: result, language: model.language) {
                                    model.send(.showResult(result.id))
                                }
                            }
                        }
                    }
                    .padding(6)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: mode) {
            guard mode == .tasks else { return }
            while !Task.isCancelled {
                model.send(.refreshTasks)
                do {
                    try await Task.sleep(for: .seconds(2))
                } catch {
                    return
                }
            }
        }
    }
}

private struct ResultListRow: View {
    let result: QuickTaskResult
    let language: InterfaceLanguage
    let onSelect: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 10) {
                ResultStateIndicator(state: result.state)
                VStack(alignment: .leading, spacing: 2) {
                    Text(result.action.title(in: language))
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                    Text(result.state == .running
                        ? language.text("正在处理", "Processing")
                        : result.text.isEmpty
                            ? language.text("图片结果", "Image Result")
                            : result.text
                    )
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(result.createdAt, format: .dateTime.hour().minute())
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
            .background(Color.primary.opacity(isHovered ? 0.065 : 0))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

private struct AgentStatusRow: View {
    let status: AgentStatus
    let language: InterfaceLanguage

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(indicatorColor)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text("Agent")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 56)
    }

    private var title: String {
        if status.pendingApprovals > 0 {
            return language.text("完整 Agent 等待确认", "Full Agent Is Waiting for Approval")
        }
        return status.busy
            ? language.text("完整 Agent 正在执行", "Full Agent Is Running")
            : language.text("完整 Agent 当前空闲", "Full Agent Is Idle")
    }

    private var detail: String {
        if let sessionID = status.sessionId, !sessionID.isEmpty {
            return language.text(
                "会话 \(sessionID.prefix(8)) · \(status.messageCount) 条消息",
                "Session \(sessionID.prefix(8)) · \(status.messageCount) Messages"
            )
        }
        if let cwd = status.cwd, !cwd.isEmpty {
            return URL(fileURLWithPath: cwd).lastPathComponent
        }
        return "DSH"
    }

    private var indicatorColor: Color {
        if status.pendingApprovals > 0 { return Color(nsColor: .systemRed) }
        return status.busy ? .accentColor : Color(nsColor: .systemGreen)
    }
}

private struct CompanionPanelHeader: View {
    let title: String
    let subtitle: String?
    @ObservedObject var model: CompanionViewModel
    @State private var isDragging = false

    var body: some View {
        HStack(spacing: 8) {
            Button {
                model.send(.returnToRing)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .contentShape(Rectangle())
            .help(model.language.text("返回", "Back"))

            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(1)
                .layoutPriority(1)

            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(height: 55)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 3)
                .onChanged { value in
                    if !isDragging {
                        isDragging = true
                        model.send(.beginPanelDrag)
                    }
                    model.send(.dragPanel(value.translation))
                }
                .onEnded { _ in
                    isDragging = false
                    model.send(.endPanelDrag)
                }
        )
    }
}

private enum PanelControlMetrics {
    static let labelHeight: CGFloat = 20
    static let iconLabelWidth: CGFloat = 24
}

private struct WebComposerSendButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        WebComposerSendButtonStyleBody(configuration: configuration)
    }
}

private struct WebComposerSendButtonStyleBody: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered = false
    let configuration: ButtonStyleConfiguration

    var body: some View {
        configuration.label
            .foregroundStyle(foregroundColor)
            .frame(width: 36, height: 36)
            .background(backgroundColor, in: Circle())
            .contentShape(Circle())
            .onHover { isHovered = $0 }
            .animation(.easeOut(duration: 0.12), value: isHovered)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }

    private var backgroundColor: Color {
        let highlighted = isHovered || configuration.isPressed
        if colorScheme == .dark {
            return highlighted
                ? .white
                : Color(red: 0.933, green: 0.949, blue: 0.969)
        }
        return highlighted
            ? Color(red: 0.184, green: 0.184, blue: 0.184)
            : .black.opacity(0.86)
    }

    private var foregroundColor: Color {
        colorScheme == .dark
            ? Color(red: 0.043, green: 0.055, blue: 0.078)
            : .white
    }
}

private struct ResultStateIndicator: View {
    let state: QuickTaskResult.State

    var body: some View {
        Group {
            if state == .running {
                ProgressView().controlSize(.mini)
            } else {
                Circle()
                    .fill(state == .completed ? Color(nsColor: .systemGreen) : Color(nsColor: .systemRed))
                    .frame(width: 8, height: 8)
            }
        }
        .frame(width: 12, height: 12)
    }
}

private struct PanelIconButton: View {
    let systemImage: String
    let help: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .frame(
                    width: PanelControlMetrics.iconLabelWidth,
                    height: PanelControlMetrics.labelHeight
                )
        }
        .buttonStyle(.bordered)
        .controlSize(.regular)
        .disabled(!isEnabled)
        .help(help)
    }
}

private struct DataURLImageView: View {
    let dataURL: String

    var body: some View {
        Group {
            if let image = DataURLDecoder.image(dataURL) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 24))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// Mirrors the desktop conversation attachment: the image is its own rounded
// surface and never inherits the adjacent message bubble background.
private struct MessageImageView: View {
    @Environment(\.colorScheme) private var colorScheme
    let dataURL: String
    let isUser: Bool

    var body: some View {
        Group {
            if let image = DataURLDecoder.image(dataURL) {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: isUser ? .fill : .fit)
            } else {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 24))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(
            width: isUser ? 124 : nil,
            height: isUser ? 124 : nil
        )
        .frame(maxWidth: isUser ? nil : 320, maxHeight: isUser ? nil : 320)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(
                    Color.primary.opacity(colorScheme == .dark ? 0.22 : 0.14),
                    lineWidth: 0.7
                )
        }
        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
    }
}

private struct CompanionGlassPanel<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        let tint = Color(nsColor: .controlBackgroundColor).opacity(colorScheme == .dark ? 0.22 : 0.17)
        content
            .background(Color.clear)
            .clipShape(shape)
            .glassEffect(.regular.tint(tint), in: shape)
            .overlay {
                shape.stroke(
                    Color.white.opacity(colorScheme == .dark ? 0.14 : 0.32),
                    lineWidth: 0.7
                )
            }
            // Keep the shadow attached to the rounded glass surface. The native
            // NSPanel shadow is intentionally disabled because it follows the
            // transparent window's rectangular bounds instead of this shape.
            .shadow(
                color: .black.opacity(colorScheme == .dark ? 0.32 : 0.24),
                radius: RingGeometry.popoverShadowRadius,
                y: RingGeometry.popoverShadowYOffset
            )
    }
}
