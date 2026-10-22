import AuthenticationServices
import UIKit
import UserNotifications
import WebKit

/// What the page can ask the app for (apps/web/src/lib/ios-app.ts), as
/// `window.webkit.messageHandlers.ikhimi.postMessage({ type })`, which answers with a promise:
/// - `appleSignIn`: Apple's sheet → { identityToken, authorizationCode, fullName } or { canceled: true }
/// - `push`: asks to allow notifications (once) → { token, env } or null
/// - `share`: the share sheet for { url, title }
/// - `haptic`: a tap felt on an answer: { kind: 'success' | 'error' | 'celebrate' }
/// Only our own pages, in the main frame, get an answer.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private weak var host: WebViewController?
    private var appleReply: ((Any?, String?) -> Void)?

    init(host: WebViewController) {
        self.host = host
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "https", Config.isOurs(host: origin.host.lowercased()) else {
            return replyHandler(nil, "not allowed")
        }
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
            return replyHandler(nil, "bad message")
        }
        switch type {
        case "appleSignIn":
            signInWithApple(replyHandler)
        case "push":
            PushRegistrar.shared.register { token in
                replyHandler(token.map { ["token": $0, "env": PushRegistrar.environment] }, nil)
            }
        case "share":
            var items: [Any] = []
            if let text = body["title"] as? String, !text.isEmpty { items.append(text) }
            if let link = (body["url"] as? String).flatMap(URL.init(string:)) { items.append(link) }
            host?.share(items)
            replyHandler(true, nil)
        case "haptic":
            let feedback = UINotificationFeedbackGenerator()
            switch body["kind"] as? String {
            case "success": feedback.notificationOccurred(.success)
            case "error": feedback.notificationOccurred(.error)
            default: UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
            replyHandler(true, nil)
        default:
            replyHandler(nil, "unknown message")
        }
    }

    // MARK: Sign in with Apple

    private func signInWithApple(_ reply: @escaping (Any?, String?) -> Void) {
        // A second tap while the sheet is up: the first one is over
        finishApple(["canceled": true], nil)
        appleReply = reply
        let request = ASAuthorizationAppleIDProvider().createRequest()
        // Only the name (Apple gives it the first time); no e-mail is asked for
        request.requestedScopes = [.fullName]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8)
        else { return finishApple(nil, "no identity token") }
        var result: [String: Any] = ["identityToken": identityToken]
        if let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) {
            result["authorizationCode"] = code
        }
        if let name = credential.fullName {
            let text = PersonNameComponentsFormatter.localizedString(from: name, style: .default).trimmingCharacters(in: .whitespaces)
            if !text.isEmpty { result["fullName"] = text }
        }
        finishApple(result, nil)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if (error as? ASAuthorizationError)?.code == .canceled {
            finishApple(["canceled": true], nil)
        } else {
            finishApple(nil, error.localizedDescription)
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        host?.view.window ?? UIWindow()
    }

    private func finishApple(_ value: Any?, _ error: String?) {
        let reply = appleReply
        appleReply = nil
        reply?(value, error)
    }
}

/// The device token for push notifications (APNs), handed to the page, which registers it with the server
final class PushRegistrar {
    static let shared = PushRegistrar()

    /// Which APNs the token belongs to: builds run from Xcode use the sandbox; TestFlight and the App Store production
    #if DEBUG
    static let environment = "sandbox"
    #else
    static let environment = "production"
    #endif

    private var token: String?
    private var waiting: [(String?) -> Void] = []

    /// Asks to allow notifications the first time (iOS remembers the answer); then the token, or nil when they're off
    func register(_ done: @escaping (String?) -> Void) {
        if let token { return done(token) }
        waiting.append(done)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            DispatchQueue.main.async {
                if granted { UIApplication.shared.registerForRemoteNotifications() } else { PushRegistrar.shared.finish(nil) }
            }
        }
    }

    /// At launch: notifications were allowed before, so fetch the (possibly new) token without asking
    func refreshIfAllowed() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(_ deviceToken: Data) {
        let value = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = value
        finish(value)
    }

    func didFail() {
        finish(nil)
    }

    private func finish(_ value: String?) {
        let list = waiting
        waiting = []
        list.forEach { $0(value) }
    }
}
