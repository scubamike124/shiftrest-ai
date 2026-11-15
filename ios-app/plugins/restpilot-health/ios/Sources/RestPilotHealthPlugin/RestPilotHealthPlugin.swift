import Foundation
import Capacitor
import HealthKit

/// `window.Capacitor.Plugins.RestPilotHealth` in the app shell.
///
/// Read-only Apple Health access (sleep analysis, HRV SDNN, resting heart rate).
/// Only the app's own pages may call it: the configured server.url host
/// (restpilotai.com) and the shell's bundled local pages. Anything else is refused.
@objc(RestPilotHealthPlugin)
public class RestPilotHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestPilotHealthPlugin"
    public let jsName = "RestPilotHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReadAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSamples", returnType: CAPPluginReturnPromise),
    ]

    private let reader = HealthReader()

    /// True when the page currently in the WebView is one of the app's own.
    /// Limit: Capacitor 6 does not tell a plugin which frame sent a call, so an
    /// iframe inside a trusted page could trigger the permission sheet. Results
    /// only ever go back to the main frame, and RestPilot embeds no iframes.
    private func pageIsTrusted(_ done: @escaping (Bool) -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let bridge = self?.bridge, let url = bridge.webView?.url else { return done(false) }
            let server = bridge.config.serverURL
            let local = bridge.config.localURL
            let same = { (a: URL, b: URL) in a.scheme == b.scheme && a.host == b.host && a.port == b.port }
            done(same(url, server) || same(url, local))
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HealthReader.isAvailable])
    }

    @objc func requestReadAuthorization(_ call: CAPPluginCall) {
        pageIsTrusted { trusted in
            guard trusted else { return call.reject("Not allowed from this page", "NOT_ALLOWED") }
            guard HealthReader.isAvailable else { return call.reject("Apple Health is not available on this device", "UNAVAILABLE") }
            self.reader.requestReadAuthorization { success, error in
                if success {
                    call.resolve(["requested": true])
                } else {
                    call.reject(error?.localizedDescription ?? "Apple Health permission request failed", "AUTH_FAILED")
                }
            }
        }
    }

    @objc func readSamples(_ call: CAPPluginCall) {
        let days = call.getInt("days") ?? 14
        pageIsTrusted { trusted in
            guard trusted else { return call.reject("Not allowed from this page", "NOT_ALLOWED") }
            guard HealthReader.isAvailable else { return call.reject("Apple Health is not available on this device", "UNAVAILABLE") }
            self.reader.readSamples(days: days) { result in
                switch result {
                case .success(let payload): call.resolve(payload)
                case .failure(let error): call.reject(error.localizedDescription, "READ_FAILED")
                }
            }
        }
    }
}
