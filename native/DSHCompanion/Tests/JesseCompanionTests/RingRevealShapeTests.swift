import SwiftUI
import XCTest
@testable import JesseCompanion

final class RingRevealShapeTests: XCTestCase {
    private let rect = CGRect(x: 0, y: 0, width: 370, height: 370)

    func testZeroProgressDrawsNoRing() {
        let path = RingRevealShape(holeDiameter: 160, progress: 0).path(in: rect)

        XCTAssertTrue(path.isEmpty)
    }

    func testFullProgressPreservesOuterBoundsAndCenterHole() {
        let path = RingRevealShape(holeDiameter: 160, progress: 1).path(in: rect)

        XCTAssertEqual(path.boundingRect.minX, rect.minX, accuracy: 0.001)
        XCTAssertEqual(path.boundingRect.minY, rect.minY, accuracy: 0.001)
        XCTAssertEqual(path.boundingRect.maxX, rect.maxX, accuracy: 0.001)
        XCTAssertEqual(path.boundingRect.maxY, rect.maxY, accuracy: 0.001)
        XCTAssertFalse(path.contains(CGPoint(x: rect.midX, y: rect.midY)))
        XCTAssertTrue(path.contains(CGPoint(x: rect.midX, y: 40)))
    }

    func testQuarterProgressDrawsClockwiseAcrossTheTop() {
        let path = RingRevealShape(holeDiameter: 160, progress: 0.25).path(in: rect)

        XCTAssertTrue(path.contains(centerlinePoint(degrees: -120)))
        XCTAssertTrue(path.contains(centerlinePoint(degrees: -90)))
        XCTAssertTrue(path.contains(centerlinePoint(degrees: -60)))
        XCTAssertFalse(path.contains(centerlinePoint(degrees: 0)))
        XCTAssertFalse(path.contains(centerlinePoint(degrees: 90)))
        XCTAssertFalse(path.contains(centerlinePoint(degrees: 180)))
    }

    func testPartialRevealUsesLargeRoundCapsAtBothEnds() {
        let path = RingRevealShape(holeDiameter: 160, progress: 0.25).path(in: rect)

        XCTAssertTrue(path.contains(centerlinePoint(degrees: -140)))
        XCTAssertTrue(path.contains(centerlinePoint(degrees: -40)))
        XCTAssertFalse(path.contains(centerlinePoint(degrees: -170)))
        XCTAssertFalse(path.contains(centerlinePoint(degrees: 0)))
    }

    func testActionRevealTimingFollowsTheClockwiseSweep() {
        let fractions = (0..<4).map {
            RingAppearance.actionRevealFraction(index: $0, actionCount: 4)
        }

        XCTAssertEqual(fractions[1], 0.125, accuracy: 0.001)
        XCTAssertEqual(fractions[2], 0.375, accuracy: 0.001)
        XCTAssertEqual(fractions[3], 0.625, accuracy: 0.001)
        XCTAssertEqual(fractions[0], 0.875, accuracy: 0.001)
        XCTAssertEqual(
            RingAppearance.actionRevealDelay(index: 0, actionCount: 4)
                + RingAppearance.actionEntranceDuration,
            RingAppearance.entranceDuration,
            accuracy: 0.001
        )
    }

    private func centerlinePoint(degrees: CGFloat) -> CGPoint {
        let radians = degrees * .pi / 180
        let centerlineRadius: CGFloat = (370 + 160) / 4
        return CGPoint(
            x: rect.midX + cos(radians) * centerlineRadius,
            y: rect.midY + sin(radians) * centerlineRadius
        )
    }
}
