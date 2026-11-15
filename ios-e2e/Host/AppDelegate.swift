import HealthKit
import UIKit

// Host app for the UI test bundle (CI only, never shipped).
//
// Launched with `-seedHealth`, it writes a known night into the simulator's
// Health store (the store is shared by every app on the simulator), then
// reads it back with RestPilot's own HealthReader.swift and shows the result.
// The RestPilot shell itself only ever READS Health data; writing needs this
// separate app, with its own permission.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private let label = UILabel()
    private let store = HKHealthStore()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let vc = UIViewController()
        vc.view.backgroundColor = .systemBackground
        label.text = "RestPilot E2E host"
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        vc.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor, constant: 20),
            label.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor, constant: -20),
            label.centerYAnchor.constraint(equalTo: vc.view.centerYAnchor),
        ])
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = vc
        window?.makeKeyAndVisible()
        if ProcessInfo.processInfo.arguments.contains("-seedHealth") { seed() }
        return true
    }

    private func show(_ text: String) {
        DispatchQueue.main.async { self.label.text = text }
    }

    /// The fixture the shell's test page expects (ios-e2e/page/e2e.ts):
    /// 8 h in bed ending 1 h ago; 6 h 30 min asleep (core 240, deep 60, REM 90);
    /// 30 min awake; HRV 40 and 50 ms during the night; resting HR 57 bpm.
    private func seed() {
        guard
            HKHealthStore.isHealthDataAvailable(),
            let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
            let hrv = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
            let rhr = HKObjectType.quantityType(forIdentifier: .restingHeartRate)
        else { return show("SEED FAIL: Health not available") }
        let types: Set<HKSampleType> = [sleep, hrv, rhr]
        show("SEED WAITING FOR PERMISSION")
        store.requestAuthorization(toShare: types, read: types) { ok, error in
            guard ok else { return self.show("SEED FAIL: auth \(String(describing: error))") }
            let end = Date().addingTimeInterval(-3600)
            let h = { (hours: Double) in end.addingTimeInterval(-hours * 3600) }
            func night(_ raw: Int, _ from: Double, _ to: Double) -> HKCategorySample {
                HKCategorySample(type: sleep, value: raw, start: h(from), end: h(to))
            }
            let ms = HKUnit.secondUnit(with: .milli)
            let bpm = HKUnit.count().unitDivided(by: .minute())
            let samples: [HKSample] = [
                night(0, 8, 0),       // in bed
                night(3, 7.5, 5.5),   // core
                night(4, 5.5, 4.5),   // deep
                night(2, 4.5, 4),     // awake
                night(3, 4, 2),       // core
                night(5, 2, 0.5),     // REM
                HKQuantitySample(type: hrv, quantity: HKQuantity(unit: ms, doubleValue: 40), start: h(5), end: h(5)),
                HKQuantitySample(type: hrv, quantity: HKQuantity(unit: ms, doubleValue: 50), start: h(1), end: h(1)),
                HKQuantitySample(type: rhr, quantity: HKQuantity(unit: bpm, doubleValue: 57), start: end, end: end),
            ]
            self.store.save(samples) { saved, error in
                guard saved else { return self.show("SEED FAIL: save \(String(describing: error))") }
                // Read back through RestPilot's own reader (same source file the app ships).
                HealthReader(store: self.store).readSamples(days: 2) { result in
                    guard case .success(let payload) = result,
                          let s = payload["sleep"] as? [[String: Any]],
                          let v = payload["hrv"] as? [[String: Any]],
                          let r = payload["restingHeartRate"] as? [[String: Any]]
                    else { return self.show("SEED FAIL: read back") }
                    let labels = Set(s.compactMap { $0["value"] as? String })
                    let expected: Set<String> = ["inBed", "core", "deep", "awake", "rem"]
                    guard labels == expected, v.count == 2, r.count == 1 else {
                        return self.show("SEED FAIL: got \(labels.sorted()) hrv=\(v.count) rhr=\(r.count)")
                    }
                    self.show("SEED OK sleep=\(s.count) hrv=\(v.count) rhr=\(r.count)")
                }
            }
        }
    }
}
