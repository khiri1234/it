import SwiftUI

@main
struct TheHApp: App {
    // Firebase configuration + APNs/push setup needs a classic UIApplicationDelegate
    // hook (didFinishLaunchingWithOptions, didRegisterForRemoteNotifications...) —
    // SwiftUI's App protocol has no equivalent of its own, so it's bridged in here.
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
        }
    }
}
