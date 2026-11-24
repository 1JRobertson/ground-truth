const { axisDateLabel, chartTickIndices, trimToAvailableData, valueTickIndices } = chartAxis;

const views = ["overview", "recovery", "sleep", "training", "activities", "timeline"];

const numberFormat = new Intl.NumberFormat("en-CA");
const longDateFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const shortDateFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const activityTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const weekdayFormat = new Intl.DateTimeFormat("en-CA", {
  weekday: "short",
  timeZone: "UTC",
});
const compactMonthFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  timeZone: "UTC",
});

function loadTrendPreferences() {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("garmin-dashboard-trends") || "{}");
  } catch {
    return {};
  }
}

const savedTrendPreferences = loadTrendPreferences();
const state = {
  data: null,
  view: views.includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "overview",
  viewRanges: { overview: "30", recovery: "30", training: "30", timeline: "all" },
  openDetails: new Set(),
  activityLimit: 50,
  chartRanges: {
    "overview-recovery-chart": "30",
    "overview-steps-chart": "30",
    "sleep-trend-chart": "30",
    "recovery-score-chart": "30",
    "recovery-baseline-chart": "30",
    "training-volume-chart": "30",
    "timeline-health-chart": "all",
    "timeline-movement-chart": "all",
  },
  seriesVisibility: {},
  chartTrendVisibility: savedTrendPreferences.visibility || {},
  chartTrendWindows: savedTrendPreferences.windows || {},
  trainingCalendarRange: "30",
  activitySearch: "",
  activityType: "all",
  sleepDate: null,
  sleepAnalysisRange: "30",

};

const chartsWithTrend = new Set([
  "overview-recovery-chart",
  "recovery-score-chart",
  "recovery-baseline-chart",
  "training-volume-chart",
  "timeline-health-chart",
]);

const defaultTrendWindowByChart = {
  "overview-recovery-chart": 3,
  "recovery-score-chart": 3,
  "recovery-baseline-chart": 7,
  "training-load-chart": 7,
  "training-volume-chart": 3,
  "timeline-health-chart": 90,
};

const trendWindowOptions = [2, 3, 5, 7, 14, 30, 60, 90, 180];

const viewMeta = {
  overview: ["Dashboard", "Overview"],
  recovery: ["Health", "Recovery"],
  sleep: ["Recovery", "Sleep"],
  training: ["Workload", "Training"],
  activities: ["Log", "Training"],
  timeline: ["History", "History"],
};

const viewChartIds = {
  overview: ["overview-recovery-chart", "overview-steps-chart"],
  sleep: ["sleep-trend-chart"],
  recovery: ["recovery-score-chart", "recovery-baseline-chart"],
  training: ["training-volume-chart"],
  timeline: ["timeline-health-chart", "timeline-movement-chart"],
};

function periodToolbar(title, view = state.view) {
  const range = state.viewRanges[view];
  const series = visibleSeries(range);
  return `<div class="section-toolbar">
    <div><span>${range === "all" ? dateLabel(series[0].date) : shortDateLabel(series[0].date)} – ${dateLabel(series.at(-1).date)}</span></div>
    <div class="chart-range page-range" role="group" aria-label="${title} period">
      ${[["7", "7D"], ["30", "30D"], ["all", "All"]].map(([value, label]) => `
        <button id="period-${view}-${value}" data-view-range="${value}" type="button" class="${range === value ? "active" : ""}" aria-pressed="${range === value}">${label}</button>
      `).join("")}
    </div>
  </div>`;
}

function trainingTabs() {
  return `<nav class="section-tabs" aria-label="Training sections">
    <button type="button" data-navigate="training" aria-current="${state.view === "training" ? "page" : "false"}">Summary</button>
    <button type="button" data-navigate="activities" aria-current="${state.view === "activities" ? "page" : "false"}">Activities</button>
  </nav>`;
}

function disclosure(id, title, body, className = "") {
  return `<details class="disclosure ${className}" data-disclosure="${id}" ${state.openDetails.has(id) ? "open" : ""}>
    <summary>${title}</summary><div class="disclosure-body">${body}</div>
  </details>`;
}

function navigateTo(view) {
  if (!views.includes(view)) return;
  if (!state.data) {
    state.view = view;
    location.hash = view;
    return;
  }
  if (location.hash.slice(1) !== view) location.hash = view;
  else {
    state.view = view;
    renderView();
    window.scrollTo({ top: 0 });
  }
}

const darkSeriesColors = {
  "#4f8f76": "#75c9a9", "#315f4c": "#85c9a0", "#5f9ed1": "#8cc6f5",
  "#4d8fca": "#78b9f3", "#8b76c5": "#baace8", "#dc8848": "#f1a86c",
  "#d9803d": "#f1a563", "#d77c3c": "#efa66f", "#87aa31": "#b8d972",
  "#83aa37": "#afd568", "#719c31": "#a5ca65", "#e15d4f": "#f8897c",
  "#73a942": "#a2ca68", "#e69c45": "#ffc37b", "#7a7f7d": "#abbab1",
};
const dashboardPlotColors = {
  light: {
    tick: "#7b8681", grid: "#dde1dc", minorGrid: "#edf0eb", paper: "#fff",
    selected: "#263c33", zoneLine: "#4f8f7690", zoneText: "#3f735f", underlay: "rgb(250 251 247 / 88%)",
  },
  dark: {
    tick: "#a6b4ad", grid: "#324137", minorGrid: "#28362e", paper: "#1a241f",
    selected: "#d0e6da", zoneLine: "#75c9a990", zoneText: "#a4d3ba", underlay: "rgb(26 36 31 / 88%)",
  },
};

function plotColors() {
  return document.documentElement.dataset.theme === "dark" ? dashboardPlotColors.dark : dashboardPlotColors.light;
}

function seriesColor(color) {
  return document.documentElement.dataset.theme === "dark" ? darkSeriesColors[color] || color : color;
}

function chartSwatch(color) {
  return `<i style="background:var(--series-swatch, ${color});--series-swatch-dark:${darkSeriesColors[color] || color}"></i>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateValue(date) {
  return new Date(`${date}T12:00:00Z`);
}

function localDateString(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateLabel(date) {
  return longDateFormat.format(dateValue(date));
}

function shortDateLabel(date) {
  return shortDateFormat.format(dateValue(date));
}

function durationLabel(minutes) {
  if (!Number.isFinite(minutes)) return "—";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${rounded}m`;
  return `${hours}h${remainder ? ` ${remainder}m` : ""}`;
}

function average(values) {
  const present = values.filter((value) => Number.isFinite(value));
  if (!present.length) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function sum(values) {
  return values.filter((value) => Number.isFinite(value)).reduce((a, b) => a + b, 0);
}

function addRollingAverage(data, sourceKey, outputKey, windowSize) {
  let runningTotal = 0;
  const window = [];
  return data.map((item) => {
    const value = Number.isFinite(item[sourceKey]) ? item[sourceKey] : null;
    window.push(value);
    if (value != null) runningTotal += value;

    if (window.length > windowSize) {
      const removed = window.shift();
      if (removed != null) runningTotal -= removed;
    }

    const presentCount = window.filter((entry) => entry != null).length;
    return {
      ...item,
      [outputKey]: presentCount ? runningTotal / presentCount : null,
    };
  });
}

function visibleSeries(range = "30") {
  const history = state.data.historySeries;
  return range === "all" ? history : history.slice(-Number(range));
}

function visibleActivities(range = "all") {
  const series = visibleSeries(range);
  const firstDate = series[0]?.date;
  return state.data.activities.filter((activity) => !firstDate || activity.date >= firstDate);
}

function isSeriesVisible(chartId, label) {
  return state.seriesVisibility[chartId]?.[label] !== false;
}

function trendWindowForChart(chartId) {
  if (!chartsWithTrend.has(chartId)) return null;
  const selected = Number(state.chartTrendWindows[chartId]);
  return trendWindowOptions.includes(selected) ? selected : defaultTrendWindowByChart[chartId];
}

function isChartTrendVisible(chartId) {
  return Boolean(trendWindowForChart(chartId) && state.chartTrendVisibility[chartId] !== false);
}

function saveTrendPreferences() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      "garmin-dashboard-trends",
      JSON.stringify({
        visibility: state.chartTrendVisibility,
        windows: state.chartTrendWindows,
      }),
    );
  } catch {
    // Trend controls still work for the current session if storage is unavailable.
  }
}

