import Foundation
import XCTest
@testable import JesseCompanion

final class DataURLDecoderTests: XCTestCase {
    func testDecodesBase64Payload() {
        let value = "data:text/plain;base64," + Data("hello".utf8).base64EncodedString()

        XCTAssertEqual(DataURLDecoder.decode(value), Data("hello".utf8))
    }

    func testRejectsMalformedOrNonBase64URL() {
        XCTAssertNil(DataURLDecoder.decode("data:text/plain,hello"))
        XCTAssertNil(DataURLDecoder.decode("not-a-data-url"))
    }
}
