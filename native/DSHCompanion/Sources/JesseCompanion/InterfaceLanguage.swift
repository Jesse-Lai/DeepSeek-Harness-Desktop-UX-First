import Foundation

enum InterfaceLanguage: String, Equatable, Sendable {
    case simplifiedChinese = "zh-Hans"
    case english = "en"

    static var system: InterfaceLanguage {
        let identifier = Locale.preferredLanguages.first ?? Locale.current.identifier
        return identifier.lowercased().hasPrefix("zh") ? .simplifiedChinese : .english
    }

    static var current: InterfaceLanguage {
        InterfaceLanguagePreference.current.resolvedLanguage
    }

    var locale: Locale {
        Locale(identifier: rawValue)
    }

    func text(_ simplifiedChinese: String, _ english: String) -> String {
        self == .simplifiedChinese ? simplifiedChinese : english
    }
}

enum InterfaceLanguagePreference: String, CaseIterable, Equatable, Sendable {
    case system
    case simplifiedChinese = "zh-Hans"
    case english = "en"

    static let defaultsKey = "interfaceLanguage"

    static var current: InterfaceLanguagePreference {
        guard let value = UserDefaults.standard.string(forKey: defaultsKey),
              let preference = InterfaceLanguagePreference(rawValue: value) else {
            return .system
        }
        return preference
    }

    var resolvedLanguage: InterfaceLanguage {
        switch self {
        case .system: .system
        case .simplifiedChinese: .simplifiedChinese
        case .english: .english
        }
    }

    var menuTag: Int {
        switch self {
        case .system: 0
        case .simplifiedChinese: 1
        case .english: 2
        }
    }

    init?(menuTag: Int) {
        switch menuTag {
        case 0: self = .system
        case 1: self = .simplifiedChinese
        case 2: self = .english
        default: return nil
        }
    }

    func menuTitle(in language: InterfaceLanguage) -> String {
        switch self {
        case .system: language.text("跟随系统", "Follow System")
        case .simplifiedChinese: "中文"
        case .english: "English"
        }
    }

    func save() {
        UserDefaults.standard.set(rawValue, forKey: Self.defaultsKey)
    }
}