function rollingAverageValues(data, key, windowSize) {
  let runningTotal = 0;
  let presentCount = 0;
  const window = [];

  return data.map((item) => {
    const value = Number.isFinite(item[key]) ? item[key] : null;
    window.push(value);
    if (value != null) {
      runningTotal += value;
      presentCount += 1;
    }

    if (window.length > windowSize) {
      const removed = window.shift();
      if (removed != null) {
        runningTotal -= removed;
        presentCount -= 1;
      }
    }

    return presentCount ? runningTotal / presentCount : null;
  });
}

function chartCard(id, title, subtitle, series) {
  const interactiveLegend = series.length > 1;
  const trendWindow = trendWindowForChart(id);
  const trendVisible = isChartTrendVisible(id);
  const legend = series
    .map(
      (item) => {
        const visible = isSeriesVisible(id, item.label);
        if (!interactiveLegend) {
          return `<span>${chartSwatch(item.color)}${escapeHtml(item.label)}</span>`;
        }
        return `
          <button id="series-${id}-${escapeHtml(item.label.replaceAll(" ", "-"))}"
            class="series-toggle ${visible ? "active" : "muted"}"
            data-series-toggle
            data-chart-id="${id}"
            data-series-label="${escapeHtml(item.label)}"
            type="button"
            aria-pressed="${visible}"
            title="${visible ? "Hide" : "Show"} ${escapeHtml(item.label)}"
          >${chartSwatch(item.color)}${escapeHtml(item.label)}</button>
        `;
      },
    )
    .join("");
  const trendControl = trendWindow
    ? `
        <button id="trend-${id}"
          class="trend-toggle ${trendVisible ? "active" : ""}"
          data-chart-trend
          data-chart-id="${id}"
          type="button"
          aria-pressed="${trendVisible}"
          title="Show or hide the trend; daily values remain visible"
        >Smoothed trend</button>
        <select id="trend-window-${id}"
          class="trend-window-select"
          data-chart-trend-window
          data-chart-id="${id}"
          aria-label="${escapeHtml(title)} trend window"
          title="Choose the trailing-average window"
        >
          ${trendWindowOptions
            .map(
              (days) =>
                `<option value="${days}" ${days === trendWindow ? "selected" : ""}>${days}D</option>`,
            )
            .join("")}
        </select>
      `
    : "";
  return `
    <article class="chart-card">
      <header class="card-head">
        <h2 class="sr-only">${escapeHtml(title)}</h2>
        <div class="chart-card-actions">
          <div class="chart-legend">${legend}</div>
          ${trendControl ? disclosure(`${id}-options`, "Chart options", `<div class="chart-controls">${trendControl}</div>`, "chart-options") : ""}
        </div>
      </header>
      <div class="chart-wrap"><canvas id="${id}" role="img" aria-label="${escapeHtml(title)}: ${escapeHtml(subtitle)}"></canvas></div>
    </article>
  `;
}

function activityDateTime(activity) {
  const date = dateLabel(activity.date);
  if (!activity.startTime) return date;
  const start = `${activity.date}T${activity.startTime}`;
  const time = new Date(`${start}:00Z`);
  if (!Number.isFinite(time.getTime())) return date;
  return `${date} · <time datetime="${escapeHtml(start)}">${activityTimeFormat.format(time)}</time>`;
}

function activityRows(activities, limit = activities.length) {
  if (!activities.length) {
    return `<div class="empty-state">No activities match this view.</div>`;
  }
  return `<div class="activity-table-head" aria-hidden="true"><span>Activity</span><span>Duration</span><span>Avg HR</span><span>Effect</span></div>` + activities
    .slice(0, limit)
    .map(
      (activity) => `
        <article class="activity-row">
          <div class="activity-primary">
            <strong>${escapeHtml(activity.name)}</strong>
            <span>${activityDateTime(activity)}${String(activity.name).toLowerCase() === String(activity.type).toLowerCase() ? "" : ` · ${escapeHtml(activity.type)}`}</span>
          </div>
          <div><strong>${durationLabel(activity.durationMinutes)}</strong><span class="sr-only">Duration</span></div>
          <div><strong>${activity.averageHr ? `${activity.averageHr} bpm` : "—"}</strong><span class="sr-only">Average heart rate</span></div>
          <div><strong>${Number.isFinite(activity.trainingEffect) ? activity.trainingEffect.toFixed(1) : "—"}</strong><span class="sr-only">Training effect</span></div>
        </article>
      `,
    )
    .join("");
}

function activityCountSeries(series, activities) {
  const counts = new Map();
  for (const activity of activities) {
    counts.set(activity.date, (counts.get(activity.date) || 0) + 1);
  }
  return series.map((item) => ({ ...item, activityCount: counts.get(item.date) || 0 }));
}

function trainingCalendarDays(range) {
  const dayCount = range === "all" ? state.data.historySeries.length : Number(range);
  const endDate = state.data.latestDate;
  const startDate = shiftIsoDate(endDate, -(dayCount - 1));
  const activitiesByDate = new Map();
  for (const activity of state.data.activities) {
    if (activity.date < startDate || activity.date > endDate) continue;
    const dayActivities = activitiesByDate.get(activity.date) || [];
    dayActivities.push(activity);
    activitiesByDate.set(activity.date, dayActivities);
  }

  return Array.from({ length: dayCount }, (_, index) => {
    const date = shiftIsoDate(startDate, index);
    return { date, activities: activitiesByDate.get(date) || [] };
  });
}

