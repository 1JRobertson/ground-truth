import Foundation

func demoDashboard(now: Date = .now) -> Dashboard {
    let calendar = Calendar.current
    let days = RecentDays(ending: now)
    let formatter = ISO8601DateFormatter()
    var activities: [Dashboard.Activity] = []
    let rows = days.dates.enumerated().map { index, date in
        var row = Dashboard.Day(date: date)
        row.steps = Double(3900 + (index * 1373) % 7700)
        row.stepGoal = 8000
        row.restingHr = Double(51 + (index * 3) % 8)
        row.stress = Double(19 + (index * 7) % 21)
        row.bodyBatteryHigh = Double(65 + (index * 11) % 29)
        row.bodyBatteryLatest = Double(24 + (index * 9) % 28)
        row.intensityMinutes = Double((index * 17) % 58)
        row.sleepScore = Double(69 + (index * 7) % 25)
        row.sleepHours = 6.7 + Double((index * 3) % 14) / 10
        row.sleepStress = Double(12 + (index * 7) % 14)
        row.overnightHrv = Double(39 + (index * 5) % 17)
        row.hrvWeeklyAverage = Double(44 + (index * 3) % 9)
        row.sleepAwakeCount = Double(1 + index % 4)
        row.sleepAwakeMinutes = Double(11 + index % 24)
        row.sleepDeepPercent = Double(14 + index % 8)
        row.sleepRemPercent = Double(21 + index % 7)
        if let day = calendar.date(byAdding: .day, value: index - 29, to: now),
           let morning = calendar.date(bySettingHour: 7, minute: (index * 7) % 40, second: 0, of: day),
           let hours = row.sleepHours {
            row.sleepEndTimestamp = formatter.string(from: morning)
            row.sleepStartTimestamp = formatter.string(from: morning.addingTimeInterval(-hours * 3600))
        }
        if index == 8 || index == 20 {
            row.sleepHours = nil
            row.sleepScore = nil
            row.sleepStartTimestamp = nil
            row.sleepEndTimestamp = nil
        }
        if index % 3 != 1 {
            let examples = [("Easy run", "Running"), ("Strength session", "Strength Training"),
                            ("Evening ride", "Cycling"), ("Morning walk", "Walking")]
            let (name, type) = examples[(index / 2) % examples.count]
            activities.append(.init(date: date, name: name, type: type, durationMinutes: Double(29 + index % 28),
                                    distanceKm: type == "Strength Training" ? nil : 3.5 + Double(index % 9),
                                    averageHr: Double(112 + index % 39), trainingEffect: 2.1 + Double(index % 5) / 10))
        }
        return row
    }
    return Dashboard(latestDate: days.last, historySeries: rows, activities: activities.reversed(),
                     coverage: .init(earliestDate: days.first, latestDate: days.last, dailyRecords: rows.count,
                                     sleepRecords: rows.count - 2, hrvRecords: rows.count, activities: activities.count))
}
