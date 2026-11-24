import Foundation

private final class FakeGarmin: URLProtocol {
    static var response: ((URLRequest) throws -> (Int, String))!

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let (status, body) = try Self.response(request)
            let reply = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: reply, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private struct TestFailure: Error { let message: String }

private func expect(_ condition: Bool, _ message: String) throws {
    if !condition { throw TestFailure(message: message) }
}

@main
struct ContractTests {
    static func main() async throws {
        let end = ISO8601DateFormatter().date(from: "2024-07-30T14:00:00Z")!
        let days = RecentDays(ending: end, timeZone: TimeZone(secondsFromGMT: 0)!)
        try expect(days.dates.count == 30 && days.first == "2024-07-01" && days.last == "2024-07-30", "Expected 30 inclusive dates")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeGarmin.self]
        let garmin = GarminClient(configuration: configuration)
        let fixture = try await loadFixture(garmin, days: days)
        try testSnapshot(fixture)
        try testKeychain()
        try await testErrors(garmin, days: days)
        print("Garmin request, mapping, privacy, storage, and Keychain checks passed.")
    }

    static func loadFixture(_ client: GarminClient, days: RecentDays) async throws -> Dashboard {
        FakeGarmin.response = { request in
            let url = request.url!
            try expect(url.scheme == "https" && url.host == "personal.connectapi.garmin.com", "Unexpected destination")
            try expect(request.value(forHTTPHeaderField: "Cookie") == nil, "Unexpected cookie")
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw TestFailure(message: "Garmin request URL is invalid")
            }
            let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) })
            let authorization = request.value(forHTTPHeaderField: "Authorization")
            if url.path.hasSuffix("/personal-api-key/token") {
                try expect(authorization == "ApiKey fake-api-key" && request.httpMethod == "POST" && query.isEmpty,
                           "Expected token exchange request")
                return (200, "testheader.testpayload.testsignature")
            }
            try expect(authorization == "Bearer testheader.testpayload.testsignature" && request.httpMethod == "GET",
                       "Expected authenticated read")
            if !url.path.contains("hrv-service") {
                try expect(query["startDate"] == days.first && query["endDate"] == days.last, "Incorrect date range")
            }
            switch url.path {
            case "/usersummary-service/v2/dailysummaries":
                return (200, """
                {"data":[{"calendarDate":"2024-07-29","userProfilePk":123,"movement":{"steps":{"value":6132,"goal":9000}},"heartRate":{"restingValue":56},"bodyBattery":{"maxValue":87},"intensityMinutes":{"moderate":13,"vigorous":7}},{"calendarDate":"2024-07-30","movement":{"steps":{"value":-1}}}]}
                """)
            case "/sleep-service/sleep/dailySleepSummariesByDate":
                return (200, """
                [
                    {"calendarDate":"2024-07-29","sleepStartTimestampGMT":"2024-07-28 23:00:00.0","sleepEndTimestampGMT":"2024-07-29T07:00:00Z","sleepTimeSeconds":28800,"deepSleepSeconds":7200,"remSleepSeconds":7200,"sleepScores":{"overall":{"value":83,"qualifierKey":"GOOD"}},"userNote":"synthetic private note"},
                    {"calendarDate":null,"sleepStartTimestampGMT":1722294900000,"sleepEndTimestampGMT":1722321900000,"sleepScores":{"overall":{"value":100}}},
                    {"calendarDate":"2024-07-30","sleepStartTimestampGMT":1722294900000,"sleepEndTimestampGMT":1722321900000,"sleepTimeSeconds":27000,"sleepScores":{"overall":{"value":78}}}
                ]
                """)
            case "/hrv-service/hrv/daily/2024-07-01/2024-07-30":
                return (200, """
                {"hrvSummaries":[{"calendarDate":"2024-07-29","weeklyAvg":43,"lastNightAvg":45}],"userProfilePk":123}
                """)
            case "/activitylist-service/activities/search/activities":
                try expect(query["limit"] == "50", "Incorrect page limit")
                let activity = """
                {"activityId":2,"activityName":"Demo jog","startTimeLocal":"2024-07-29 17:00:00","activityType":{"typeKey":"trail_running"},"duration":1800,"distance":3900,"averageHR":133,"aerobicTrainingEffect":2.5,"ownerFullName":"Synthetic Owner","startLatitude":4.12,"startLongitude":5.43}
                """
                switch query["start"] {
                case "0": return (200, "[" + Array(repeating: activity, count: 50).joined(separator: ",") + "]")
                case "50": return (200, "[]")
                default: throw TestFailure(message: "Incorrect paginated activity offset")
                }
            default: throw TestFailure(message: "Unexpected Garmin path")
            }
        }

        let result = try await client.sync(key: "fake-api-key", days: days)
        let row = result.historySeries[28]
        try expect(row.sleepScore == 83 && row.sleepHours == 8 && row.sleepDeepPercent == 25 &&
                   row.sleepStartTimestamp == "2024-07-28T23:00:00Z" &&
                   row.sleepEndTimestamp == "2024-07-29T07:00:00Z", "Sleep with timestamp strings did not map")
        let numericSleep = result.historySeries[29]
        try expect(numericSleep.sleepScore == 78 && numericSleep.sleepHours == 7.5 &&
                   numericSleep.sleepStartTimestamp == "2024-07-29T23:15:00Z" &&
                   numericSleep.sleepEndTimestamp == "2024-07-30T06:45:00Z", "Sleep with Unix milliseconds did not map")
        try expect(row.overnightHrv == 45 && row.hrvWeeklyAverage == 43, "HRV fields did not map")
        try expect(row.steps == 6132 && row.restingHr == 56 && row.intensityMinutes == 27 && row.bodyBatteryHigh == 87,
                   "Daily fields did not map")
        try expect(result.historySeries[29].steps == nil && result.historySeries[0].sleepScore == nil,
                   "Missing and sentinel values must stay absent")
        try expect(result.activities.count == 1 && result.activities[0].durationMinutes == 30 &&
                   result.activities[0].distanceKm == 3.9 && result.activities[0].type == "Trail Running",
                   "Activity mapping, units, or de-duplication failed")
        try expect(result.coverage.dailyRecords == 1 && result.coverage.hrvRecords == 1 && result.coverage.sleepRecords == 2,
                   "Coverage counts metadata, undated records, or gaps")
        let serialized = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
        try expect(!["Synthetic Owner", "private note", "startLatitude", "userProfilePk", "fake-api-key"].contains(where: serialized.contains),
                   "Unneeded private fields leaked into the snapshot")
        return result
    }

    static func testSnapshot(_ data: Dashboard) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ground-truth-test-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        let id = UUID()
        try store.write(.init(connectionID: id, syncedAt: .now, data: data))
        try expect(store.read(connectionID: id)?.data.activities.count == 1, "Saved data did not restore")
        try expect(store.read(connectionID: UUID()) == nil, "A different account can read the saved snapshot")
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("garmin-snapshot.json").path)
        try expect(attributes[.posixPermissions] as? Int == 0o600, "Snapshot permissions are too broad")
        try store.remove()
        try store.remove()
        try expect(store.read(connectionID: id) == nil, "Disconnect did not remove the snapshot")
    }

    static func testKeychain() throws {
        let keychain = Keychain(service: "app.groundtruth.test.\(UUID())")
        defer { try? keychain.remove() }
        let empty = try keychain.read()
        try expect(empty == nil, "Test Keychain item already exists")
        let original = GarminConnection(id: UUID(), key: "example-test-key")
        try keychain.write(original)
        let saved = try keychain.read()
        try expect(saved?.key == original.key && saved?.id == original.id, "Credential did not round-trip through Keychain")
        let updated = GarminConnection(id: UUID(), key: "replacement-test-key")
        try keychain.write(updated)
        let replacement = try keychain.read()
        try expect(replacement?.key == updated.key && replacement?.id == updated.id, "Credential replacement did not persist")
        try keychain.remove()
        let afterRemoval = try keychain.read()
        try expect(afterRemoval == nil, "Credential deletion did not persist")
    }

    static func testErrors(_ client: GarminClient, days: RecentDays) async throws {
        let cases: [(Int, GroundTruthError)] = [(401, .rejectedKey), (403, .rejectedKey), (429, .rateLimited),
                                                (302, .garminUnavailable), (503, .garminUnavailable)]
        for (status, expected) in cases {
            FakeGarmin.response = { _ in (status, "upstream detail contains fixture secret text") }
            do {
                _ = try await client.sync(key: "fake-api-key", days: days)
                throw TestFailure(message: "Expected sanitized error for HTTP \(status)")
            } catch let actual as GroundTruthError {
                try expect(actual == expected, "Incorrect HTTP error mapping")
                try expect(!actual.localizedDescription.contains("fixture secret"), "Upstream body leaked into UI error")
            }
        }
        FakeGarmin.response = { _ in (200, "unexpected token") }
        do {
            _ = try await client.sync(key: "fake-api-key", days: days)
            throw TestFailure(message: "Accepted malformed bearer token")
        } catch GroundTruthError.invalidResponse {}
        FakeGarmin.response = { _ in (204, "") }
        do {
            _ = try await client.sync(key: "fake\napi-key", days: days)
            throw TestFailure(message: "Accepted unsafe credential format")
        } catch GroundTruthError.invalidKey {}
    }
}
