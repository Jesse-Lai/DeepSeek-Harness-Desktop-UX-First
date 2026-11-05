import AppKit
import XCTest
@testable import JesseCompanion

final class RingGeometryTests: XCTestCase {
    func testPlacesPanelBesideCursorWhenThereIsRoom() {
        let frame = RingGeometry.frame(
            near: NSPoint(x: 500, y: 700),
            visibleFrame: NSRect(x: 0, y: 0, width: 1440, height: 900)
        )
        XCTAssertEqual(frame.origin.x, 501)
        XCTAssertEqual(frame.origin.y, 109)
        XCTAssertEqual(frame.size, RingGeometry.panelSize)
    }

    func testClampsPanelInsideAllScreenEdges() {
        let visible = NSRect(x: 100, y: 50, width: 800, height: 700)
        let topRight = RingGeometry.frame(near: NSPoint(x: 890, y: 745), visibleFrame: visible)
        XCTAssertLessThanOrEqual(topRight.maxX, visible.maxX - 8)
        XCTAssertLessThanOrEqual(topRight.maxY, visible.maxY - 8)

        let bottomLeft = RingGeometry.frame(near: NSPoint(x: 101, y: 51), visibleFrame: visible)
        XCTAssertGreaterThanOrEqual(bottomLeft.minX, visible.minX + 8)
        XCTAssertGreaterThanOrEqual(bottomLeft.minY, visible.minY + 8)
    }

    func testNativeSurfaceGeometry() {
        let bounds = NSRect(origin: .zero, size: RingGeometry.panelSize)

        XCTAssertEqual(RingGeometry.ringFrame(in: bounds), NSRect(x: 76, y: 111, width: 370, height: 370))
        XCTAssertEqual(RingGeometry.ringHoleFrame(in: bounds), NSRect(x: 181, y: 216, width: 160, height: 160))
        XCTAssertEqual(RingGeometry.popoverFrame(in: bounds), NSRect(x: 40, y: 40, width: 442, height: 512))
    }

    func testPopoverWindowPreservesContentSizeAndClearsShadowTail() {
        let frame = RingGeometry.popoverFrame(
            in: NSRect(origin: .zero, size: RingGeometry.panelSize)
        )
        let estimatedShadowTail = RingGeometry.popoverShadowRadius * 3
            + abs(RingGeometry.popoverShadowYOffset)
        let liquidGlassShadowTail: CGFloat = 40

        XCTAssertEqual(frame.size, RingGeometry.popoverContentSize)
        XCTAssertGreaterThan(RingGeometry.popoverInset, estimatedShadowTail)
        XCTAssertGreaterThanOrEqual(RingGeometry.popoverInset, liquidGlassShadowTail)
        XCTAssertEqual(
            RingGeometry.compactResultHeight - RingGeometry.popoverInset * 2,
            RingGeometry.compactResultContentHeight
        )
    }

    func testExpandedPopoverShadowClearancePreservesVisiblePanelPlacement() {
        let cursor = NSPoint(x: 500, y: 700)
        let visible = NSRect(x: 0, y: 0, width: 2_000, height: 1_500)
        let previousWindowFrame = RingGeometry.frame(
            near: cursor,
            visibleFrame: visible,
            panelSize: RingGeometry.popoverPlacementSize
        )
        let expandedWindowFrame = RingGeometry.frame(
            near: cursor,
            visibleFrame: visible,
            panelSize: RingGeometry.panelSize,
            originAdjustment: RingGeometry.popoverPanelOriginAdjustment
        )

        XCTAssertEqual(
            previousWindowFrame.insetBy(
                dx: RingGeometry.popoverAnchorInset,
                dy: RingGeometry.popoverAnchorInset
            ),
            RingGeometry.popoverFrame(in: expandedWindowFrame)
        )
    }