function trainingCalendar() {
  const days = trainingCalendarDays(state.trainingCalendarRange);
  const endDate = state.data.latestDate;

  return `
    <section class="panel training-calendar-panel">
      <header class="card-head training-calendar-head">
        <div>
          <h2>Calendar</h2>
        </div>

      </header>
      <div class="training-calendar-strip" id="training-calendar-strip">
        ${days
          .map((day) => {
            const date = dateValue(day.date);
            const labels = [
              ...new Set(
                day.activities.map((activity) => activity.name || activity.type),
              ),
            ];
            const totalMinutes = sum(
              day.activities.map((activity) => activity.durationMinutes),
            );
            const title = day.activities.length
              ? `${dateLabel(day.date)} · ${day.activities.map((activity) => `${activity.name || activity.type} (${durationLabel(activity.durationMinutes)})`).join(" · ")}`
              : `${dateLabel(day.date)} · No recorded activity`;
            return `
              <article
                class="training-calendar-day ${day.activities.length ? "active" : "rest"} ${day.date === endDate ? "latest" : ""}"
                title="${escapeHtml(title)}"
              >
                <header>
                  <span>${weekdayFormat.format(date)}</span>
                  <strong>${date.getUTCDate()}</strong>
                  <i>${compactMonthFormat.format(date)}</i>
                </header>
                ${
                  day.activities.length
                    ? `<div class="training-calendar-workouts">
                        ${labels
                          .slice(0, 2)
                          .map(
                            (label) =>
                              `<span>${escapeHtml(label)}</span>`,
                          )
                          .join("")}
                        ${labels.length > 2 ? `<small>+${labels.length - 2} more</small>` : ""}
                      </div>
                      <footer>${day.activities.length} ${day.activities.length === 1 ? "session" : "sessions"} · ${durationLabel(totalMinutes)}</footer>`
                    : `<div class="training-calendar-rest"><i></i><span>—</span></div>`
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function shiftIsoDate(value, days) {
  const date = dateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function median(values) {
  const present = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!present.length) return null;
  const middle = Math.floor(present.length / 2);
  return present.length % 2
    ? present[middle]
    : (present[middle - 1] + present[middle]) / 2;
}

function standardDeviation(values) {
  const present = values.filter(Number.isFinite);
  const mean = average(present);
  if (mean == null || present.length < 2) return null;
  return Math.sqrt(average(present.map((value) => (value - mean) ** 2)));
}

function pearsonCorrelation(pairs, xKey, yKey = "sleepScore") {
  const points = pairs
    .map((item) => [item[xKey], item[yKey]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < 20) return null;
  const xMean = average(points.map(([x]) => x));
  const yMean = average(points.map(([, y]) => y));
  const numerator = sum(points.map(([x, y]) => (x - xMean) * (y - yMean)));
  const xSpread = Math.sqrt(sum(points.map(([x]) => (x - xMean) ** 2)));
  const ySpread = Math.sqrt(sum(points.map(([, y]) => (y - yMean) ** 2)));
  if (!xSpread || !ySpread) return null;
  return { value: numerator / (xSpread * ySpread), count: points.length, points };
}

function timeLabel(timestamp) {
  if (!timestamp) return "—";
  const normalized = String(timestamp).replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const sleepFactorDefinitions = [
  {
    key: "dayStress",
    label: "Daytime stress",
    shortLabel: "stress",
    expectedDirection: -1,
    format: (value) => `${Math.round(value)}/100`,
  },
  {
    key: "eveningStress",
    label: "Evening stress",
    shortLabel: "evening stress",
    expectedDirection: -1,
    format: (value) => `${Math.round(value)}/100`,
  },
  {
    key: "eveningHr",
    label: "Evening heart rate",
    shortLabel: "evening heart rate",
    expectedDirection: -1,
    format: (value) => `${Math.round(value)} bpm`,
  },
  {
    key: "dayRestingHr",
    label: "Resting heart rate",
    shortLabel: "resting heart rate",
    expectedDirection: -1,
    format: (value) => `${Math.round(value)} bpm`,
  },
  {
    key: "priorOvernightHrv",
    label: "Prior overnight HRV",
    shortLabel: "prior HRV",
    expectedDirection: 1,
    format: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "hrvBaseline",
    label: "HRV weekly average",
    shortLabel: "HRV baseline",
    expectedDirection: 1,
    format: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "previousSleepScore",
    label: "Previous sleep score",
    shortLabel: "previous sleep",
    expectedDirection: 1,
    format: (value) => `${Math.round(value)}/100`,
  },
  {
    key: "bodyBatteryLatest",
    label: "End-of-day body battery",
    shortLabel: "body battery",
    expectedDirection: 1,
    format: (value) => `${Math.round(value)}/100`,
  },
  {
    key: "intensityMinutes",
    label: "Intensity minutes",
    shortLabel: "intensity",
    format: (value) => `${Math.round(value)} min`,
  },
  {
    key: "activityMinutes",
    label: "Training duration",
    shortLabel: "training duration",
    format: (value) => durationLabel(value),
  },
  {
    key: "steps",
    label: "Steps",
    shortLabel: "steps",
    format: (value) => numberFormat.format(Math.round(value)),
  },
  {
    key: "acuteLoad",
    label: "Acute training load",
    shortLabel: "training load",
    format: (value) => `${Math.round(value)}`,
  },
];

function buildSleepPairs() {
  const historyByDate = new Map(state.data.historySeries.map((item) => [item.date, item]));
  const activitiesByDate = new Map();
  for (const activity of state.data.activities) {
    const values = activitiesByDate.get(activity.date) || [];
    values.push(activity);
    activitiesByDate.set(activity.date, values);
  }

  return state.data.historySeries
    .filter((night) => Number.isFinite(night.sleepScore) || Number.isFinite(night.sleepHours))
    .map((night) => {
      const dayDate = shiftIsoDate(night.date, -1);
      const day = historyByDate.get(dayDate) || {};
      const activities = activitiesByDate.get(dayDate) || [];
      return {
        wakeDate: night.date,
        dayDate,
        sleepScore: night.sleepScore,
        sleepHours: night.sleepHours,
        sleepStress: night.sleepStress,
        overnightHrv: night.overnightHrv,
        sleepRestingHr: night.restingHr,
        preSleepHr2h: night.preSleepHr2h,
        lowHrThreshold: night.lowHrThreshold,
        lowHrPercent: night.lowHrPercent,
        lowHrMinutes: night.lowHrMinutes,
        lowHrScore: night.lowHrScore,
        lowHrEntryMinutes: night.lowHrEntryMinutes,
        lowHrMin5: night.lowHrMin5,
        sleepFirstHourHr: night.sleepFirstHourHr,
        sleepLastHourHr: night.sleepLastHourHr,
        sleepHrDrop: night.sleepHrDrop,
        bodyBatteryChange: night.sleepBodyBatteryChange,
        awakeMinutes: night.sleepAwakeMinutes,
        awakeCount: night.sleepAwakeCount,
        restlessMoments: night.sleepRestlessMoments,
        deepPercent: night.sleepDeepPercent,
        remPercent: night.sleepRemPercent,
        startTimestamp: night.sleepStartTimestamp,
        endTimestamp: night.sleepEndTimestamp,
        feedback: night.sleepFeedback,
        insight: night.sleepInsight,
        dayStress: day.awakeStress ?? day.stress,
        eveningStress: day.eveningStress,
        eveningHr: day.eveningHr,
        dayRestingHr: day.restingHr,
        priorOvernightHrv: day.overnightHrv,
        hrvBaseline: day.hrvWeeklyAverage,
        previousSleepScore: day.sleepScore,
        previousSleepHours: day.sleepHours,
        bodyBatteryLatest: day.bodyBatteryLatest,
        steps: day.steps,
        intensityMinutes: day.intensityMinutes,
        acuteLoad: day.acuteLoad,
        activityCount: activities.length,
        activityMinutes: sum(activities.map((activity) => activity.durationMinutes)),
        averageActivityHr: average(activities.map((activity) => activity.averageHr)),
      };
    });
}

function selectedSleepPairs(pairs) {
  if (state.sleepAnalysisRange === "all") return pairs;
  return pairs.slice(-Number(state.sleepAnalysisRange));
}

function sleepAssociation(pairs, definition) {
  const result = pearsonCorrelation(pairs, definition.key);
  if (!result) return null;
  const ordered = [...result.points].sort((a, b) => a[0] - b[0]);
  const third = Math.max(3, Math.floor(ordered.length / 3));
  const lowSleep = average(ordered.slice(0, third).map(([, score]) => score));
  const highSleep = average(ordered.slice(-third).map(([, score]) => score));
  return {
    ...definition,
    correlation: result.value,
    count: result.count,
    scoreDifference: highSleep - lowSleep,
  };
}

function sleepNightInsights(selected, allPairs, analysisPairs) {
  const selectedIndex = allPairs.findIndex((item) => item.wakeDate === selected.wakeDate);
  const baselinePairs = allPairs.slice(Math.max(0, selectedIndex - 28), selectedIndex);
  const candidates = sleepFactorDefinitions
    .map((definition) => {
      const value = selected[definition.key];
      const baselineValues = baselinePairs.map((item) => item[definition.key]).filter(Number.isFinite);
      const usual = median(baselineValues);
      const spread = standardDeviation(baselineValues);
      const association = sleepAssociation(analysisPairs, definition);
      if (
        !Number.isFinite(value) ||
        !Number.isFinite(usual) ||
        !Number.isFinite(spread) ||
        spread === 0
      ) {
        return null;
      }
      const zScore = (value - usual) / spread;
      const hasPersonalPattern =
        association && Math.abs(association.correlation) >= 0.15;
      const direction = hasPersonalPattern
        ? association.correlation
        : definition.expectedDirection;
      if (!Number.isFinite(direction)) return null;
      const alignedEffect = zScore * direction;
      return {
        definition,
        value,
        usual,
        association,
        hasPersonalPattern,
        zScore,
        alignedEffect,
        relevance: Math.abs(zScore) * (hasPersonalPattern ? Math.abs(direction) : 0.2),
      };
    })
    .filter(Boolean)
    .filter((item) => Math.abs(item.zScore) >= 0.5)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3)
    .map((item) => {
      const higher = item.value > item.usual;
      const supports = item.alignedEffect > 0;
      const historicalDirection = item.association?.correlation > 0 ? "better" : "worse";
      return {
        tone: supports ? "support" : "headwind",
        title: `${item.definition.label} was ${higher ? "higher" : "lower"} than usual`,
        body: item.hasPersonalPattern
          ? `${item.definition.format(item.value)} vs a recent ${item.definition.format(item.usual)}. Historically, higher ${item.definition.shortLabel} has aligned with ${historicalDirection} sleep here.`
          : `${item.definition.format(item.value)} vs a recent ${item.definition.format(item.usual)}. This may be a ${supports ? "support" : "headwind"}; keep watching as more paired nights accumulate.`,
      };
    });

  const outcomeInsights = [];
  if (Number.isFinite(selected.sleepStress)) {
    outcomeInsights.push({
      tone: selected.sleepStress <= 20 ? "support" : selected.sleepStress >= 30 ? "headwind" : "neutral",
      title: `Overnight stress was ${selected.sleepStress <= 20 ? "low" : selected.sleepStress >= 30 ? "elevated" : "moderate"}`,
      body: `${Math.round(selected.sleepStress)}/100 average during sleep${Number.isFinite(selected.overnightHrv) ? `, alongside ${Math.round(selected.overnightHrv)} ms overnight HRV` : ""}.`,
    });
  }
  if (Number.isFinite(selected.sleepHours)) {
    outcomeInsights.push({
      tone: selected.sleepHours >= 7 ? "support" : "headwind",
      title: `${selected.sleepHours >= 7 ? "Adequate" : "Short"} sleep duration`,
      body: `${selected.sleepHours.toFixed(1)} hours asleep from ${timeLabel(selected.startTimestamp)} to ${timeLabel(selected.endTimestamp)}.`,
    });
  }

  return [...candidates, ...outcomeInsights].slice(0, 4);
}

function sleepFactorValue(label, value, note, tone = "") {
  return `
    <article class="sleep-factor ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <i>${escapeHtml(note)}</i>
    </article>
  `;
}


function sleepNightHeader(allPairs, wakeDate) {
  const first = allPairs[0]?.wakeDate || state.data.coverage.earliestDate;
  const last = state.data.latestDate;
  const previous = shiftIsoDate(wakeDate, -1);
  const next = shiftIsoDate(wakeDate, 1);
  return `<section class="sleep-night-header">
    <span class="night-score">Sleep score <strong>${Number.isFinite(allPairs.find(item => item.wakeDate === wakeDate)?.sleepScore) ? Math.round(allPairs.find(item => item.wakeDate === wakeDate).sleepScore) + '/100' : '—'}</strong></span>
    <div class="night-picker">
      <button class="icon-button" data-sleep-nav-date="${previous}" type="button" aria-label="Previous night" ${previous < first ? 'disabled' : ''}>‹</button>
      <input id="sleep-night-select" type="date" aria-label="Night ending" min="${first}" max="${last}" value="${wakeDate}" />
      <button class="icon-button" data-sleep-nav-date="${next}" type="button" aria-label="Next night" ${next > last ? 'disabled' : ''}>›</button>
    </div>
  </section>`;
}

function renderSleep() {
  const allPairs = buildSleepPairs();
  if (!allPairs.length) return '<div class="empty-state">No sleep records are available.</div>';
  const selected = allPairs.find(item => item.wakeDate === state.sleepDate);
  if (!selected) return `${sleepNightHeader(allPairs, state.sleepDate)}
    <section class="panel empty-state">
      <h2>No sleep recorded</h2>
      <button class="button secondary" data-sleep-date="${allPairs.at(-1).wakeDate}" type="button">Latest recorded night</button>
    </section>`;

  const analysisPairs = selectedSleepPairs(allPairs);
  const insights = sleepNightInsights(selected, allPairs, analysisPairs).slice(0, 3);
  const associations = sleepFactorDefinitions
    .map(definition => sleepAssociation(analysisPairs, definition))
    .filter(item => item && Math.abs(item.correlation) >= 0.15)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, 3);
  const rangeOptions = [['7', '7 nights'], ['14', '14 nights'], ['30', '30 nights']]
    .map(([value, label]) => `<option value="${value}" ${state.sleepAnalysisRange === value ? 'selected' : ''}>${label}</option>`).join('');
  const pairsByDate = new Map(allPairs.map(item => [item.wakeDate, item]));
  const recentNights = Array.from({length: 7}, (_, i) => shiftIsoDate(state.data.latestDate, -i));

  const details = `
    <div class="sleep-quick-metrics sleep-detail-values">
      <span><strong>${Number.isFinite(selected.sleepHours) ? durationLabel(selected.sleepHours * 60) : '—'}</strong> duration</span>
      <span><strong>${Number.isFinite(selected.overnightHrv) ? Math.round(selected.overnightHrv) + ' ms' : '—'}</strong> HRV</span>
      <span><strong>${Number.isFinite(selected.sleepRestingHr) ? Math.round(selected.sleepRestingHr) + ' bpm' : '—'}</strong> resting HR</span>
      <span><strong>${Number.isFinite(selected.sleepStress) ? Math.round(selected.sleepStress) + '/100' : '—'}</strong> sleep stress</span>
    </div>
    <div class="detail-section-heading">
      <h2>Compared with your baseline</h2>
      <label class="inline-field"><span>Compare over</span><select id="sleep-analysis-range">${rangeOptions}</select></label>
    </div>
    <div class="sleep-glance-grid">
      ${insights.map(item => `<article class="sleep-glance-card">
        <strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p>
      </article>`).join('')}
    </div>
    <div class="detail-section-heading"><h2>Related patterns</h2><span>${analysisPairs.length} recorded nights</span></div>
    <div class="sleep-pattern-compact-list">
      ${associations.length ? associations.map(item => `<article>
        <div><strong>${escapeHtml(item.label)}</strong><span>${Math.abs(item.scoreDifference).toFixed(1)} point ${item.scoreDifference >= 0 ? 'higher' : 'lower'} sleep score in the higher group</span></div>
      </article>`).join('') : '<p class="subtle">No clear associations in this period.</p>'}
    </div>
    <p class="analysis-note">These are associations in your recorded data, not explanations of cause.</p>
    <div class="detail-section-heading"><h2>The day before</h2><span>${dateLabel(selected.dayDate)}</span></div>
    <div class="sleep-factor-grid">
      ${sleepFactorValue('Daytime stress', Number.isFinite(selected.dayStress) ? Math.round(selected.dayStress) + '/100' : '—', Number.isFinite(selected.eveningStress) ? 'Evening ' + Math.round(selected.eveningStress) + '/100' : '', 'orange')}
      ${sleepFactorValue('Resting HR', Number.isFinite(selected.dayRestingHr) ? Math.round(selected.dayRestingHr) + ' bpm' : '—', Number.isFinite(selected.eveningHr) ? 'Evening ' + Math.round(selected.eveningHr) + ' bpm' : '')}
      ${sleepFactorValue('Prior HRV', Number.isFinite(selected.priorOvernightHrv) ? Math.round(selected.priorOvernightHrv) + ' ms' : '—', 'Previous overnight', 'violet')}
      ${sleepFactorValue('Training', durationLabel(selected.activityMinutes), selected.activityCount + ' sessions')}
      ${sleepFactorValue('Steps', Number.isFinite(selected.steps) ? numberFormat.format(Math.round(selected.steps)) : '—', '')}
      ${sleepFactorValue('Body battery', Number.isFinite(selected.bodyBatteryLatest) ? Math.round(selected.bodyBatteryLatest) + '/100' : '—', 'End of day')}
    </div>`;

  return `
    ${sleepNightHeader(allPairs, selected.wakeDate)}
    <section class="chart-stack">
      ${chartCard("sleep-trend-chart", "Sleep score and stress", "Nightly records", [
        { label: "Sleep score", color: "#5f9ed1" }, { label: "Sleep stress", color: "#dc8848" },
      ])}
    </section>
    <section class="panel recent-nights">
      <header class="card-head"><h2>Recent nights</h2></header>
      <div class="sleep-night-strip">
        ${recentNights.map(wakeDate => {
          const item = pairsByDate.get(wakeDate);
          const qualityTone = !Number.isFinite(item?.sleepScore) ? 'neutral' : item.sleepScore >= 80 ? 'good' : item.sleepScore >= 60 ? 'fair' : 'poor';
          return `<button class="${qualityTone} ${wakeDate === selected.wakeDate ? 'active' : ''}" data-sleep-date="${wakeDate}" type="button" aria-pressed="${wakeDate === selected.wakeDate}" aria-label="${dateLabel(wakeDate)}${item ? ', sleep score ' + (item.sleepScore ?? 'unavailable') : ', no sleep data'}">
            <span>${shortDateLabel(wakeDate)}</span>
            <strong>${Number.isFinite(item?.sleepScore) ? Math.round(item.sleepScore) : '—'}</strong>
            <small>${Number.isFinite(item?.sleepHours) ? durationLabel(item.sleepHours * 60) : 'No data'}</small>
          </button>`;
        }).join('')}
      </div>
    </section>
    ${disclosure('sleep-details', 'Sleep details', details, 'panel sleep-analysis-details')}
  `;
}



function renderOverview() {
  const activities = visibleActivities(state.viewRanges.overview);
  return `
    ${periodToolbar('Overview')}
    <section class="chart-grid">
      ${chartCard('overview-recovery-chart', 'Sleep score', 'Daily scores', [
        {label: 'Sleep', color: '#5f9ed1'}
      ])}
      ${chartCard('overview-steps-chart', 'Steps', 'Daily movement', [
        {label: 'Steps', color: '#87aa31'}, {label: '30-day average', color: '#315f4c'}, {label: 'Today so far', color: '#d77c3c'}
      ])}
    </section>
    <section class="panel overview-activities">
      <header class="card-head"><h2>Recent activities</h2>
        <button class="text-button" data-navigate="activities" type="button">View all →</button>
      </header>
      <div class="activity-list">${activityRows(activities, 4)}</div>
    </section>`;
}

function renderRecovery() {
  return `
    ${periodToolbar("Recovery trends")}
    <section class="chart-grid">
      ${chartCard("recovery-score-chart", "Recovery scorecard", "Sleep and body battery", [
        { label: "Sleep", color: "#5f9ed1" },
        { label: "Body battery", color: "#83aa37" },
      ])}
      ${chartCard("recovery-baseline-chart", "Cardiovascular baseline", "Resting heart rate and HRV", [
        { label: "Resting HR", color: "#dc8848" },
        { label: "HRV", color: "#4d8fca" },
      ])}
    </section>


  `;
}



function renderTraining() {
  return `
    ${periodToolbar('Training')}
    ${trainingCalendar()}
    <section class="chart-grid">
      ${chartCard('training-volume-chart', 'Training volume', 'Intensity minutes and sessions', [
        {label: 'Intensity', color: '#719c31'}, {label: 'Sessions', color: '#4d8fca'}
      ])}
    </section>`;
}

function filteredActivities() {
  return visibleActivities("all").filter((activity) => {
    const matchesType = state.activityType === "all" || activity.type === state.activityType;
    const haystack = `${activity.name} ${activity.type} ${activity.date}`.toLowerCase();
    return matchesType && haystack.includes(state.activitySearch.toLowerCase());
  });
}

function renderActivitiesView() {
  const types = [...new Set(state.data.activities.map((item) => item.type))].sort();
  const activities = filteredActivities();
  return `
    <section class="panel">
      <header class="activity-toolbar">
        <span class="sr-only" role="status">${numberFormat.format(activities.length)} matching activities</span>
        <div class="filters">
          <input id="activity-search" type="search" aria-label="Search activities" value="${escapeHtml(state.activitySearch)}" placeholder="Search activities" />
          <select id="activity-type-filter" aria-label="Activity type">
            <option value="all">All types</option>
            ${types.map((type) => `<option value="${escapeHtml(type)}" ${state.activityType === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
          </select>
        </div>
      </header>
      <div class="activity-list full">${activityRows(activities, state.activityLimit)}</div>
      ${activities.length > state.activityLimit ? `<div class="list-footer"><span class="subtle">${state.activityLimit} of ${numberFormat.format(activities.length)}</span><button class="button secondary" id="more-activities" type="button">Show more</button></div>` : ""}
    </section>
  `;
}

function renderTimeline() {
  return `
    ${periodToolbar("History")}
    <section class="chart-grid">
      ${chartCard("timeline-health-chart", "Long-term health", "Resting heart rate and sleep", [
        { label: "Resting HR", color: "#dc8848" },
        { label: "Sleep", color: "#5f9ed1" },
      ])}
      ${chartCard("timeline-movement-chart", "Long-term movement", "Daily steps", [
        { label: "Steps", color: "#83aa37" },
        { label: "30-day average", color: "#315f4c" },
        { label: "Today so far", color: "#d77c3c" },
      ])}
    </section>
  `;
}

function renderView() {
  const focusedId = document.activeElement?.id;
  const [, title] = viewMeta[state.view];
  const activeView = state.view === "activities" ? "training" : state.view;
  document.querySelector("#view-title").textContent = title;
  document.querySelectorAll(".main-nav [data-view]").forEach((button) => {
    const active = button.dataset.view === activeView;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  const container = document.querySelector("#app-view");
  document.querySelector("#chart-tooltip").hidden = true;
  const renderers = {
    overview: renderOverview,
    recovery: renderRecovery,
    sleep: renderSleep,
    training: renderTraining,
    activities: renderActivitiesView,
    timeline: renderTimeline,
  };
  container.innerHTML =
    (["training", "activities"].includes(state.view) ? trainingTabs() : "") + renderers[state.view]();
  bindViewEvents();
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  requestAnimationFrame(drawViewCharts);
}

function drawLineChart(canvasId, data, definitions, options = {}) {
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas || !data.length) return;
  definitions = definitions
    .filter((definition) => isSeriesVisible(canvasId, definition.label))
    .map((definition) => ({ ...definition, color: seriesColor(definition.color) }));
  if (!definitions.length) return;
  data = trimToAvailableData(
    data,
    definitions.map((definition) => definition.key),
  );
  if (!data.length) return;
  const leftDefinitions = definitions.filter((definition) => definition.axis !== "right");
  const rightDefinitions = definitions.filter((definition) => definition.axis === "right");
  const trendWindow = trendWindowForChart(canvasId);
  const showTrend = Boolean(trendWindow && isChartTrendVisible(canvasId));
  const hasAverageOverlay = definitions.some((definition) =>
    definition.label.toLowerCase().includes("average"),
  );
  const parent = canvas.parentElement;
  const rect = parent.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(240, rect.width);
  const height = Math.max(220, rect.height);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.scale(dpr, dpr);
  const colors = plotColors();

  const pad = {
    top: 28,
    right: rightDefinitions.length ? 48 : 18,
    bottom: 30,
    left: leftDefinitions.length ? 48 : 18,
  };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const valueScale = (
    axisDefinitions,
    { minimum, maximum, integerTicks = false } = {},
  ) => {
    const values = axisDefinitions.flatMap((definition) =>
      data.map((item) => item[definition.key]).filter(Number.isFinite),
    );
    if (!values.length) return null;
    let min = minimum ?? Math.min(...values);
    let max = maximum ?? Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    if (integerTicks) {
      min = minimum ?? Math.floor(min);
      max =
        maximum ??
        Math.max(min + 4, Math.ceil(max / 4) * 4);
    } else {
      const buffer =
        minimum == null || maximum == null ? (max - min) * 0.08 : 0;
      min = minimum ?? min - buffer;
      max = maximum ?? max + buffer;
    }
    return { min, max };
  };
  const leftScale = valueScale(leftDefinitions, {
    minimum: options.min,
    maximum: options.max,
  });
  const rightScale = valueScale(rightDefinitions, {
    minimum: options.rightMin,
    maximum: options.rightMax,
    integerTicks: options.rightIntegerTicks,
  });
  if (!leftScale && !rightScale) return;

  const dayMillis = 86_400_000;
  const dataStartTime = dateValue(data[0].date).getTime();
  const dataEndTime = dateValue(data.at(-1).date).getTime();
  const dayBarPadding =
    Math.max(0, ...definitions.map((definition) => definition.barDays || 0)) *
    dayMillis /
    2;
  const startTime = dataStartTime - dayBarPadding;
  const endTime = dataEndTime + dayBarPadding;
  const xForTime = (timestamp) =>
    pad.left + ((timestamp - startTime) / Math.max(endTime - startTime, 1)) * plotWidth;
  const xForIndex = (index) => xForTime(dateValue(data[index].date).getTime());
  const scaleForDefinition = (definition) =>
    definition.axis === "right" ? rightScale : leftScale;
  const yForValue = (value, definition) => {
    const scale = scaleForDefinition(definition);
    return scale
      ? pad.top +
          (1 - (value - scale.min) / (scale.max - scale.min)) * plotHeight
      : null;
  };
  const spanDays = Math.max(
    1,
    Math.round((dataEndTime - dataStartTime) / dayMillis),
  );
  const tickCount = width < 520 ? 4 : width < 900 ? 5 : 7;
  const tickIndices = chartTickIndices(data, tickCount);
  const validIndices = data
    .map((item, index) =>
      definitions.some((definition) => Number.isFinite(item[definition.key])) ? index : null,
    )
    .filter((index) => index != null);

  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "middle";
  for (let line = 0; line <= 4; line += 1) {
    const ratio = line / 4;
    const y = pad.top + ratio * plotHeight;
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(width - pad.right, y);
    context.stroke();
    if (leftScale) {
      const value = leftScale.max - ratio * (leftScale.max - leftScale.min);
      context.fillStyle = colors.tick;
      context.textAlign = "right";
      context.fillText(
        options.axisFormat ? options.axisFormat(value) : Math.round(value),
        pad.left - 8,
        y,
      );
    }
    if (rightScale) {
      const value = rightScale.max - ratio * (rightScale.max - rightScale.min);
      context.fillStyle = rightDefinitions[0]?.color || colors.tick;
      context.textAlign = "left";
      context.fillText(
        options.rightAxisFormat
          ? options.rightAxisFormat(value)
          : Math.round(value),
        width - pad.right + 8,
        y,
      );
    }
  }

  tickIndices.forEach((index) => {
    const x = xForIndex(index);
    context.strokeStyle = colors.minorGrid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, pad.top);
    context.lineTo(x, height - pad.bottom);
    context.stroke();
  });

  const strokePoints = (points, definition, { alpha = 1, width, dash = [] } = {}) => {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = definition.color;
    context.lineWidth = width || definition.width || 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.setLineDash(dash);
    context.beginPath();
    let drawing = false;
    for (const point of points) {
      if (point.y == null) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        context.moveTo(point.x, point.y);
        drawing = true;
      } else {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
    context.restore();
  };

  const drawingDefinitions = [...definitions].sort(
    (first, second) => Number(Boolean(second.bar)) - Number(Boolean(first.bar)),
  );
  const trendValuesByKey = new Map(
    definitions.map((definition) => [
      definition.key,
      showTrend
        ? rollingAverageValues(data, definition.key, trendWindow)
        : [],
    ]),
  );
  const barDefinitions = drawingDefinitions.filter((definition) => definition.bar);
  drawingDefinitions.forEach((definition, definitionIndex) => {
    const points = data.map((item, index) => ({
      x: xForIndex(index),
      y: Number.isFinite(item[definition.key])
        ? yForValue(item[definition.key], definition)
        : null,
      value: item[definition.key],
    }));

    if (definition.fill && definitionIndex === 0 && !showTrend && !hasAverageOverlay) {
      const gradient = context.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      gradient.addColorStop(0, `${definition.color}38`);
      gradient.addColorStop(1, `${definition.color}00`);
      context.fillStyle = gradient;
      context.beginPath();
      let started = false;
      for (const point of points) {
        if (point.y == null) continue;
        if (!started) {
          context.moveTo(point.x, height - pad.bottom);
          context.lineTo(point.x, point.y);
          started = true;
        } else {
          context.lineTo(point.x, point.y);
        }
      }
      if (started) {
        const lastPoint = [...points].reverse().find((point) => point.y != null);
        context.lineTo(lastPoint.x, height - pad.bottom);
        context.closePath();
        context.fill();
      }
    }

    if (definition.bar) {
      const slotWidth = plotWidth / data.length;
      const groupWidth = Math.max(2, Math.min(22, slotWidth * 0.78));
      const gap = barDefinitions.length > 1 ? Math.min(2, groupWidth * 0.08) : 0;
      const barWidth = Math.max(
        0.75,
        (groupWidth - gap * (barDefinitions.length - 1)) / barDefinitions.length,
      );
      const barIndex = barDefinitions.indexOf(definition);
      const definitionScale = scaleForDefinition(definition);
      const baseline = yForValue(
        definition.axis === "right"
          ? options.rightBarBaseline ?? definitionScale.min
          : options.barBaseline ?? definitionScale.min,
        definition,
      );
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (point.y == null) continue;
        const dayWidth = definition.barDays
          ? xForTime(
              dateValue(data[index].date).getTime() +
                (definition.barDays * dayMillis) / 2,
            ) -
            xForTime(
              dateValue(data[index].date).getTime() -
                (definition.barDays * dayMillis) / 2,
            )
          : null;
        const renderedBarWidth = dayWidth
          ? Math.max(0.75, dayWidth - 1)
          : barWidth;
        const x = definition.barDays
          ? point.x - renderedBarWidth / 2
          : point.x - groupWidth / 2 + barIndex * (barWidth + gap);
        context.fillStyle =
          data[index].date === state.sleepDate ? definition.color : `${definition.color}a8`;
        context.fillRect(x, point.y, renderedBarWidth, Math.max(1, baseline - point.y));
      }
      if (showTrend) {
        const trendValues = trendValuesByKey.get(definition.key);
        const trendPoints = trendValues.map((value, index) => ({
          x: xForIndex(index),
          y: Number.isFinite(value) ? yForValue(value, definition) : null,
        }));
        strokePoints(trendPoints, definition, {
          width: Math.max(2.4, definition.width || 2),
        });
      }
      return;
    }

    if (definition.pointOnly) {
      context.fillStyle = colors.paper;
      context.strokeStyle = definition.color;
      context.lineWidth = 2.5;
      for (const point of points) {
        if (point.y == null) continue;
        context.beginPath();
        context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
      return;
    }

    const isCalculatedAverage = definition.label.toLowerCase().includes("average");
    const softenDailyLine = showTrend || (hasAverageOverlay && !isCalculatedAverage);
    strokePoints(points, definition, {
      alpha: softenDailyLine ? 0.3 : 1,
      width: softenDailyLine ? Math.max(1, (definition.width || 2) * 0.6) : undefined,
    });

    if (showTrend) {
      const trendValues = trendValuesByKey.get(definition.key);
      const trendPoints = trendValues.map((value, index) => ({
        x: xForIndex(index),
        y: Number.isFinite(value) ? yForValue(value, definition) : null,
      }));
      strokePoints(trendPoints, definition, {
        width: Math.max(2.4, definition.width || 2),
      });
    }

    if (definition.points) {
      const pointRadius = Math.max(0.8, Math.min(2.8, (plotWidth / data.length) * 0.16));
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (point.y == null) continue;
        const selected = data[index].date === state.sleepDate;
        context.beginPath();
        context.arc(point.x, point.y, selected ? Math.max(3.6, pointRadius) : pointRadius, 0, Math.PI * 2);
        context.fillStyle = selected ? colors.selected : definition.color;
        context.fill();
      }
    }
  });

  context.fillStyle = colors.tick;
  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  tickIndices.forEach((index, tickPosition) => {
    const x = xForIndex(index);
    context.textAlign =
      tickPosition === 0 ? "left" : tickPosition === tickIndices.length - 1 ? "right" : "center";
    context.fillText(axisDateLabel(data[index].date, spanDays), x, height - 12);
  });

  parent.querySelector(".chart-hover-overlay")?.remove();
  const hoverOverlay = document.createElement("div");
  hoverOverlay.className = "chart-hover-overlay";
  hoverOverlay.hidden = true;
  const hoverGuide = document.createElement("i");
  hoverGuide.className = "chart-hover-guide";
  hoverOverlay.append(hoverGuide);
  const hoverDots = definitions.map((definition) => {
    const dot = document.createElement("i");
    dot.className = "chart-hover-dot";
    dot.style.setProperty("--point-color", definition.color);
    hoverOverlay.append(dot);
    return dot;
  });
  parent.append(hoverOverlay);

  canvas.onmousemove = (event) => {
    const canvasRect = canvas.getBoundingClientRect();
    const x = event.clientX - canvasRect.left;
    const targetTime = startTime + ((x - pad.left) / plotWidth) * (endTime - startTime);
    const index = validIndices.reduce(
      (closest, candidate) =>
        Math.abs(dateValue(data[candidate].date).getTime() - targetTime) <
        Math.abs(dateValue(data[closest].date).getTime() - targetTime)
          ? candidate
          : closest,
      validIndices[0] ?? 0,
    );
    const item = data[index];
    const snappedX = xForIndex(index);

    hoverOverlay.hidden = false;
    hoverGuide.style.left = `${snappedX}px`;
    hoverGuide.style.top = `${pad.top}px`;
    hoverGuide.style.height = `${plotHeight}px`;
    definitions.forEach((definition, definitionIndex) => {
      const dot = hoverDots[definitionIndex];
      const value = item[definition.key];
      dot.hidden = !Number.isFinite(value);
      if (Number.isFinite(value)) {
        dot.style.left = `${snappedX}px`;
        dot.style.top = `${yForValue(value, definition)}px`;
      }
    });

    const lines = definitions
      .map((definition) => {
        const absoluteValue = item[definition.key];
        const trendValue = trendValuesByKey.get(definition.key)?.[index];
        if (!Number.isFinite(absoluteValue) && !Number.isFinite(trendValue)) {
          return "";
        }
        const absoluteLine = `<span><i style="background:${definition.color}"></i>${escapeHtml(definition.label)} <strong>${Number.isFinite(absoluteValue) ? escapeHtml(definition.format(absoluteValue)) : "—"}</strong></span>`;
        const trendLine =
          showTrend && Number.isFinite(trendValue)
            ? `<span class="tooltip-average"><i style="background:${definition.color}"></i>${trendWindow}D average<strong>${escapeHtml((definition.trendFormat || definition.format)(trendValue))}</strong></span>`
            : "";
        return `${absoluteLine}${trendLine}`;
      })
      .join("");
    const tooltip = document.querySelector("#chart-tooltip");
    tooltip.innerHTML = `<b>${dateLabel(item.date)}</b>${lines}`;
    tooltip.hidden = false;
    const snappedClientX = canvasRect.left + snappedX;
    tooltip.style.left = `${Math.min(window.innerWidth - 230, snappedClientX + 14)}px`;
    tooltip.style.top = `${Math.max(12, event.clientY - 30)}px`;
  };
  canvas.onmouseleave = () => {
    hoverOverlay.hidden = true;
    document.querySelector("#chart-tooltip").hidden = true;
  };
}

function drawViewCharts({ keepCalendarPosition = false } = {}) {
  if (state.view === "overview") {
    const recoverySeries = visibleSeries(state.chartRanges["overview-recovery-chart"]);
    const stepsSeries = visibleSeries(state.chartRanges["overview-steps-chart"]);
    drawLineChart(
      "overview-recovery-chart",
      recoverySeries,
      [
        { key: "sleepScore", label: "Sleep", color: "#5f9ed1", format: (v) => `${Math.round(v)}/100`, fill: true },
      ],
      { min: 0, max: 100 },
    );
    drawLineChart(
      "overview-steps-chart",
      stepsSeries,
      [
        { key: "steps", label: "Steps", color: "#87aa31", format: (v) => numberFormat.format(Math.round(v)), fill: true, width: 1.5 },
        { key: "stepsRolling30", label: "30-day average", color: "#315f4c", format: (v) => numberFormat.format(Math.round(v)), width: 2.8 },
        { key: "stepsPartial", label: "Today so far", color: "#d77c3c", format: (v) => numberFormat.format(Math.round(v)), pointOnly: true },
      ],
      { min: 0, axisFormat: (v) => `${Math.max(0, Math.round(v / 1000))}k` },
    );
  }
  if (state.view === "recovery") {
    const scoreSeries = visibleSeries(state.chartRanges["recovery-score-chart"]);
    const baselineSeries = visibleSeries(state.chartRanges["recovery-baseline-chart"]);
    drawLineChart(
      "recovery-score-chart",
      scoreSeries,
      [
        { key: "sleepScore", label: "Sleep", color: "#5f9ed1", format: (v) => `${Math.round(v)}/100`, fill: true },
        { key: "bodyBatteryHigh", label: "Body battery", color: "#83aa37", format: (v) => `${Math.round(v)}/100` },
      ],
      { min: 0, max: 100 },
    );
    drawLineChart("recovery-baseline-chart", baselineSeries, [
      { key: "restingHr", label: "Resting HR", color: "#dc8848", format: (v) => `${Math.round(v)} bpm`, fill: true },
      { key: "hrvWeeklyAverage", label: "HRV", color: "#4d8fca", format: (v) => `${Math.round(v)} ms` },
    ]);
    drawGranularRecoveryChart(
      "recovery-granular-chart",
      state.chartRanges["recovery-granular-chart"],
    );
  }
  if (state.view === "sleep") {
    drawLineChart("sleep-trend-chart", visibleSeries(state.chartRanges["sleep-trend-chart"]), [
      { key: "sleepScore", label: "Sleep score", color: "#5f9ed1", format: (v) => `${Math.round(v)}/100`, fill: true },
      { key: "sleepStress", label: "Sleep stress", color: "#dc8848", format: (v) => `${Math.round(v)}/100` },
    ], { min: 0, max: 100 });
  }
  if (state.view === "training") {
    const calendarStrip = document.querySelector("#training-calendar-strip");
    if (calendarStrip && !keepCalendarPosition) calendarStrip.scrollLeft = calendarStrip.scrollWidth;
    const volumeRange = state.chartRanges["training-volume-chart"];
    const volumeSeries = activityCountSeries(
      visibleSeries(volumeRange),
      visibleActivities(volumeRange),
    );
    drawLineChart("training-volume-chart", volumeSeries, [
      { key: "intensityMinutes", label: "Intensity", color: "#719c31", format: (v) => `${Math.round(v)} min`, fill: true },
      { key: "activityCount", label: "Sessions", color: "#4d8fca", format: (v) => Math.round(v), trendFormat: (v) => v.toFixed(1), width: 2.5, axis: "right", bar: true, barDays: 1 },
    ], {
      min: 0,
      rightMin: 0,
      rightIntegerTicks: true,
    });
  }
  if (state.view === "timeline") {
    const healthSeries = visibleSeries(state.chartRanges["timeline-health-chart"]);
    const movementSeries = visibleSeries(state.chartRanges["timeline-movement-chart"]);
    drawLineChart("timeline-health-chart", healthSeries, [
      { key: "restingHr", label: "Resting HR", color: "#dc8848", format: (v) => `${Math.round(v)} bpm`, fill: true },
      { key: "sleepScore", label: "Sleep", color: "#5f9ed1", format: (v) => `${Math.round(v)}/100` },
    ]);
    drawLineChart(
      "timeline-movement-chart",
      movementSeries,
      [
        { key: "steps", label: "Steps", color: "#83aa37", format: (v) => numberFormat.format(Math.round(v)), fill: true, width: 1.2 },
        { key: "stepsRolling30", label: "30-day average", color: "#315f4c", format: (v) => numberFormat.format(Math.round(v)), width: 2.8 },
        { key: "stepsPartial", label: "Today so far", color: "#d77c3c", format: (v) => numberFormat.format(Math.round(v)), pointOnly: true },
      ],
      { min: 0, axisFormat: (v) => `${Math.max(0, Math.round(v / 1000))}k` },
    );
  }
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function bindViewEvents() {
  document.querySelectorAll("[data-disclosure]").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.open) state.openDetails.add(details.dataset.disclosure);
      else state.openDetails.delete(details.dataset.disclosure);
    });
  });
  document.querySelectorAll("[data-navigate]").forEach((button) => {
    button.addEventListener("click", () => navigateTo(button.dataset.navigate));
  });
  document.querySelectorAll("[data-view-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const range = button.dataset.viewRange;
      state.viewRanges[state.view] = range;
      for (const id of viewChartIds[state.view] || []) state.chartRanges[id] = range;
      if (state.view === "training") state.trainingCalendarRange = range;
      renderView();
    });
  });
  document.querySelectorAll("[data-chart-range-select]").forEach((select) => {
    select.addEventListener("change", () => {
      state.chartRanges[select.dataset.chartId] = select.value;
      renderView();
    });
  });
  document.querySelector("#more-activities")?.addEventListener("click", () => {
    state.activityLimit += 50;
    renderView();
  });
  document.querySelectorAll("[data-chart-trend]").forEach((button) => {
    button.addEventListener("click", () => {
      const chartId = button.dataset.chartId;
      state.chartTrendVisibility[chartId] = !button.classList.contains("active");
      saveTrendPreferences();
      renderView();
    });
  });
  document.querySelectorAll("[data-chart-trend-window]").forEach((select) => {
    select.addEventListener("change", () => {
      const chartId = select.dataset.chartId;
      state.chartTrendWindows[chartId] = Number(select.value);
      state.chartTrendVisibility[chartId] = true;
      saveTrendPreferences();
      renderView();
    });
  });
  document.querySelectorAll("[data-series-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const chartId = button.dataset.chartId;
      const label = button.dataset.seriesLabel;
      const peers = [...document.querySelectorAll("[data-series-toggle]")].filter(
        (peer) => peer.dataset.chartId === chartId,
      );
      const visiblePeers = peers.filter((peer) => peer.classList.contains("active"));
      if (button.classList.contains("active") && visiblePeers.length === 1) {
        showToast("Keep at least one series visible");
        return;
      }
      state.seriesVisibility[chartId] ||= {};
      state.seriesVisibility[chartId][label] = !button.classList.contains("active");
      renderView();
    });
  });
  document.querySelector("#activity-search")?.addEventListener("input", (event) => {
    state.activitySearch = event.target.value;
    state.activityLimit = 50;
    renderView();
    requestAnimationFrame(() => {
      const input = document.querySelector("#activity-search");
      input?.focus();
      input?.setSelectionRange(state.activitySearch.length, state.activitySearch.length);
    });
  });
  document.querySelector("#activity-type-filter")?.addEventListener("change", (event) => {
    state.activityType = event.target.value;
    state.activityLimit = 50;
    renderView();
  });
  document.querySelector("#sleep-night-select")?.addEventListener("change", (event) => {
    if (!event.target.value || !event.target.validity.valid) return;
    state.sleepDate = event.target.value;
    renderView();
  });
  document.querySelector("#sleep-analysis-range")?.addEventListener("change", (event) => {
    state.sleepAnalysisRange = event.target.value;
    renderView();
  });
  document.querySelectorAll("[data-sleep-nav-date]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!button.dataset.sleepNavDate) return;
      state.sleepDate = button.dataset.sleepNavDate;
      renderView();
    });
  });
  document.querySelectorAll("[data-sleep-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sleepDate = button.dataset.sleepDate;
      renderView();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

}

function loadData(data, mode) {
  state.data = data;
  const today = localDateString();
  const latestRow = state.data.historySeries.find((item) => item.date === today);
  const hasPartialToday = mode === "garmin" && state.data.latestDate === today && Number.isFinite(latestRow?.steps);
  state.data.todaySteps = hasPartialToday ? latestRow.steps : null;
  state.data.historySeries = state.data.historySeries.map((item) => ({
    ...item,
    stepsPartial: hasPartialToday && item.date === today ? item.steps : null,
    steps: hasPartialToday && item.date === today ? null : item.steps,
  }));
  state.data.historySeries = addRollingAverage(
    state.data.historySeries,
    "steps",
    "stepsRolling30",
    30,
  );
  if (hasPartialToday) {
    const todayIndex = state.data.historySeries.findIndex((item) => item.date === today);
    if (todayIndex > 0) {
      state.data.historySeries[todayIndex].stepsRolling30 =
        state.data.historySeries[todayIndex - 1].stepsRolling30;
    }
  }
  state.data.series = state.data.historySeries.slice(-90);
  state.sleepDate =
    [...state.data.historySeries].reverse().find((item) => Number.isFinite(item.sleepScore) || Number.isFinite(item.sleepHours))?.date ||
    state.data.latestDate;
}

document.querySelectorAll(".main-nav [data-view]").forEach((button) => {
  button.addEventListener("click", () => navigateTo(button.dataset.view));
});

window.addEventListener("hashchange", () => {
  const view = location.hash.slice(1) || "overview";
  if (!views.includes(view)) return;
  state.view = view;
  if (!state.data || emptySnapshot()) return;
  renderView();
  window.scrollTo({ top: 0 });
  document.querySelector("#view-title").focus({ preventScroll: true });
});

document.addEventListener("pointerdown", (event) => {
  document.querySelectorAll(".chart-options[open]").forEach((details) => {
    if (!details.contains(event.target)) details.open = false;
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".chart-options[open]").forEach((details) => {
    details.open = false;
    details.querySelector("summary").focus();
  });
});


const appShell = document.querySelector(".app-shell");
const appView = document.querySelector("#app-view");
const settingsButton = document.querySelector("#settings-button");
const settingsDialog = document.querySelector("#garmin-dialog");
const syncButton = document.querySelector("#sync-button");
let connection = { connected: false, mode: "setup" };
let connectionBusy = false;

const connectionActions = `
  <ol class="setup-steps">
    <li>Sign in to Garmin Connect and create a Personal API key.</li>
    <li>Paste the key into Ground Truth to sync the last 30 days.</li>
  </ol>
  <div class="setup-actions">
    <button class="button secondary" type="button" data-native-action="openGarmin">Create Garmin key ↗</button>
    <button class="button primary" type="button" data-native-action="connect">Enter key</button>
  </div>
`;

function emptySnapshot() {
  const coverage = state.data?.coverage;
  return coverage && coverage.dailyRecords + coverage.sleepRecords + coverage.hrvRecords + coverage.activities === 0;
}

function showMessage(message) {
  for (const id of ["connection-message", "garmin-dialog-message"]) {
    const status = document.getElementById(id);
    status.textContent = message || "";
    status.hidden = !message;
  }
}

function renderSettings() {
  const content = document.querySelector("#garmin-dialog-content");
  if (!connection.connected) {
    content.innerHTML = connectionActions;
    return;
  }
  const coverage = connection.data?.coverage;
  const summary = coverage
    ? `<div class="sync-coverage">
        <p>${dateLabel(coverage.earliestDate)} – ${dateLabel(coverage.latestDate)}</p>
        <p>${coverage.sleepRecords} sleep nights · ${coverage.hrvRecords} HRV days · ${coverage.activities} activities</p>
      </div>`
    : "";
  content.innerHTML = `
    ${summary}
    <div class="setup-actions">
      <button class="button secondary" type="button" data-native-action="openGarmin">Manage Garmin key ↗</button>
      <button class="button secondary" type="button" data-native-action="connect">Replace key</button>
      <button class="button secondary" type="button" data-native-action="disconnect">Disconnect</button>
    </div>`;
}

function renderConnection() {
  const mode = connection.mode;
  appShell.dataset.mode = mode;
  settingsButton.hidden = mode === "setup" && !connection.connected;
  settingsButton.textContent = mode === "demo" ? "Connect Garmin" : "Garmin";
  syncButton.hidden = !connection.connected;
  document.querySelector("#demo-badge").hidden = mode !== "demo";
  document.querySelector("#sidebar-sync").textContent = mode === "demo" ? "Synthetic data" :
    connection.connected ? (connection.syncedAt ? `Synced ${new Date(connection.syncedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Garmin connected") : "Local on this Mac";
  showMessage(connection.message);

  if (connection.data) loadData(structuredClone(connection.data), mode);
  else state.data = null;
  if (mode === "garmin" && emptySnapshot()) appShell.dataset.mode = "empty";

  if (mode === "setup" && !connection.connected) {
    document.querySelector("#view-title").textContent = "Connect Garmin";
    appView.innerHTML = `
      <section class="setup-card">
        ${connectionActions}
        <p class="setup-privacy">Your imported data stays on this Mac.</p>
        <div class="setup-demo"><button type="button" class="button secondary" data-native-action="demo">Try demo</button></div>
      </section>`;
  } else if (!state.data || emptySnapshot()) {
    document.querySelector("#view-title").textContent = "Overview";
    appView.innerHTML = `
      <section class="setup-card">
        <h2>No Garmin records yet</h2>
        <p>Sync your watch with Garmin Connect, then select Sync now.</p>
      </section>`;
  } else {
    renderView();
  }
  if (settingsDialog.open) renderSettings();
}

async function performConnectionAction(action) {
  if (connectionBusy) return;
  connectionBusy = true;
  document.querySelectorAll("[data-native-action]").forEach((button) => { button.disabled = true; });
  if (["connect", "sync"].includes(action)) showMessage("Connecting to Garmin…");
  try {
    const next = await window.webkit.messageHandlers.groundTruth.postMessage(action);
    if (action === "openGarmin") return;
    connection = next;
    if (settingsDialog.open && ["connect", "disconnect"].includes(action) && !connection.message) {
      settingsDialog.close();
    }
    if (settingsDialog.open && !connection.connected && connection.mode === "setup") settingsDialog.close();
    renderConnection();
  } catch (error) {
    showMessage(error?.message || "Ground Truth could not complete this action.");
  } finally {
    connectionBusy = false;
    document.querySelectorAll("[data-native-action]").forEach((button) => { button.disabled = false; });
  }
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-native-action]")?.dataset.nativeAction;
  if (action) void performConnectionAction(action);
});
settingsButton.addEventListener("click", () => {
  renderSettings();
  showMessage(connection.message);
  settingsDialog.showModal();
});
document.addEventListener("garmin-theme-change", () => {
  if (!state.data || emptySnapshot()) return;
  document.querySelector("#chart-tooltip").hidden = true;
  requestAnimationFrame(() => drawViewCharts({ keepCalendarPosition: true }));
});
window.addEventListener("resize", () => {
  if (!state.data || emptySnapshot()) return;
  clearTimeout(window.chartResizeTimer);
  window.chartResizeTimer = setTimeout(drawViewCharts, 120);
});

void performConnectionAction("state");
