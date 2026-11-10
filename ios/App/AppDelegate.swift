import UIKit
import FirebaseCore
import FirebaseMessaging
import UserNotifications

/// Configures Firebase and push notifications. This app doesn't target individual
/// devices with a push token — it subscribes to named topics instead (see
/// WebViewController's "pushTopic" message handler and syncPushTopic() in index.html),
/// so there's no per-device token to upload anywhere; this just has to get the device
/// registered with APNs and handed to FirebaseMessaging so topic subscriptions work.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Missing GoogleService-Info.plist (not committed — see ios/README.md) makes this
        // a harmless no-op rather than a crash: the app still works, just without push.
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            DispatchQueue.main.async {
                application.registerForRemoteNotifications()
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("APNs registration failed: \(error)")
    }

    // A business app where a missed invoice/message notification matters even while the
    // app is already open, so foreground pushes still show a banner instead of silently
    // landing only in Notification Center.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        // No-op — topic subscriptions, not per-device tokens, are how this app is
        // targeted (see the comment above).
    }
}