    func testRingSpecScalesWithVisibleActionCount() {
        let full = RingGeometry.ringSpec(for: 8)
        XCTAssertEqual(full.scale, 1, accuracy: 0.000_001)
        XCTAssertEqual(full.holeScale, 1, accuracy: 0.000_001)
        XCTAssertEqual(full.panelSize, NSSize(width: 550, height: 550))
        XCTAssertEqual(full.ringDiameter, RingGeometry.ringDiameter)
        XCTAssertEqual(full.ringHoleDiameter, RingGeometry.ringHoleDiameter)

        let minimum = RingGeometry.ringSpec(for: 3)
        XCTAssertEqual(minimum.scale, 0.6, accuracy: 0.000_001)
        XCTAssertEqual(minimum.holeScale, 0.30, accuracy: 0.000_001)
        XCTAssertEqual(minimum.ringDiameter, 222, accuracy: 0.000_001)
        XCTAssertEqual(minimum.ringHoleDiameter, 48, accuracy: 0.000_001)

        let compact = RingGeometry.ringSpec(for: 4)
        XCTAssertEqual(compact.scale, 0.6, accuracy: 0.000_001)
        XCTAssertEqual(compact.holeScale, 0.10, accuracy: 0.000_001)
        XCTAssertEqual(compact.panelSize.width, 402, accuracy: 0.000_001)
        XCTAssertEqual(compact.panelSize.height, 402, accuracy: 0.000_001)
        XCTAssertEqual(compact.ringDiameter, 222, accuracy: 0.000_001)
        XCTAssertEqual(compact.ringHoleDiameter, 16, accuracy: 0.000_001)

        let middle = RingGeometry.ringSpec(for: 6)
        XCTAssertEqual(middle.scale, 0.8, accuracy: 0.000_001)
        XCTAssertEqual(middle.holeScale, 0.55, accuracy: 0.000_001)
        XCTAssertEqual(middle.ringHoleDiameter, 88, accuracy: 0.000_001)
    }

    func testActionLabelMetricsDoNotScaleWithVisibleActionCount() {
        XCTAssertNotEqual(
            RingGeometry.ringSpec(for: 4).ringDiameter,
            RingGeometry.ringSpec(for: 8).ringDiameter
        )
        XCTAssertEqual(RingGeometry.actionDiameter, 72)
        XCTAssertEqual(RingGeometry.actionIconSize, 21)
        XCTAssertEqual(RingGeometry.actionIconFrame, 25)
        XCTAssertEqual(RingGeometry.actionTitleSize, 12)
        XCTAssertEqual(RingGeometry.actionTitleMaxWidth, 64)
        XCTAssertEqual(RingGeometry.actionLabelSpacing, 5)
    }

    func testRingPanelLeavesShadowClearanceOnEveryEdge() {
        for actionCount in [3, 4, 6, 8] {
            let spec = RingGeometry.ringSpec(for: actionCount)
            let ring = RingGeometry.ringFrame(
                in: NSRect(origin: .zero, size: spec.panelSize),
                spec: spec
            )

            XCTAssertEqual(ring.minX, spec.ringShadowClearance)
            XCTAssertEqual(ring.minY, spec.ringShadowClearance)
            XCTAssertEqual(spec.panelSize.width - ring.maxX, spec.ringShadowClearance)
            XCTAssertEqual(spec.panelSize.height - ring.maxY, spec.ringShadowClearance)
            XCTAssertEqual(spec.ringShadowClearance, RingGeometry.ringShadowClearance)
        }
    }

    func testExpandedRingPanelPreservesUnclampedRingCenter() {
        let cursor = NSPoint(x: 500, y: 700)
        let visible = NSRect(x: 0, y: 0, width: 2_000, height: 1_500)

        for actionCount in [4, 6, 8] {
            let spec = RingGeometry.ringSpec(for: actionCount)
            let previousSize = NSSize(
                width: RingGeometry.popoverPlacementSize.width * spec.scale,
                height: RingGeometry.popoverPlacementSize.height * spec.scale
            )
            let previousFrame = RingGeometry.frame(
                near: cursor,
                visibleFrame: visible,
                panelSize: previousSize
            )
            let expandedFrame = RingGeometry.frame(
                near: cursor,
                visibleFrame: visible,
                panelSize: spec.panelSize,
                originAdjustment: RingGeometry.ringPanelOriginAdjustment(for: spec)
            )

            XCTAssertEqual(previousFrame.midX, expandedFrame.midX)
            XCTAssertEqual(previousFrame.midY, expandedFrame.midY)
        }
    }

