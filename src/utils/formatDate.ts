import { startOfWeek, endOfWeek, addDays } from "date-fns";
import moment from "moment-timezone";

export function formattedTodayDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formattedDateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formattedTodayDate(date);
}

export const toLocalISOString = (date: Date) => {
  const tzOffset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  const localISOTime = new Date(date.getTime() - tzOffset)
    .toISOString()
    .slice(0, -1);
  return localISOTime;
};

export function getLocalDate(date: Date) {
  const utcDate = new Date(date.toUTCString());
  const localDate = new Date(utcDate.getTime() - 4 * 60 * 60 * 1000);
  return localDate.toISOString().replace("Z", "+00:00");
}

export function getCurrentWeekRange() {
  const now = moment.tz();
  const start = now.clone().startOf("isoWeek").startOf("day");
  const end = start.clone().add(6, "days").endOf("day");

  return {
    start: start.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
    end: end.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
  };
}

export function getCurrentWeekRangeFromDate(date: string) {
  // Parse the provided date and get the moment object
  const now = moment.tz(date, "YYYY-MM-DD");

  // Start of the ISO week (Monday as the start of the week) and the start of the day
  const start = now.clone().startOf("isoWeek").startOf("day");

  // End of the ISO week (Sunday) and end of the day
  const end = start.clone().add(6, "days").endOf("day");

  return {
    start: start.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
    end: end.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
  };
}

export function getPreviousWeekRange() {
  const now = moment.tz();
  const start = now
    .clone()
    .subtract(1, "week")
    .startOf("isoWeek")
    .startOf("day");
  const end = start.clone().add(6, "days").endOf("day");

  return {
    start: start.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
    end: end.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
  };
}

// export function getWeekRange(timeframe: number) {
//   const now = moment.tz();
//   const start = now
//     .clone()
//     .subtract(timeframe - 1, "week")
//     .startOf("isoWeek")
//     .startOf("day");

//   const end = now.clone().endOf("isoWeek").endOf("day");

//   return {
//     start: start.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
//     end: end.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
//   };
// }

export function getWeekRange(timeframe: number) {
  const now = moment.tz();
  const start = now
    .clone()
    .subtract(timeframe, "week")
    .startOf("isoWeek")
    .startOf("day");

  const end = now.clone().subtract(1, "week").endOf("isoWeek").endOf("day");

  return {
    start: start.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
    end: end.format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]"),
  };
}

export function getCurrentWeekRangeSundSat() {
  const now = moment.tz();
  const start = now.clone().startOf("week").startOf("day");
  const end = start.clone().add(6, "days").endOf("day");

  return {
    start: start.format("MM/DD/YYYY"),
    end: end.format("MM/DD/YYYY"),
  };
}
