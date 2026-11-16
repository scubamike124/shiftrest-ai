import XCTest

/// Drives the real RestPilot app shell (com.restpilotai.app) in the simulator.
/// Run in two phases by .github/workflows/ios-native-e2e.yml:
///   A. shell loads the CI test page (site code + real plugins);
///   B. shell points at an unreachable host, so the offline screen must show.
final class ShellE2ETests: XCTestCase {
    private let shellId = "com.restpilotai.app"
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    /// The process that draws Apple's Health permission sheet.
    private let healthPrivacy = XCUIApplication(bundleIdentifier: "com.apple.HealthPrivacyService")

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

    /// Apple's Health permission sheet, found by its "Turn On All" control.
    /// `tappable` is false when the control was found only through
    /// com.apple.HealthPrivacyService: those elements carry the remote scene's
    /// frames, so XCUITest's taps on them fail ("not hittable") even when
    /// isHittable says otherwise.
    private struct HealthSheet {
        let turnOn: XCUIElement
        let tappable: Bool
    }

    /// The sheet is drawn by a system service and can take a while on a busy CI
    /// simulator, so look in the app, the Health privacy service and SpringBoard.
    private func findHealthSheet(in app: XCUIApplication, timeout: TimeInterval) -> HealthSheet? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for (p, tappable) in [(app, true), (healthPrivacy, false), (springboard, true)] {
                let el = p.descendants(matching: .any)
                    .matching(NSPredicate(format: "label == %@", "Turn On All")).firstMatch
                if el.waitForExistence(timeout: 3) { return HealthSheet(turnOn: el, tappable: tappable) }
            }
        }
        return nil
    }

    private func allowOnHealthSheet(_ sheet: HealthSheet, in app: XCUIApplication) {
        guard sheet.tappable, sheet.turnOn.isHittable else { return allowOnHealthSheetByPosition(app) }
        sheet.turnOn.tap()
        snapshot("Health sheet, all turned on", app)
        var allow: XCUIElement?
        for p in [app, springboard] {
            for q in [p.navigationBars.buttons, p.buttons] {
                let el = q.matching(NSPredicate(format: "label == %@", "Allow")).firstMatch
                if el.waitForExistence(timeout: 5) { allow = el; break }
            }
            if allow != nil { break }
        }
        if let allow, allow.isHittable {
            allow.tap()
        } else {
            app.coordinate(withNormalizedOffset: allowPosition).tap()
        }
    }

    /// Positions of "Turn On All" and "Allow" on the sheet as laid out on the CI
    /// iPhone simulator (normalized to the screen).
    private let turnOnAllPosition = CGVector(dx: 0.5, dy: 0.507)
    private let allowPosition = CGVector(dx: 0.5, dy: 0.859)

    /// Fallback when the sheet is on screen but its controls are missing from,
    /// or not tappable in, the accessibility tree (seen on CI: the screenshot
    /// shows the sheet, queries find nothing or only remote-scene frames). Taps
    /// "Turn On All", then "Allow", by position. If the taps miss, the seeder or
    /// the page never reports success and the test fails.
    private func allowOnHealthSheetByPosition(_ app: XCUIApplication) {
        print("E2E: Health sheet controls not tappable via accessibility; tapping by position")
        snapshot("Health sheet: tapping by position", app)
        app.coordinate(withNormalizedOffset: turnOnAllPosition).tap()
        sleep(2)
        snapshot("Health sheet after Turn On All (by position)", app)
        app.coordinate(withNormalizedOffset: allowPosition).tap()
    }

    private func approveHealthSheet(in app: XCUIApplication) {
        guard let sheet = findHealthSheet(in: app, timeout: 90) else {
            snapshot("Health sheet not found", app)
            return XCTFail("Health permission sheet did not appear within 90 s")
        }
        allowOnHealthSheet(sheet, in: app)
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
        //    (CI installed a copy whose page has the Health check behind a Connect button.)
        //    As in the real app, the permission request starts from a tap on Connect,
        //    once the app is on screen. On CI the sheet is sometimes on screen while
        //    its controls are missing from the accessibility tree; left unanswered,
        //    HealthKit then reports "Authorization session timed out". So: look for
        //    the controls (app, Health privacy service, SpringBoard), else tap them by
        //    position; if the page has already failed, tap Connect again.
        let app = XCUIApplication(bundleIdentifier: shellId)
        app.launch()
        let result = text(app, startingWith: "HEALTH ")
        let connect = app.buttons["Connect Apple Health"]
        var approved = false
        for attempt in 1...3 where !approved {
            XCTAssertTrue(connect.waitForExistence(timeout: 30), "no Connect button on the test page")
            let enabled = NSPredicate(format: "isEnabled == true")
            let ready = expectation(for: enabled, evaluatedWith: connect)
            wait(for: [ready], timeout: 90)
            connect.tap()
            if let sheet = findHealthSheet(in: app, timeout: 60) {
                allowOnHealthSheet(sheet, in: app)
                approved = true
            } else if result.label == "HEALTH RUNNING" {
                // Still waiting on Apple's sheet: it is very likely on screen.
                allowOnHealthSheetByPosition(app)
                approved = true
            } else {
                snapshot("Health sheet not shown (attempt \(attempt))", app)
                waitForResult(result, notEqual: "HEALTH RUNNING", timeout: 90)
            }
        }
        XCTAssertTrue(approved, "Health permission sheet did not appear after 3 taps on Connect; page said: \(result.label)")
        waitForResult(result, notEqual: "HEALTH RUNNING", timeout: 60)
        snapshot("C2 shell read Apple Health", app)
        XCTAssertEqual(result.label, "HEALTH PASS", "test page said: \(result.label)")
    }
}
