import Carbon
import Foundation
import OSLog

final class GlobalHotKey {
    private static let logger = Logger(subsystem: "com.jesselai.dsh.companion", category: "hotkey")
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private let handler: () -> Void
    private(set) var registrationStatus: OSStatus = OSStatus(eventInternalErr)

    var isRegistered: Bool {
        registrationStatus == noErr && hotKeyRef != nil && eventHandlerRef != nil
    }

    init(keyCode: UInt32, modifiers: UInt32, handler: @escaping () -> Void) {
        self.handler = handler

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let callback: EventHandlerUPP = { _, _, userData in
            guard let userData else { return noErr }
            let instance = Unmanaged<GlobalHotKey>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async {
                GlobalHotKey.logger.notice("Global hotkey callback received")
                instance.handler()
            }
            return noErr
        }

        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            callback,
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandlerRef
        )
        guard handlerStatus == noErr else {
            registrationStatus = handlerStatus
            Self.logger.error("Failed to install hotkey handler: \(handlerStatus)")
            return
        }

        let hotKeyID = EventHotKeyID(signature: Self.signature, id: 1)
        registrationStatus = RegisterEventHotKey(
            keyCode,
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        if registrationStatus != noErr, let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
            self.eventHandlerRef = nil
        }
        Self.logger.notice("Hotkey registration completed with status: \(self.registrationStatus)")
    }

    deinit {
        unregister()
    }

    func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
            self.eventHandlerRef = nil
        }
    }

    private static let signature: OSType = {
        let scalars = Array("JESS".utf8)
        return scalars.reduce(0) { ($0 << 8) | OSType($1) }
    }()
}
