import SwiftUI

struct ContentView: View {
    var body: some View {
        WebViewContainer()
            .ignoresSafeArea()
    }
}

/// Bridges the UIKit-based WebViewController into SwiftUI.
struct WebViewContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController()
    }

    func updateUIViewController(_ uiViewController: WebViewController, context: Context) {
        // The web app is a single-page app that manages all of its own navigation —
        // nothing here ever needs to push new state into the web view.
    }
}
