import UIKit
import VueNativeCore

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = AppViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

class AppViewController: VueNativeViewController {
    override var bundleName: String { "vue-native-bundle" }

    #if DEBUG
    /// Injected at build time from the DEV_SERVER_URL build setting, which
    /// `vue-native run ios --port` overrides on the xcodebuild command line.
    /// The Info.plist value is `$(DEV_SERVER_URL)`, so it expands to whatever
    /// the build was given; the literal fallback keeps hand-written hosts and
    /// projects scaffolded before this setting existed working.
    override var devServerURL: URL? {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "VueNativeDevServerURL") as? String,
           !configured.isEmpty,
           let url = URL(string: configured) {
            return url
        }
        return URL(string: "ws://localhost:8174")
    }
    #endif
}