    func testAnnularSectorActionHitTargetsFollowRingLayout() {
        let bounds = NSRect(origin: .zero, size: RingGeometry.panelSize)
        let ring = RingGeometry.ringFrame(in: bounds)
        let innerRadius = RingGeometry.ringHoleDiameter / 2
        let outerRadius = RingGeometry.ringDiameter / 2

        XCTAssertEqual(RingGeometry.actionSectorAngle, .pi / 4, accuracy: 0.000_001)

        for index in 0..<RingGeometry.actionCount {
            let center = RingGeometry.actionCenter(for: index, in: bounds)
            XCTAssertEqual(RingGeometry.actionIndex(at: center, in: bounds), index)

            let angle = CGFloat.pi - CGFloat(index) * RingGeometry.actionSectorAngle
            for radius in [innerRadius + 0.1, outerRadius - 0.1] {
                let point = NSPoint(
                    x: ring.midX + cos(angle) * radius,
                    y: ring.midY + sin(angle) * radius
                )
                XCTAssertTrue(RingGeometry.actionSectorContains(point, index: index, in: bounds))
            }

            let adjacentIndex = (index + 1) % RingGeometry.actionCount
            let adjacentCenter = RingGeometry.actionCenter(for: adjacentIndex, in: bounds)
            XCTAssertFalse(RingGeometry.actionSectorContains(adjacentCenter, index: index, in: bounds))
        }

        XCTAssertNil(RingGeometry.actionIndex(at: NSPoint(x: ring.midX, y: ring.midY), in: bounds))
        XCTAssertNil(
            RingGeometry.actionIndex(
                at: NSPoint(x: ring.midX + innerRadius - 0.1, y: ring.midY),
                in: bounds
            )
        )
        XCTAssertNil(
            RingGeometry.actionIndex(
                at: NSPoint(x: ring.midX + outerRadius + 0.1, y: ring.midY),
                in: bounds
            )
        )
        XCTAssertNil(RingGeometry.actionIndex(at: NSPoint(x: bounds.minX, y: bounds.minY), in: bounds))
    }

    func testReducedActionCountsStillDivideTheRingEvenly() {
        let bounds = NSRect(origin: .zero, size: RingGeometry.panelSize)
        let center = NSPoint(x: bounds.midX, y: bounds.midY)
        for actionCount in [3, 4] {
            XCTAssertEqual(
                RingGeometry.actionSectorAngle(for: actionCount),
                2 * .pi / CGFloat(actionCount),
                accuracy: 0.000_001
            )

            for index in 0..<actionCount {
                let center = RingGeometry.actionCenter(for: index, in: bounds, actionCount: actionCount)
                XCTAssertEqual(
                    RingGeometry.actionIndex(at: center, in: bounds, actionCount: actionCount),
                    index
                )
            }

            XCTAssertNil(RingGeometry.actionIndex(at: center, in: bounds, actionCount: actionCount))
        }
        XCTAssertNil(RingGeometry.actionIndex(at: center, in: bounds, actionCount: 0))
    }

    func testSummaryUsesPageContextWhenThereIsNoSelection() {
        XCTAssertEqual(
            CompanionAction.available(hasSelection: false),
            [.ask, .summarize, .screenshot]
        )
        XCTAssertEqual(
            CompanionAction.available(hasSelection: true),
            [.ask, .polish, .translate, .summarize, .screenshot, .image]
        )
        XCTAssertFalse(CompanionAction.summarize.requiresSelection)
    }

    func testSwiftUIHoverCoordinatesMapToTheCorrectSector() {
        let bounds = NSRect(
            origin: .zero,
            size: NSSize(width: RingGeometry.ringDiameter, height: RingGeometry.ringDiameter)
        )

        for index in 0..<RingGeometry.actionCount {
            let appKitPoint = RingGeometry.actionCenter(for: index, in: bounds)
            let swiftUIPoint = CGPoint(x: appKitPoint.x, y: bounds.maxY - appKitPoint.y)
            XCTAssertEqual(
                RingGeometry.actionIndex(atSwiftUIPoint: swiftUIPoint, in: bounds),
                index
            )
        }

        XCTAssertNil(
            RingGeometry.actionIndex(
                atSwiftUIPoint: CGPoint(x: bounds.midX, y: bounds.midY),
                in: bounds
            )
        )
    }

