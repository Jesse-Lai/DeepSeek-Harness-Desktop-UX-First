import AppKit

enum RingGeometry {
    // The visible popover keeps its original size. The surrounding transparent
    // window is larger so the rounded SwiftUI shadow can fade out before it
    // reaches the NSPanel bounds.
    static let popoverContentSize = NSSize(width: 442, height: 512)
    static let popoverShadowRadius: CGFloat = 4
    static let popoverShadowYOffset: CGFloat = 2
    // Liquid Glass contributes a wider system shadow in addition to the
    // explicit SwiftUI shadow. Leave enough transparent window space for both
    // shadows to reach zero opacity instead of clipping at the NSPanel edge.
    static let popoverInset: CGFloat = 40
    // Keep the visible panel at the same cursor-relative position it used when
    // the transparent window clearance was 24 points.
    static let popoverAnchorInset: CGFloat = 24
    static let panelSize = NSSize(
        width: popoverContentSize.width + popoverInset * 2,
        height: popoverContentSize.height + popoverInset * 2
    )
    static let popoverPlacementSize = NSSize(
        width: popoverContentSize.width + popoverAnchorInset * 2,
        height: popoverContentSize.height + popoverAnchorInset * 2
    )
    static let popoverPanelOriginAdjustment = NSPoint(
        x: popoverAnchorInset - popoverInset,
        y: popoverInset - popoverAnchorInset
    )
    static let ringDiameter: CGFloat = 370
    static let ringHoleDiameter: CGFloat = 160
    static let ringShadowClearance: CGFloat = 90
    static let actionOrbitRadius: CGFloat = (ringDiameter + ringHoleDiameter) / 4
    static let actionDiameter: CGFloat = 72
    static let actionIconSize: CGFloat = 21
    static let actionIconFrame: CGFloat = 25
    static let actionTitleSize: CGFloat = 12
    static let actionTitleMaxWidth: CGFloat = 64
    static let actionLabelSpacing: CGFloat = 5
    static let actionCount = 8
    static let actionSectorAngle: CGFloat = 2 * .pi / CGFloat(actionCount)
    static let minimumSizingActionCount = 4
    static let minimumRingScale: CGFloat = 0.60
    static let minimumRingHoleScale: CGFloat = 0.10
    static let threeActionRingHoleScale: CGFloat = 0.30
    static let cursorOffset = NSPoint(x: 1, y: 1)
    static let compactResultContentHeight: CGFloat = 128
    static let compactResultHeight: CGFloat = compactResultContentHeight + popoverInset * 2
    static let minimumResultHeight: CGFloat = compactResultHeight
    static let maximumResultHeight: CGFloat = panelSize.height

    struct Spec {
        let actionCount: Int
        let scale: CGFloat
        let holeScale: CGFloat
        let ringShadowClearance: CGFloat
        let panelSize: NSSize
        let ringDiameter: CGFloat
        let ringHoleDiameter: CGFloat

        var actionOrbitRadius: CGFloat {
            (ringDiameter + ringHoleDiameter) / 4
        }
    }

    static func ringSpec(for visibleActionCount: Int = actionCount) -> Spec {
        let resolvedActionCount = max(0, visibleActionCount)
        let sizingActionCount = min(
            max(max(resolvedActionCount, 1), minimumSizingActionCount),
            actionCount
        )
        let progress = CGFloat(sizingActionCount - minimumSizingActionCount)
            / CGFloat(actionCount - minimumSizingActionCount)
        let scale = minimumRingScale + (1 - minimumRingScale) * progress
        let interpolatedHoleScale = minimumRingHoleScale + (1 - minimumRingHoleScale) * progress
        let holeScale = resolvedActionCount == 3
            ? threeActionRingHoleScale
            : interpolatedHoleScale
        let shadowClearance = ringShadowClearance
        return Spec(
            actionCount: resolvedActionCount,
            scale: scale,
            holeScale: holeScale,
            ringShadowClearance: shadowClearance,
            panelSize: NSSize(
                width: ringDiameter * scale + shadowClearance * 2,
                height: ringDiameter * scale + shadowClearance * 2
            ),
            ringDiameter: ringDiameter * scale,
            ringHoleDiameter: ringHoleDiameter * holeScale
        )
    }

    static func ringPanelOriginAdjustment(for spec: Spec = ringSpec()) -> NSPoint {
        let previousSize = NSSize(
            width: popoverPlacementSize.width * spec.scale,
            height: popoverPlacementSize.height * spec.scale
        )
        return NSPoint(
            x: -(spec.panelSize.width - previousSize.width) / 2,
            y: (spec.panelSize.height - previousSize.height) / 2
        )
    }

    static func ringFrame(in bounds: NSRect, spec: Spec = ringSpec()) -> NSRect {
        NSRect(
            x: bounds.midX - spec.ringDiameter / 2,
            y: bounds.midY - spec.ringDiameter / 2,
            width: spec.ringDiameter,
            height: spec.ringDiameter
        )
    }

    static func ringHoleFrame(in bounds: NSRect, spec: Spec = ringSpec()) -> NSRect {
        let ring = ringFrame(in: bounds, spec: spec)
        return NSRect(
            x: ring.midX - spec.ringHoleDiameter / 2,
            y: ring.midY - spec.ringHoleDiameter / 2,
            width: spec.ringHoleDiameter,
            height: spec.ringHoleDiameter
        )
    }

