import SwiftUI
import XCTest
@testable import JesseCompanion

final class RingHoverGlowMaskShapeTests: XCTestCase {
    private let rect = CGRect(x: 0, y: 0, width: 370, height: 370)
    private let actionCount = 4
    private let holeDiameter: CGFloat = 160

    func testGlowMaskContainsOnlyTheHoveredSector() {
        let hoveredIndex = 1
        let path = glowMaskPath(index: hoveredIndex)

        for index in 0..<actionCount {
            XCTAssertEqual(
                path.contains(sectorCenter(index: index)),
                index == hoveredIndex
            )
        }
    }

    func testGlowMaskPreservesTheCenterHole() {
        let center = CGPoint(x: rect.midX, y: rect.midY)

        XCTAssertFalse(glowMaskPath(index: 0).contains(center))
    }

    private func glowMaskPath(index: Int) -> Path {
        RingSectorShape(
            index: index,
            actionCount: actionCount,
            holeDiameter: holeDiameter
        ).path(in: rect)
    }

    private func sectorCenter(index: Int) -> CGPoint {
        let angle = CGFloat.pi + CGFloat(index) * 2 * .pi / CGFloat(actionCount)
        let radius = (rect.width + holeDiameter) / 4
        return CGPoint(
            x: rect.midX + cos(angle) * radius,
            y: rect.midY + sin(angle) * radius
        )
    }
}
