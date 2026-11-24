import Foundation

struct Dashboard: Codable {
    let latestDate: String
    let historySeries: [Day]
    let activities: [Activity]
    let coverage: Coverage

    struct Day: Codable {
        let date: String
        var steps: Double?
        var stepGoal: Double?
        var restingHr: Double?
        var maxHeartRate: Double?
        var stress: Double?
        var bodyBatteryHigh: Double?
        var bodyBatteryLatest: Double?
        var intensityMinutes: Double?
        var sleepScore: Double?
        var sleepHours: Double?
        var sleepStartTimestamp: String?
        var sleepEndTimestamp: String?
        var sleepStress: Double?
        var overnightHrv: Double?
        var hrvWeeklyAverage: Double?
        var sleepAwakeMinutes: Double?
        var sleepAwakeCount: Double?
        var sleepDeepPercent: Double?
        var sleepRemPercent: Double?
    }

    struct Activity: Codable {
        let date: String
        let startTime: String?
        let name: String
        let type: String
        let durationMinutes: Double?
        let distanceKm: Double?
        let averageHr: Double?
        let trainingEffect: Double?
    }

    struct Coverage: Codable {
        let earliestDate: String
        let latestDate: String
        let dailyRecords: Int
        let sleepRecords: Int
        let hrvRecords: Int
        let activities: Int

        var isEmpty: Bool { dailyRecords + sleepRecords + hrvRecords + activities == 0 }
    }
}

struct RecentDays {
    let dates: [String]
    var first: String { dates[0] }
    var last: String { dates[dates.count - 1] }

    init(ending now: Date = .now, timeZone: TimeZone = .current) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        dates = (0..<30).reversed().compactMap { offset in
            calendar.date(byAdding: .day, value: -offset, to: now).map(formatter.string)
        }
    }
}

struct GarminDaily: Decodable {
    let data: [Row]

    struct Row: Decodable {
        let calendarDate: String
        let movement: Movement?
        let heartRate: HeartRate?
        let stress: Stress?
        let bodyBattery: BodyBattery?
        let intensityMinutes: Intensity?

        struct Movement: Decodable {
            let steps: Steps?
            struct Steps: Decodable { let value: Double?; let goal: Double? }
        }
        struct HeartRate: Decodable { let restingValue: Double?; let maxValue: Double? }
        struct Stress: Decodable { let avgLevel: Double? }
        struct BodyBattery: Decodable { let maxValue: Double?; let latestValue: Double? }
        struct Intensity: Decodable { let moderate: Double?; let vigorous: Double? }
    }
}

struct GarminSleep: Decodable {
    let calendarDate: String?
    let sleepTimeSeconds: Double?
    let sleepStartTimestampGMT: GarminGMTTimestamp?
    let sleepEndTimestampGMT: GarminGMTTimestamp?
    let deepSleepSeconds: Double?
    let lightSleepSeconds: Double?
    let remSleepSeconds: Double?
    let awakeSleepSeconds: Double?
    let awakeCount: Double?
    let avgSleepStress: Double?
    let sleepScores: Scores?

    struct Scores: Decodable {
        let overall: Score?
        struct Score: Decodable { let value: Double? }
    }
}

struct GarminGMTTimestamp: Decodable {
    let iso8601: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let date: Date?
        if let milliseconds = try? container.decode(Double.self), milliseconds.isFinite {
            date = Date(timeIntervalSince1970: milliseconds / 1000)
        } else if let timestamp = try? container.decode(String.self) {
            date = parseGarminGMT(timestamp)
        } else {
            date = nil
        }
        iso8601 = date.map(ISO8601DateFormatter().string(from:))
    }
}

struct GarminHRV: Decodable {
    let hrvSummaries: [Row]

    struct Row: Decodable {
        let calendarDate: String
        let weeklyAvg: Double?
        let lastNightAvg: Double?
    }
}

struct GarminActivity: Decodable {
    let activityId: Int64
    let activityName: String?
    let startTimeLocal: String
    let activityType: ActivityType?
    let duration: Double?
    let distance: Double?
    let averageHR: Double?
    let aerobicTrainingEffect: Double?

    struct ActivityType: Decodable { let typeKey: String? }
}

