import moment from "moment-timezone";

export const getLocalDate = (timeZone: string) => {
  return moment().tz(timeZone).format("YYYY-MM-DDTHH:mm:ss.SSSZ");
};
export const getLocalDateObject = (timeZone: string) => {
  return moment().tz(timeZone).toDate();
};