    func testActionHoverBackgroundIsCenteredWithinRingThickness() {
        let outerRadius = RingGeometry.ringDiameter / 2
        let innerRadius = RingGeometry.ringHoleDiameter / 2
        let actionRadius = RingGeometry.actionDiameter / 2
        let outerClearance = outerRadius - RingGeometry.actionOrbitRadius - actionRadius
        let innerClearance = RingGeometry.actionOrbitRadius - actionRadius - innerRadius

        XCTAssertEqual(RingGeometry.actionOrbitRadius, (outerRadius + innerRadius) / 2)
        XCTAssertEqual(outerClearance, innerClearance)
        XCTAssertEqual(outerClearance, 16.5)
    }

    func testCompactRingKeepsLabelsInsideRingThickness() {
        for actionCount in [3, 4] {
            let compact = RingGeometry.ringSpec(for: actionCount)
            let outerRadius = compact.ringDiameter / 2
            let innerRadius = compact.ringHoleDiameter / 2
            let actionRadius = RingGeometry.actionDiameter / 2
            let outerClearance = outerRadius - compact.actionOrbitRadius - actionRadius
            let innerClearance = compact.actionOrbitRadius - actionRadius - innerRadius

            XCTAssertEqual(compact.actionOrbitRadius, (outerRadius + innerRadius) / 2)
            XCTAssertEqual(outerClearance, innerClearance, accuracy: 0.000_001)
            XCTAssertGreaterThanOrEqual(outerClearance, 6)
        }
    }

    func testResultPanelHeightTracksContentWithinBounds() {
        let visible = NSRect(x: 0, y: 0, width: 1440, height: 900)

        XCTAssertEqual(
            RingGeometry.resultPanelSize(
                requested: NSSize(width: RingGeometry.panelSize.width, height: 220),
                visibleFrame: visible
            ),
            NSSize(width: RingGeometry.panelSize.width, height: 220)
        )
        XCTAssertEqual(
            RingGeometry.resultPanelSize(
                requested: NSSize(width: RingGeometry.panelSize.width, height: 40),
                visibleFrame: visible
            ).height,
            RingGeometry.minimumResultHeight
        )
        XCTAssertEqual(
            RingGeometry.resultPanelSize(
                requested: NSSize(width: RingGeometry.panelSize.width, height: 900),
                visibleFrame: visible
            ).height,
            RingGeometry.maximumResultHeight
        )
    }

    func testResultPanelSizeFitsSmallVisibleFrame() {
        let size = RingGeometry.resultPanelSize(
            requested: RingGeometry.panelSize,
            visibleFrame: NSRect(x: 0, y: 0, width: 420, height: 300)
        )

        XCTAssertEqual(size, NSSize(width: 404, height: 284))
    }

    func testDraggedPanelAnchorPreservesTopEdgeWhenHeightChanges() {
        let original = NSRect(x: 320, y: 240, width: 470, height: 300)
        let anchor = RingGeometry.anchorPoint(for: original)
        let resized = RingGeometry.frame(
            near: anchor,
            visibleFrame: NSRect(x: 0, y: 0, width: 1600, height: 1000),
            panelSize: NSSize(width: 470, height: 480)
        )

        XCTAssertEqual(resized.minX, original.minX)
        XCTAssertEqual(resized.maxY, original.maxY)
    }

    func testAdjustedPopoverAnchorRoundTripsAfterDragging() {
        let cursor = NSPoint(x: 500, y: 700)
        let frame = RingGeometry.frame(
            near: cursor,
            visibleFrame: NSRect(x: 0, y: 0, width: 2_000, height: 1_500),
            panelSize: RingGeometry.panelSize,
            originAdjustment: RingGeometry.popoverPanelOriginAdjustment
        )

        XCTAssertEqual(
            RingGeometry.anchorPoint(
                for: frame,
                originAdjustment: RingGeometry.popoverPanelOriginAdjustment
            ),
            cursor
        )
    }
}
