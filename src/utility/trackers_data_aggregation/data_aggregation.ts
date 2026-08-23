import { BloodPressureTracker, GlucoseTracker, Reading } from "../../types";

interface AnalysisReport {
  glucose_sd: number;
  pctDaysAboveTarget: number;
  pctDaysBelowTarget: number;
  highestReadings: Reading[];
  lowestReadings: Reading[];
}

export function analyzeGlucoseTracker(
  tracker: GlucoseTracker,
  thresholds: { highThreshold?: number; lowThreshold?: number } = {}
): AnalysisReport {
  const { highThreshold = 140, lowThreshold = 70 } = thresholds;

  // 1. Collect all readings
  const allReadings: Reading[] = [];
  for (const week of tracker.weeklyEntries || []) {
    for (const day of week.dailyEntries || []) {
      for (const entry of day.glucoseEntries || []) {
        allReadings.push({ date: day.date, value: entry.value });
      }
    }
  }

  if (allReadings.length === 0) {
    return {
      glucose_sd: 0,
      pctDaysAboveTarget: 0,
      pctDaysBelowTarget: 0,
      highestReadings: [],
      lowestReadings: [],
    };
  }

  // 2. Compute standard deviation
  const values = allReadings.map((r) => r.value);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const glucose_sd = Math.sqrt(variance);

  // 3. Group by date to flag days
  const readingsByDate: Record<string, number[]> = {};
  allReadings.forEach(({ date, value }) => {
    if (!readingsByDate[date]) readingsByDate[date] = [];
    readingsByDate[date].push(value);
  });

  const totalDays = Object.keys(readingsByDate).length;
  let daysAbove = 0;
  let daysBelow = 0;

  Object.values(readingsByDate).forEach((readings) => {
    if (Math.max(...readings) > highThreshold) daysAbove++;
    if (Math.min(...readings) < lowThreshold) daysBelow++;
  });

  const pctDaysAboveTarget = (daysAbove / totalDays) * 100;
  const pctDaysBelowTarget = (daysBelow / totalDays) * 100;

  // 4. Determine top-3 highest & lowest readings
  const sorted = [...allReadings].sort((a, b) => a.value - b.value);
  const lowestReadings = sorted.slice(0, 3);
  const highestReadings = sorted.slice(-3).reverse();

  // 5. Round to sensible precision
  return {
    glucose_sd: Number(glucose_sd.toFixed(2)),
    pctDaysAboveTarget: Number(pctDaysAboveTarget.toFixed(1)),
    pctDaysBelowTarget: Number(pctDaysBelowTarget.toFixed(1)),
    highestReadings,
    lowestReadings,
  };
}

interface BPAnalysisReport {
  systolic_sd: number;
  diastolic_sd: number;
  pctDaysSysAbove: number;
  pctDaysSysBelow: number;
  pctDaysDiaAbove: number;
  pctDaysDiaBelow: number;
  highestSystolic: Reading[];
  lowestSystolic: Reading[];
  highestDiastolic: Reading[];
  lowestDiastolic: Reading[];
}
export function analyzeBloodPressureTracker(
  tracker: BloodPressureTracker,
  thresholds: {
    sysHigh?: number;
    sysLow?: number;
    diaHigh?: number;
    diaLow?: number;
  } = {}
): BPAnalysisReport {
  const { sysHigh = 120, sysLow = 90, diaHigh = 80, diaLow = 60 } = thresholds;

  // 1. Flatten all readings into separate arrays
  const sysReadings: Reading[] = [];
  const diaReadings: Reading[] = [];

  for (const week of tracker.weeklyEntries || []) {
    for (const day of week.dailyEntries || []) {
      for (const bp of day.bpEntries || []) {
        sysReadings.push({ date: day.date, value: bp.systolic });
        diaReadings.push({ date: day.date, value: bp.diastolic });
      }
    }
  }

  const computeSD = (arr: number[]): number => {
    const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const variance =
      arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  };

  // 2. Compute standard deviations
  const systolic_sd =
    sysReadings.length > 0 ? computeSD(sysReadings.map((r) => r.value)) : 0;
  const diastolic_sd =
    diaReadings.length > 0 ? computeSD(diaReadings.map((r) => r.value)) : 0;

  // 3. Group by date to flag days
  const groupByDate = (readings: Reading[]) =>
    readings.reduce<Record<string, number[]>>((map, { date, value }) => {
      if (!map[date]) map[date] = [];
      map[date].push(value);
      return map;
    }, {});

  const sysByDate = groupByDate(sysReadings);
  const diaByDate = groupByDate(diaReadings);

  const totalDays = new Set([
    ...Object.keys(sysByDate),
    ...Object.keys(diaByDate),
  ]).size;

  let daysSysAbove = 0,
    daysSysBelow = 0,
    daysDiaAbove = 0,
    daysDiaBelow = 0;

  for (const [date, vals] of Object.entries(sysByDate)) {
    if (Math.max(...vals) > sysHigh) daysSysAbove++;
    if (Math.min(...vals) < sysLow) daysSysBelow++;
  }

  for (const [date, vals] of Object.entries(diaByDate)) {
    if (Math.max(...vals) > diaHigh) daysDiaAbove++;
    if (Math.min(...vals) < diaLow) daysDiaBelow++;
  }

  const pctDaysSysAbove = totalDays > 0 ? (daysSysAbove / totalDays) * 100 : 0;
  const pctDaysSysBelow = totalDays > 0 ? (daysSysBelow / totalDays) * 100 : 0;
  const pctDaysDiaAbove = totalDays > 0 ? (daysDiaAbove / totalDays) * 100 : 0;
  const pctDaysDiaBelow = totalDays > 0 ? (daysDiaBelow / totalDays) * 100 : 0;

  // 4. Top/bottom 3 readings
  const topN = (arr: Reading[], n = 3) =>
    [...arr].sort((a, b) => b.value - a.value).slice(0, n);
  const bottomN = (arr: Reading[], n = 3) =>
    [...arr].sort((a, b) => a.value - b.value).slice(0, n);

  const highestSystolic = topN(sysReadings);
  const lowestSystolic = bottomN(sysReadings);
  const highestDiastolic = topN(diaReadings);
  const lowestDiastolic = bottomN(diaReadings);

  // 5. Round and return
  return {
    systolic_sd: Number(systolic_sd.toFixed(2)),
    diastolic_sd: Number(diastolic_sd.toFixed(2)),
    pctDaysSysAbove: Number(pctDaysSysAbove.toFixed(1)),
    pctDaysSysBelow: Number(pctDaysSysBelow.toFixed(1)),
    pctDaysDiaAbove: Number(pctDaysDiaAbove.toFixed(1)),
    pctDaysDiaBelow: Number(pctDaysDiaBelow.toFixed(1)),
    highestSystolic,
    lowestSystolic,
    highestDiastolic,
    lowestDiastolic,
  };
}
