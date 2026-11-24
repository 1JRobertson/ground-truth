const chartAxis = (() => {
  const monthFormat = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    timeZone: "UTC",
  });
  const monthDayFormat = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  function dateFromIso(value) {
    return new Date(`${value}T12:00:00Z`);
  }

  function abbreviatedYear(date) {
    return String(date.getUTCFullYear()).slice(-2);
  }

  function monthDayYear(date) {
    return `${monthDayFormat.format(date)} ’${abbreviatedYear(date)}`;
  }

  function monthYear(date) {
    return `${monthFormat.format(date)} ’${abbreviatedYear(date)}`;
  }

  function axisDateLabel(value, spanDays) {
    const date = dateFromIso(value);
    if (spanDays <= 180) return monthDayFormat.format(date);
    if (spanDays <= 730) return monthDayYear(date);
    return monthYear(date);
  }

  function valueTickIndices(values, tickCount) {
    if (!values.length || tickCount <= 0) return [];
    if (values.length <= tickCount) return values.map((_, index) => index);

    const start = values[0];
    const end = values.at(-1);
    const closestIndex = (target) => {
      let low = 0;
      let high = values.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (values[middle] < target) low = middle + 1;
        else high = middle;
      }
      if (low === 0) return 0;
      const previous = low - 1;
      return Math.abs(values[previous] - target) < Math.abs(values[low] - target)
        ? previous
        : low;
    };

    return [...new Set(
      Array.from({ length: tickCount }, (_, index) => {
        const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
        return closestIndex(start + (end - start) * ratio);
      }),
    )];
  }

  function trimToAvailableData(data, keys) {
    const hasValue = (item) => keys.some((key) => Number.isFinite(item[key]));
    const firstIndex = data.findIndex(hasValue);
    if (firstIndex === -1) return [];

    let lastIndex = data.length - 1;
    while (lastIndex > firstIndex && !hasValue(data[lastIndex])) lastIndex -= 1;
    return data.slice(firstIndex, lastIndex + 1);
  }

  function chartTickIndices(data, tickCount) {
    if (!data.length) return [];
    const timestamps = data.map((item) => dateFromIso(item.date).getTime());
    const start = timestamps[0];
    const end = timestamps.at(-1);
    const spanDays = Math.max(1, Math.round((end - start) / 86_400_000));

    if (spanDays <= 7 && data.length <= 8) {
      return data.map((_, index) => index);
    }
    return valueTickIndices(timestamps, tickCount);
  }

  return { axisDateLabel, valueTickIndices, trimToAvailableData, chartTickIndices };
})();
