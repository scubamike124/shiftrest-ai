import XCTest

/// Drives the real RestPilot app shell (com.restpilotai.app) in the simulator.
/// Run in two phases by .github/workflows/ios-native-e2e.yml:
///   A. shell loads the CI test page (site code + real plugins);
///   B. shell points at an unreachable host, so the offline screen must show.
final class ShellE2ETests: XCTestCase {
    private let shellId = "com.restpilotai.app"
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() {
        continueAfterFailure = false
    }

    private func snapshot(_ name: String, _ app: XCUIApplication? = nil) {
        let shot = (app?.screenshot()) ?? XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: shot)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Text whose label starts with `prefix`, anywhere in the app (web content included).
    private func text(_ app: XCUIApplication, startingWith prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func tapIfShown(_ button: XCUIElement, timeout: TimeInterval) {
        if button.waitForExistence(timeout: timeout) { button.tap() }
    }

    func testA_siteCodeDrivesRealPlugins() throws {
        let app = XCUIApplication(bundleIdentifier: shellId)
        app.launch()

        // iOS asks for notification permission when the page requests it.
        tapIfShown(springboard.buttons["Allow"], timeout: 30)

        let result = text(app, startingWith: "E2E ")
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline, result.exists == false || result.label == "E2E RUNNING" {
            _ = result.waitForExistence(timeout: 2)
            if result.exists, result.label != "E2E RUNNING" { break }
        }
        snapshot("A1 test page result", app)
        XCTAssertEqual(result.label, "E2E PASS", "test page said: \(result.label)")

        // The scheduled reminder fires as a real iOS notification banner.
        XCUIDevice.shared.press(.home)
        snapshot("A2 home screen (app icon)")
        let banner = springboard.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "RestPilot E2E reminder")
        ).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 60), "no notification banner appeared")
        snapshot("A3 notification banner")
        banner.tap()

        // Tapping it opens the app and the site's tap handler sees the path.
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let tapped = text(app, startingWith: "TAPPED ")
        XCTAssertTrue(tapped.waitForExistence(timeout: 20), "the notification tap did not reach the page")
        XCTAssertEqual(tapped.label, "TAPPED /plan")
        snapshot("A4 after tapping the notification", app)
    }

    func testB_offlineScreenShowsSavedPlan() throws {
        let app = XCUIApplication(bundleIdentifier: shellId)
        app.launch()
        let title = app.staticTexts["You're offline"]
        XCTAssertTrue(title.waitForExistence(timeout: 45), "the offline screen did not appear")
        let shift = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "E2E Ward")).firstMatch
        XCTAssertTrue(shift.waitForExistence(timeout: 15), "the saved plan is not shown")
        XCTAssertTrue(app.buttons["Try again"].exists, "no retry button")
        snapshot("B1 offline screen", app)
        app.buttons["Try again"].tap()
        // Still offline: it must stay on the offline screen, not go blank.
        sleep(8)
        XCTAssertTrue(title.exists, "the offline screen disappeared while still offline")
        snapshot("B2 offline screen after retry", app)
    }

    /// Apple's Health permission sheet: "Turn On All", then "Allow". The sheet is
    /// hosted by a system service and can take a while on a busy CI simulator,
    /// so look in the app and in SpringBoard for up to 90 s.
    private func approveHealthSheet(in app: XCUIApplication) {
        let label = { (t: String) in NSPredicate(format: "label == %@", t) }
        let places = [app, springboard]
        var turnOn: XCUIElement?
        let deadline = Date().addingTimeInterval(90)
        while turnOn == nil, Date() < deadline {
            for p in places {
                let el = p.descendants(matching: .any).matching(label("Turn On All")).firstMatch
                if el.waitForExistence(timeout: 3) { turnOn = el; break }
            }
        }
        guard let turnOn else {
            snapshot("Health sheet not found", app)
            return XCTFail("Health permission sheet did not appear within 90 s")
        }
        turnOn.tap()
        snapshot("Health sheet, all turned on", app)
        var allow: XCUIElement?
        for p in places {
            for q in [p.navigationBars.buttons, p.buttons] {
                let el = q.matching(label("Allow")).firstMatch
                if el.waitForExistence(timeout: 5) { allow = el; break }
            }
            if allow != nil { break }
        }
        guard let allow else { return XCTFail("no Allow button on the Health sheet") }
        allow.tap()
    }

    private func waitForResult(_ el: XCUIElement, notEqual running: String, timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if el.waitForExistence(timeout: 2), el.label != running { return }
        }
    }

    func testC_appleHealthThroughTheShell() throws {
        // 1. A separate test app writes a known night into the simulator's Health store.
        let host = XCUIApplication()
        host.launchArguments = ["-seedHealth"]
        host.launch()
        approveHealthSheet(in: host)
        let seeded = text(host, startingWith: "SEED ")
        waitForResult(seeded, notEqual: "SEED WAITING FOR PERMISSION", timeout: 60)
        snapshot("C1 seeded", host)
        XCTAssertTrue(seeded.label.hasPrefix("SEED OK"), "seeder said: \(seeded.label)")

        // 2. The RestPilot shell connects through its read-only plugin and checks the mapped night.
        //    (CI installed a copy whose page starts the Health check on load.)
        let app = XCUIApplication(bundleIdentifier: shellId)
        app.launch()
        approveHealthSheet(in: app)
        let result = text(app, startingWith: "HEALTH ")
        waitForResult(result, notEqual: "HEALTH RUNNING", timeout: 60)
        snapshot("C2 shell read Apple Health", app)
        XCTAssertEqual(result.label, "HEALTH PASS", "test page said: \(result.label)")
    }
}