    static func actionSectorAngle(for actionCount: Int) -> CGFloat {
        precondition(actionCount > 0)
        return 2 * .pi / CGFloat(actionCount)
    }

    static func actionCenter(
        for index: Int,
        in bounds: NSRect,
        actionCount: Int = RingGeometry.actionCount
    ) -> NSPoint {
        actionCenter(for: index, in: bounds, spec: ringSpec(for: actionCount))
    }

    static func actionCenter(for index: Int, in bounds: NSRect, spec: Spec) -> NSPoint {
        precondition(spec.actionCount > 0)
        precondition((0..<spec.actionCount).contains(index))
        let ring = ringFrame(in: bounds, spec: spec)
        let sectorAngle = actionSectorAngle(for: spec.actionCount)
        let angle = CGFloat.pi - CGFloat(index) * sectorAngle
        return NSPoint(
            x: ring.midX + cos(angle) * spec.actionOrbitRadius,
            y: ring.midY + sin(angle) * spec.actionOrbitRadius
        )
    }

    static func actionIndex(
        at point: NSPoint,
        in bounds: NSRect,
        actionCount: Int = RingGeometry.actionCount
    ) -> Int? {
        actionIndex(at: point, in: bounds, spec: ringSpec(for: actionCount))
    }

    static func actionIndex(at point: NSPoint, in bounds: NSRect, spec: Spec) -> Int? {
        guard spec.actionCount > 0 else { return nil }
        let ring = ringFrame(in: bounds, spec: spec)
        let dx = point.x - ring.midX
        let dy = point.y - ring.midY
        let distance = hypot(dx, dy)
        let innerRadius = spec.ringHoleDiameter / 2
        let outerRadius = spec.ringDiameter / 2
        guard distance >= innerRadius, distance <= outerRadius else { return nil }

        let angle = atan2(dy, dx)
        let sectorAngle = actionSectorAngle(for: spec.actionCount)
        let fullTurn = 2 * CGFloat.pi
        var clockwiseOffset = (CGFloat.pi - angle + sectorAngle / 2)
            .truncatingRemainder(dividingBy: fullTurn)
        if clockwiseOffset < 0 {
            clockwiseOffset += fullTurn
        }
        return Int(clockwiseOffset / sectorAngle) % spec.actionCount
    }

    static func actionIndex(
        atSwiftUIPoint point: CGPoint,
        in bounds: CGRect,
        actionCount: Int = RingGeometry.actionCount
    ) -> Int? {
        actionIndex(atSwiftUIPoint: point, in: bounds, spec: ringSpec(for: actionCount))
    }

    static func actionIndex(atSwiftUIPoint point: CGPoint, in bounds: CGRect, spec: Spec) -> Int? {
        actionIndex(
            at: NSPoint(x: point.x, y: bounds.minY + bounds.maxY - point.y),
            in: bounds,
            spec: spec
        )
    }

    static func actionSectorContains(
        _ point: NSPoint,
        index: Int,
        in bounds: NSRect,
        actionCount: Int = RingGeometry.actionCount
    ) -> Bool {
        actionSectorContains(point, index: index, in: bounds, spec: ringSpec(for: actionCount))
    }

    static func actionSectorContains(_ point: NSPoint, index: Int, in bounds: NSRect, spec: Spec) -> Bool {
        precondition(spec.actionCount > 0)
        precondition((0..<spec.actionCount).contains(index))
        return actionIndex(at: point, in: bounds, spec: spec) == index
    }

    static func popoverFrame(in bounds: NSRect) -> NSRect {
        bounds.insetBy(dx: popoverInset, dy: popoverInset)
    }

    static func frame(
        near cursor: NSPoint,
        visibleFrame: NSRect,
        panelSize: NSSize = panelSize,
        originAdjustment: NSPoint = .zero
    ) -> NSRect {
        var origin = NSPoint(
            x: cursor.x + cursorOffset.x + originAdjustment.x,
            y: cursor.y - panelSize.height + cursorOffset.y + originAdjustment.y
        )

        let minX = visibleFrame.minX + 8
        let maxX = visibleFrame.maxX - panelSize.width - 8
        let minY = visibleFrame.minY + 8
        let maxY = visibleFrame.maxY - panelSize.height - 8
        origin.x = min(max(origin.x, minX), maxX)
        origin.y = min(max(origin.y, minY), maxY)
        return NSRect(origin: origin, size: panelSize)
    }

    static func resultPanelSize(requested: NSSize, visibleFrame: NSRect) -> NSSize {
        let availableWidth = max(1, visibleFrame.width - 16)
        let availableHeight = max(1, visibleFrame.height - 16)
        let width = min(panelSize.width, availableWidth)
        let maximumHeight = min(maximumResultHeight, availableHeight)
        let minimumHeight = min(minimumResultHeight, maximumHeight)
        return NSSize(
            width: width,
            height: min(max(requested.height, minimumHeight), maximumHeight)
        )
    }

    static func anchorPoint(
        for panelFrame: NSRect,
        originAdjustment: NSPoint = .zero
    ) -> NSPoint {
        NSPoint(
            x: panelFrame.minX - cursorOffset.x - originAdjustment.x,
            y: panelFrame.maxY - cursorOffset.y - originAdjustment.y
        )
    }

    static func screen(containing point: NSPoint, screens: [NSScreen] = NSScreen.screens) -> NSScreen? {
        screens.first(where: { NSMouseInRect(point, $0.frame, false) }) ?? screens.first
    }
}
