import Foundation
import HealthKit

// Read-only Apple Health access for RestPilot. Also compiled into the
// simulator test harness (ios-e2e), which is why it has no Capacitor import.
//
// Note for maintainers: do not add an Objective-C name annotation to anything
// in this file. Capacitor's CLI registers the first such name it finds in each
// plugin source file as a plugin class.

public final class HealthReader {
    public let store: HKHealthStore

    public init(store: HKHealthStore = HKHealthStore()) {
        self.store = store
    }

    /// Exactly what RestPilot reads. Nothing is ever written.
    public static var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        if let t = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(t) }
        if let t = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) { types.insert(t) }
        if let t = HKObjectType.quantityType(forIdentifier: .restingHeartRate) { types.insert(t) }
        return types
    }

    public static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// Shows Apple's Health permission sheet the first time. iOS never tells an
    /// app whether read access was granted; `success` only means the request ran.
    public func requestReadAuthorization(completion: @escaping (Bool, Error?) -> Void) {
        store.requestAuthorization(toShare: nil, read: Self.readTypes, completion: completion)
    }

    /// HealthKit sleep values as stable strings. Raw values, so this compiles for
    /// iOS 13 while still recognising the iOS 16 stage values.
    public static func sleepLabel(_ raw: Int) -> String {
        switch raw {
        case 0: return "inBed"
        case 1: return "asleep"   // asleepUnspecified (formerly "asleep")
        case 2: return "awake"
        case 3: return "core"
        case 4: return "deep"
        case 5: return "rem"
        default: return "unknown"
        }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    public static func isoString(_ d: Date) -> String { iso.string(from: d) }

    /// Maps samples to plain dictionaries for the page. Pure; unit-tested in the harness.
    public static func serialize(sleep: [HKCategorySample], hrv: [HKQuantitySample], resting: [HKQuantitySample]) -> [String: Any] {
        let ms = HKUnit.secondUnit(with: .milli)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        return [
            "sleep": sleep.map { ["start": isoString($0.startDate), "end": isoString($0.endDate), "value": sleepLabel($0.value)] },
            "hrv": hrv.map { ["start": isoString($0.startDate), "end": isoString($0.endDate), "ms": $0.quantity.doubleValue(for: ms)] },
            "restingHeartRate": resting.map { ["start": isoString($0.startDate), "end": isoString($0.endDate), "bpm": $0.quantity.doubleValue(for: bpm)] },
        ]
    }

    private static let maxSamplesPerType = 5000

    private func query(_ type: HKSampleType, from: Date, to: Date, done: @escaping ([HKSample], Error?) -> Void) {
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: [])
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: Self.maxSamplesPerType, sortDescriptors: sort) { _, samples, error in
            done(samples ?? [], error)
        }
        store.execute(q)
    }

    /// Reads the last `days` days (1–30). Denied types simply come back empty.
    public func readSamples(days: Int, now: Date = Date(), completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard
            let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
            let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
            let restingType = HKObjectType.quantityType(forIdentifier: .restingHeartRate)
        else {
            completion(.failure(NSError(domain: "RestPilotHealth", code: 1, userInfo: [NSLocalizedDescriptionKey: "Health types unavailable"])))
            return
        }
        let span = max(1, min(30, days))
        let from = now.addingTimeInterval(-Double(span) * 86_400)
        let group = DispatchGroup()
        let lock = NSLock()
        var sleep: [HKCategorySample] = []
        var hrv: [HKQuantitySample] = []
        var resting: [HKQuantitySample] = []
        var firstError: Error?
        func collect(_ type: HKSampleType, _ assign: @escaping ([HKSample]) -> Void) {
            group.enter()
            query(type, from: from, to: now) { samples, error in
                lock.lock()
                if let error = error, firstError == nil { firstError = error }
                assign(samples)
                lock.unlock()
                group.leave()
            }
        }
        collect(sleepType) { sleep = $0.compactMap { $0 as? HKCategorySample } }
        collect(hrvType) { hrv = $0.compactMap { $0 as? HKQuantitySample } }
        collect(restingType) { resting = $0.compactMap { $0 as? HKQuantitySample } }
        group.notify(queue: .global(qos: .userInitiated)) {
            // A type the person did not allow returns no samples (and, on some
            // iOS versions, an authorization error). Neither is fatal: return what we have.
            var payload = Self.serialize(sleep: sleep, hrv: hrv, resting: resting)
            payload["from"] = Self.isoString(from)
            payload["to"] = Self.isoString(now)
            if let e = firstError as NSError? { payload["partialError"] = "\(e.domain):\(e.code)" }
            completion(.success(payload))
        }
    }
}
