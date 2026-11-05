import CoreGraphics
import XCTest
@testable import JesseCompanion

final class ScreenshotGeometryTests: XCTestCase {
    func testConvertsBottomLeftAppKitCoordinatesToTopLeftQuartzCoordinates() {
        let converted = ScreenshotGeometry.quartzRect(
            screenRect: CGRect(x: 100, y: 500, width: 320, height: 180),
            screenFrame: CGRect(x: 0, y: 0, width: 1440, height: 900),
            displayBounds: CGRect(x: 0, y: 0, width: 1440, height: 900)
        )
        XCTAssertEqual(converted, CGRect(x: 100, y: 220, width: 320, height: 180))
    }

    func testPreservesSecondaryDisplayOffsetWithoutRetinaScaling() {
        let converted = ScreenshotGeometry.quartzRect(
            screenRect: CGRect(x: 1500, y: 200, width: 200, height: 100),
            screenFrame: CGRect(x: 1440, y: -100, width: 1920, height: 1080),
            displayBounds: CGRect(x: 1440, y: 0, width: 1920, height: 1080)
        )
        XCTAssertEqual(converted, CGRect(x: 1500, y: 680, width: 200, height: 100))
    }

    func testCapsLargeRetinaCaptureWithoutChangingAspectRatio() {
        let output = ScreenshotGeometry.outputSize(
            sourceRect: CGRect(x: 0, y: 0, width: 3_840, height: 2_160),
            displayScale: 2
        )

        XCTAssertEqual(output.width, 4_096)
        XCTAssertEqual(output.height, 2_304)
    }

    func testKeepsSmallCaptureAtNativeRetinaSize() {
        let output = ScreenshotGeometry.outputSize(
            sourceRect: CGRect(x: 0, y: 0, width: 800, height: 600),
            displayScale: 2
        )

        XCTAssertEqual(output.width, 1_600)
        XCTAssertEqual(output.height, 1_200)
    }

    func testMeasuresDisplayIntersectionArea() {
        let area = ScreenshotGeometry.intersectionArea(
            CGRect(x: 0, y: 0, width: 100, height: 100),
            CGRect(x: 80, y: 20, width: 50, height: 50)
        )

        XCTAssertEqual(area, 1_000)
    }
}
