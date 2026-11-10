import UIKit
import WebKit
import LocalAuthentication
import FirebaseMessaging

/// Hosts the live web app (https://app.hatef.cc) inside a single, full-bleed WKWebView.
///
/// Deliberately NOT bundled into the binary the way the desktop Electron wrapper bundles
/// index.html: this web app ships constantly (every change in this repo deploys straight
/// to GitHub Pages on merge to main — see .github/workflows/deploy-pages.yml), so loading
/// it live means every user is always on the latest version with no app-update/App Store
/// review cycle in the way. Bundling it would mean a native rebuild + resubmission for
/// every web-only change, which defeats the point of shipping this fast.
///
/// This wrapper's only real job is the two things a WKWebView can't do on its own: Face ID
/// and push-notification topic subscriptions. The web app already has both sides of this
/// bridge built in (requestBiometricLogin() / syncPushTopic() in index.html, gated behind
/// isWrappedApp() = window.webkit && window.webkit.messageHandlers) — it was written
/// expecting exactly this wrapper to exist.
final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private static let appURL = URL(string: "https://app.hatef.cc/index.html")!
    // Matches desktop/main.js's BrowserWindow backgroundColor, so the native chrome and
    // the web app's own dark app shell don't flash a mismatched color during load.
    private static let shellBackground = UIColor(red: 11/255, green: 18/255, blue: 32/255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.shellBackground

        let contentController = WKUserContentController()
        contentController.add(self, name: "faceID")
        contentController.add(self, name: "pushTopic")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // Let the page's own env(safe-area-inset-*) CSS (already in index.html's .topbar/
        // .tabbar rules) handle notch/home-indicator spacing — UIKit's automatic content
        // inset would otherwise double it up.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = Self.shellBackground
        webView.scrollView.backgroundColor = Self.shellBackground

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        webView.load(URLRequest(url: Self.appURL))
    }

    private func callJS(_ js: String) {
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}

// MARK: - WKScriptMessageHandler — the faceID / pushTopic bridge the web app already calls
extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "faceID":
            handleFaceIDRequest()
        case "pushTopic":
            handlePushTopicRequest(message.body)
        default:
            break
        }
    }

    // index.html posts the literal string 'unlock' and expects a callback into
    // window.__faceIDUnlock() on success or window.__faceIDFailed('message') otherwise —
    // see requestBiometricLogin() in index.html.
    private func handleFaceIDRequest() {
        let context = LAContext()
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &policyError) else {
            callJS("__faceIDFailed('Face ID isn’t set up on this device.')")
            return
        }
        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Unlock THE H BUSINESS MANAGEMENT"
        ) { [weak self] success, evaluateError in
            DispatchQueue.main.async {
                guard let self else { return }
                if success {
                    self.callJS("__faceIDUnlock()")
                } else {
                    let cancelled = (evaluateError as NSError?)?.code == LAError.userCancel.rawValue
                    let message = cancelled ? "Face ID cancelled" : "Face ID failed — tap to try again"
                    self.callJS("__faceIDFailed('\(message)')")
                }
            }
        }
    }

    // {action: "subscribe"|"unsubscribe", topic: "..."} — see syncPushTopic() in index.html.
    private func handlePushTopicRequest(_ body: Any) {
        guard let dict = body as? [String: Any],
              let action = dict["action"] as? String,
              let topic = dict["topic"] as? String else { return }
        switch action {
        case "subscribe": Messaging.messaging().subscribe(toTopic: topic)
        case "unsubscribe": Messaging.messaging().unsubscribe(fromTopic: topic)
        default: break
        }
    }
}

// MARK: - WKNavigationDelegate — stay on the app's own origin; hand off everything else
// (wa.me / paypal.me links) to Safari, same behavior as the desktop app's
// setWindowOpenHandler in desktop/main.js.
extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let isExternalLinkTap = url.host != Self.appURL.host && navigationAction.navigationType == .linkActivated
        if isExternalLinkTap {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

// MARK: - WKUIDelegate — route window.open() to Safari (same reasoning as above), and
// silently grant camera access for the barcode/QR scanner once iOS's own one-time system
// prompt has already been accepted, mirroring the desktop app's permission handler for
// the same feature (session.defaultSession.setPermissionRequestHandler in desktop/main.js).
extension WebViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }
}
