import SafariServices
import UIKit
import WebKit

/// The site, full screen. Our own pages stay in the app; any other site opens in a Safari sheet. Pull down to
/// refresh, swipe back, a native screen when there's no internet, and files the site hands out (an export) go to the
/// share sheet.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var webView: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .bar)
    private let offline = OfflineView()
    private var progressObservation: NSKeyValueObservation?
    private lazy var bridge = NativeBridge(host: self)
    /// window.open('') first, the address later: kept until they say where they go
    private var popups: [WKWebView] = []
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var failedURL: URL?
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        let paper = UIColor(named: "Paper") ?? .systemBackground
        view.backgroundColor = paper

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // Listening exercises and sounds start without an extra tap
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "Mobile/15E148 IkhimiApp-iOS/\(Config.version)"
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "ikhimi")

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = paper
        web.scrollView.backgroundColor = paper
        web.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        webView = web

        progress.progressTintColor = UIColor(named: "AccentColor")
        progress.trackTintColor = .clear
        progress.alpha = 0

        offline.isHidden = true
        offline.onRetry = { [weak self] in self?.retry() }

        for v in [web, progress, offline] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: safe.topAnchor),
            web.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            progress.topAnchor.constraint(equalTo: safe.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progress.heightAnchor.constraint(equalToConstant: 2),
            offline.topAnchor.constraint(equalTo: view.topAnchor),
            offline.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            offline.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            offline.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        progressObservation = web.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
            let value = Float(web.estimatedProgress)
            DispatchQueue.main.async { self?.showProgress(value) }
        }
    }

    // MARK: Loading

    /// The first page: the app's way in, then `next` (a link or notification that started the app) or the home
    func start(at next: URL?) {
        loadViewIfNeeded()
        started = true
        webView.load(URLRequest(url: Config.entry(next: next)))
    }

    /// A page asked for from outside (a link, a notification)
    func open(_ url: URL) {
        loadViewIfNeeded()
        if !started { return start(at: url) }
        webView.load(URLRequest(url: url))
    }

    @objc private func pullToRefresh() {
        if !offline.isHidden { return retry() }
        webView.reload()
    }

    private func retry() {
        offline.isHidden = true
        let url = failedURL ?? webView.url
        failedURL = nil
        if let url { webView.load(URLRequest(url: url)) } else { start(at: nil) }
    }

    private func showProgress(_ value: Float) {
        progress.setProgress(value, animated: value > progress.progress)
        UIView.animate(withDuration: 0.25, delay: value >= 1 ? 0.2 : 0) {
            self.progress.alpha = value >= 1 ? 0 : 1
        }
    }

    private func finishedLoading() {
        webView.scrollView.refreshControl?.endRefreshing()
    }

    // MARK: Where links go

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
        if ["about", "data", "blob"].contains(scheme) { return decisionHandler(.allow) }

        // A window.open('') that has just been given its address
        if webView !== self.webView {
            popups.removeAll { $0 === webView }
            route(url)
            return decisionHandler(.cancel)
        }
        if scheme == "https" || scheme == "http" {
            if Config.isOurs(url) {
                return decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
            }
            // An embedded player (a lesson's video) stays in its frame
            if let frame = navigationAction.targetFrame, !frame.isMainFrame { return decisionHandler(.allow) }
        }
        route(url)
        decisionHandler(.cancel)
    }

    /// Ours: in the app. Other sites: a Safari sheet. tel:, mailto:, other apps' links: the system.
    private func route(_ url: URL) {
        if Config.isOurs(url) { return open(url) }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "https" || scheme == "http" {
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = UIColor(named: "AccentColor")
            return present(safari, animated: true)
        }
        UIApplication.shared.open(url)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if disposition.lowercased().hasPrefix("attachment") || !navigationResponse.canShowMIMEType {
            return decisionHandler(.download)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finishedLoading()
        offline.isHidden = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    private func failed(_ error: Error) {
        finishedLoading()
        showProgress(1)
        let e = error as NSError
        // Not a real failure: a link handed elsewhere, or a page that turned into a download
        guard e.domain == NSURLErrorDomain, e.code != NSURLErrorCancelled else { return }
        failedURL = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        offline.isHidden = false
    }

    /// iOS ended the page's process (low memory): load it again rather than show a blank screen
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: Windows, dialogs, microphone

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" {
            route(url)
            return nil
        }
        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        popups.append(popup)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        popups.removeAll { $0 === webView }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: L("ok"), style: .default) { _ in completionHandler() })
        if !presentOnTop(alert) { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: L("cancel"), style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: L("ok"), style: .default) { _ in completionHandler(true) })
        if !presentOnTop(alert) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: L("cancel"), style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: L("ok"), style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        if !presentOnTop(alert) { completionHandler(nil) }
    }

    /// Pronunciation practice and dictation: our pages may use the microphone (iOS still asks the person once)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == "https" && Config.isOurs(host: origin.host.lowercased()) ? .grant : .deny)
    }

    @discardableResult
    private func presentOnTop(_ controller: UIViewController) -> Bool {
        var top: UIViewController = self
        while let next = top.presentedViewController { top = next }
        guard view.window != nil, !top.isBeingDismissed else { return false }
        top.present(controller, animated: true)
        return true
    }

    // MARK: Share sheet and downloads

    func share(_ items: [Any]) {
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 80, width: 1, height: 1)
        presentOnTop(sheet)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(suggestedFilename.isEmpty ? "ikhimi" : suggestedFilename)
        downloads[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let file = downloads.removeValue(forKey: ObjectIdentifier(download)) { share([file]) }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }
}

/// A string from Localizable.strings (ko)
func L(_ key: String) -> String {
    NSLocalizedString(key, comment: "")
}
