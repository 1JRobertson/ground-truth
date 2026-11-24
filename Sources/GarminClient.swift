import Foundation

enum GroundTruthError: LocalizedError {
    case invalidKey
    case rejectedKey
    case rateLimited
    case garminUnavailable
    case connectionFailed
    case invalidResponse
    case keychainUnavailable
    case localStorageUnavailable
    case alreadyWorking

    var errorDescription: String? {
        switch self {
        case .invalidKey: return "Paste the Personal API key from Garmin Connect."
        case .rejectedKey: return "Garmin rejected this key. Create a new Personal API key and reconnect."
        case .rateLimited: return "Garmin is limiting requests. Try syncing again later."
        case .garminUnavailable: return "Garmin could not complete this request. Try syncing again later."
        case .connectionFailed: return "Could not reach Garmin. Check your internet connection and try again."
        case .invalidResponse: return "Garmin returned an unexpected response. Your saved data has been kept."
        case .keychainUnavailable: return "Ground Truth could not access macOS Keychain. Unlock Keychain and try again."
        case .localStorageUnavailable: return "Ground Truth could not update its local data. Check available disk space and try again."
        case .alreadyWorking: return "A Garmin request is already running."
        }
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct GarminClient {
    static let settingsURL = URL(string: "https://connect.garmin.com/app/settings/personalApiToken")!
    private static let host = "personal.connectapi.garmin.com"
    private static let tokenPath = "/personalapitoken-service/personal-api/personal-api-key/token"
    private let session: URLSession

    init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 45
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }

    func sync(key: String, days: RecentDays = RecentDays()) async throws -> Dashboard {
        guard (8...2048).contains(key.utf8.count), key.utf8.allSatisfy({ (33...126).contains($0) }) else {
            throw GroundTruthError.invalidKey
        }

        let tokenResponse = try await request(path: Self.tokenPath, method: "POST", authorization: "ApiKey \(key)")
        guard let token = String(data: tokenResponse, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              token.utf8.count <= 8192,
              token.range(of: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            throw GroundTruthError.invalidResponse
        }

        let auth = "Bearer \(token)"
        let range = [URLQueryItem(name: "startDate", value: days.first), URLQueryItem(name: "endDate", value: days.last)]
        let daily: GarminDaily = try await get("/usersummary-service/v2/dailysummaries", query: range, auth: auth,
                                              empty: GarminDaily(data: []))
        let sleep: [GarminSleep] = try await get("/sleep-service/sleep/dailySleepSummariesByDate", query: range,
                                                auth: auth, empty: [])
        let hrv: GarminHRV = try await get("/hrv-service/hrv/daily/\(days.first)/\(days.last)", auth: auth,
                                         empty: GarminHRV(hrvSummaries: []))
        let activities = try await fetchActivities(range: range, auth: auth)
        return normalizeDashboard(days: days, daily: daily, sleep: sleep, hrv: hrv, activities: activities)
    }

    private func fetchActivities(range: [URLQueryItem], auth: String) async throws -> [GarminActivity] {
        let pageSize = 50
        var activities: [GarminActivity] = []
        for offset in stride(from: 0, to: 1000, by: pageSize) {
            let query = range + [URLQueryItem(name: "start", value: String(offset)),
                                 URLQueryItem(name: "limit", value: String(pageSize))]
            let page: [GarminActivity] = try await get("/activitylist-service/activities/search/activities",
                                                      query: query, auth: auth, empty: [])
            activities.append(contentsOf: page)
            if page.count < pageSize { return activities }
        }
        throw GroundTruthError.invalidResponse
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], auth: String, empty: T) async throws -> T {
        let data = try await request(path: path, query: query, authorization: auth)
        if data.isEmpty { return empty }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw GroundTruthError.invalidResponse }
    }

    private func request(path: String, method: String = "GET", query: [URLQueryItem] = [],
                         authorization: String) async throws -> Data {
        var address = URLComponents()
        address.scheme = "https"
        address.host = Self.host
        address.path = path
        if !query.isEmpty { address.queryItems = query }
        guard let url = address.url else { throw GroundTruthError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(authorization, forHTTPHeaderField: "Authorization")
        request.setValue(method == "POST" ? "text/plain" : "application/json", forHTTPHeaderField: "Accept")
        let result: (Data, URLResponse)
        do { result = try await session.data(for: request) }
        catch { throw GroundTruthError.connectionFailed }
        let (data, response) = result
        guard let http = response as? HTTPURLResponse, http.url?.host == Self.host,
              http.url?.scheme == "https", data.count <= 12 * 1024 * 1024 else {
            throw GroundTruthError.invalidResponse
        }
        switch http.statusCode {
        case 200...299: return data
        case 401, 403: throw GroundTruthError.rejectedKey
        case 429: throw GroundTruthError.rateLimited
        default: throw GroundTruthError.garminUnavailable
        }
    }
}
