import Foundation

enum ImageAttachmentError: LocalizedError {
    case tooMany
    case tooLarge
    case combinedTooLarge
    case unsupported
    case clipboardHasNoImage

    var errorDescription: String? {
        switch self {
        case .tooMany: "You can attach up to 8 images."
        case .tooLarge: "Each image must be 16 MB or smaller."
        case .combinedTooLarge: "All images together must be 16 MB or smaller."
        case .unsupported: "Only PNG, JPEG, and WebP images are supported."
        case .clipboardHasNoImage: "The clipboard does not contain a supported image."
        }
    }
}

enum ImageAttachmentValidator {
    static let maximumCount = 8
    static let maximumBytes = 16 * 1024 * 1024
    static let supportedMIMETypes = Set(["image/png", "image/jpeg", "image/webp"])

    static func appending(
        data: Data,
        mimeType: String,
        name: String,
        to current: [DoAnythingImageAttachment]
    ) throws -> [DoAnythingImageAttachment] {
        guard supportedMIMETypes.contains(mimeType) else { throw ImageAttachmentError.unsupported }
        guard current.count < maximumCount else { throw ImageAttachmentError.tooMany }
        guard data.count <= maximumBytes else { throw ImageAttachmentError.tooLarge }

        let attachment = DoAnythingImageAttachment(
            dataURL: "data:\(mimeType);base64,\(data.base64EncodedString())",
            name: name
        )
        let next = current + [attachment]
        let combined = next.reduce(0) { result, attachment in
            result + (DataURLDecoder.decode(attachment.dataURL)?.count ?? maximumBytes + 1)
        }
        guard combined <= maximumBytes else { throw ImageAttachmentError.combinedTooLarge }
        return next
    }
}