func normalizeDashboard(days: RecentDays, daily: GarminDaily, sleep: [GarminSleep], hrv: GarminHRV,
                        activities: [GarminActivity]) -> Dashboard {
    var rows = Dictionary(uniqueKeysWithValues: days.dates.map { ($0, Dashboard.Day(date: $0)) })
    for item in daily.data {
        guard var row = rows[item.calendarDate] else { continue }
        row.steps = valid(item.movement?.steps?.value, in: 0...500_000)
        row.stepGoal = valid(item.movement?.steps?.goal, in: 1...500_000)
        row.restingHr = valid(item.heartRate?.restingValue, in: 20...250)
        row.maxHeartRate = valid(item.heartRate?.maxValue, in: 20...250)
        row.stress = valid(item.stress?.avgLevel, in: 0...100)
        row.bodyBatteryHigh = valid(item.bodyBattery?.maxValue, in: 0...100)
        row.bodyBatteryLatest = valid(item.bodyBattery?.latestValue, in: 0...100)
        let moderate = valid(item.intensityMinutes?.moderate, in: 0...1440)
        let vigorous = valid(item.intensityMinutes?.vigorous, in: 0...1440)
        if let moderate, let vigorous {
            row.intensityMinutes = moderate + 2 * vigorous
        }
        rows[row.date] = row
    }

    for item in sleep {
        guard let date = item.calendarDate, var row = rows[date] else { continue }
        let start = item.sleepStartTimestampGMT?.iso8601
        let end = item.sleepEndTimestampGMT?.iso8601
        if let existingEnd = row.sleepEndTimestamp, (end ?? "") < existingEnd { continue }
        row.sleepStartTimestamp = start
        row.sleepEndTimestamp = end
        row.sleepScore = valid(item.sleepScores?.overall?.value, in: 0...100)
        let duration = valid(item.sleepTimeSeconds, in: 1...86_400)
        row.sleepHours = duration.map { $0 / 3600 }
        row.sleepStress = valid(item.avgSleepStress, in: 0...100)
        row.sleepAwakeMinutes = valid(item.awakeSleepSeconds, in: 0...86_400).map { $0 / 60 }
        row.sleepAwakeCount = valid(item.awakeCount, in: 0...1000)
        if let duration {
            row.sleepDeepPercent = valid(item.deepSleepSeconds, in: 0...duration).map { 100 * $0 / duration }
            row.sleepRemPercent = valid(item.remSleepSeconds, in: 0...duration).map { 100 * $0 / duration }
        }
        rows[row.date] = row
    }

    for item in hrv.hrvSummaries {
        guard var row = rows[item.calendarDate] else { continue }
        row.overnightHrv = valid(item.lastNightAvg, in: 1...250)
        row.hrvWeeklyAverage = valid(item.weeklyAvg, in: 1...250)
        rows[row.date] = row
    }

    var activityIDs = Set<Int64>()
    let activityRows: [Dashboard.Activity] = activities.compactMap { item in
        let date = String(item.startTimeLocal.prefix(10))
        guard rows[date] != nil, activityIDs.insert(item.activityId).inserted else { return nil }
        let type = item.activityType?.typeKey?.replacingOccurrences(of: "_", with: " ").capitalized ?? "Activity"
        let name = item.activityName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return Dashboard.Activity(date: date, startTime: localActivityTime(item.startTimeLocal),
                                  name: name.flatMap { $0.isEmpty ? nil : String($0.prefix(256)) } ?? type,
                                  type: type, durationMinutes: valid(item.duration, in: 0...604_800).map { $0 / 60 },
                                  distanceKm: valid(item.distance, in: 0...10_000_000).map { $0 / 1000 },
                                  averageHr: valid(item.averageHR, in: 20...250),
                                  trainingEffect: valid(item.aerobicTrainingEffect, in: 0...5))
    }

    let series = days.dates.compactMap { rows[$0] }
    let dailyCount = series.filter { row in
        [row.steps, row.restingHr, row.maxHeartRate, row.stress, row.bodyBatteryHigh,
         row.bodyBatteryLatest, row.intensityMinutes].contains { $0 != nil }
    }.count
    let sleepCount = series.filter { $0.sleepScore != nil || $0.sleepHours != nil }.count
    let hrvCount = series.filter { $0.overnightHrv != nil || $0.hrvWeeklyAverage != nil }.count
    return Dashboard(latestDate: days.last, historySeries: series, activities: activityRows,
                     coverage: .init(earliestDate: days.first, latestDate: days.last, dailyRecords: dailyCount,
                                     sleepRecords: sleepCount, hrvRecords: hrvCount, activities: activityRows.count))
}

private func localActivityTime(_ timestamp: String) -> String? {
    let suffix = timestamp.dropFirst(10)
    guard let time = suffix.range(of: #"^[T ](?:[01][0-9]|2[0-3]):[0-5][0-9](?=:|$)"#,
                                  options: .regularExpression) else { return nil }
    return String(suffix[time].dropFirst())
}

private func valid(_ value: Double?, in range: ClosedRange<Double>) -> Double? {
    guard let value, range.contains(value) else { return nil }
    return value
}

private func parseGarminGMT(_ value: String) -> Date? {
    var iso = value.replacingOccurrences(of: " ", with: "T")
    if iso.range(of: "(Z|[+-]\\d{2}:?\\d{2})$", options: .regularExpression) == nil { iso += "Z" }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: iso) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: iso)
}
