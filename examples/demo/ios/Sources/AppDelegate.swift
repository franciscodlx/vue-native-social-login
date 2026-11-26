import UIKit
import VueNativeCoreSVG

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // <VSVG> ships in the optional VueNativeCoreSVG product so an app that
        // never renders an SVG does not have to link SVGKit. Registering here —
        // before the scene builds the VueNativeViewController that mounts the
        // bundle — is what makes <VSVG> resolve to a real view. Without it the
        // framework logs an error naming this product and renders nothing.
        // Delete this call (and the product from ios/project.yml) if unused.
        VueNativeCoreSVG.register()
        return true
    }

    // MARK: UISceneSession Lifecycle
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
    }
}
