import AVFoundation
import UIKit
import UserNotifications

/// 익히미 for iPhone: the website (Config.host) in a native shell, with Sign in with Apple, notifications, the camera
/// and microphone, the share sheet, downloads and links that open in the app. See apps/ios/README.md.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Listening exercises play even with the ring/silent switch on silent
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        // Notifications allowed before: the device token can change, so ask for it again
        PushRegistrar.shared.refreshIfAllowed()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistrar.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRegistrar.shared.didFail()
    }

    /// A notification while the app is open: show it anyway
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    /// Tapped a notification: open its page (server: push.ts sends `url`, e.g. /t/<slug>)
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let path = response.notification.request.content.userInfo["url"] as? String, let url = Config.url(path) {
            Router.shared.open(url)
        }
        completionHandler()
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // Started by a link to the site (universal link): open that page instead of the home
        for activity in connectionOptions.userActivities { handle(activity) }
        let web = WebViewController()
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = web
        window.makeKeyAndVisible()
        self.window = window
        Router.shared.attach(web)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        handle(userActivity)
    }

    private func handle(_ activity: NSUserActivity) {
        guard activity.activityType == NSUserActivityTypeBrowsingWeb, let url = activity.webpageURL, Config.isOurs(url) else { return }
        Router.shared.open(url)
    }
}

/// Where the site lives (build setting IKHIMI_HOST → Info.plist IkhimiHost) and which addresses are ours
enum Config {
    static let host: String = {
        let value = (Bundle.main.object(forInfoDictionaryKey: "IkhimiHost") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return value.isEmpty ? "ikhimi.kr" : value.lowercased()
    }()

    static let origin = URL(string: "https://\(host)")!

    static let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "1.0"

    /// The app's way in: marks this device as the iOS app (no purchases shown, Sign in with Apple), then opens `next`
    static func entry(next: URL? = nil) -> URL {
        var parts = URLComponents(url: origin.appendingPathComponent("open/ios"), resolvingAgainstBaseURL: false)!
        if let path = next?.path, path.count > 1 { parts.queryItems = [URLQueryItem(name: "next", value: path)] }
        return parts.url!
    }

    /// A path from a notification ("/t/abc") or a full address of ours
    static func url(_ pathOrURL: String) -> URL? {
        if pathOrURL.hasPrefix("/") { return URL(string: pathOrURL, relativeTo: origin)?.absoluteURL }
        guard let url = URL(string: pathOrURL), isOurs(url) else { return nil }
        return url
    }

    static func isOurs(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let h = url.host?.lowercased() else { return false }
        return isOurs(host: h)
    }

    static func isOurs(host h: String) -> Bool {
        h == host || h.hasSuffix(".\(host)")
    }
}

/// Opens pages asked for from outside the web view (links, notifications), also before the web view exists
@MainActor
final class Router {
    static let shared = Router()
    private weak var web: WebViewController?
    private var pending: URL?

    func attach(_ web: WebViewController) {
        self.web = web
        web.start(at: pending)
        pending = nil
    }

    func open(_ url: URL) {
        if let web { web.open(url) } else { pending = url }
    }
}
