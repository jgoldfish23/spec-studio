/** Calendar date, `YYYY-MM-DD`. "Today" is always passed in, never read from a clock. */
export type ISODate = string;
/** Calendar month, `YYYY-MM`. */
export type YearMonth = string;

/** Days per month used for all month-fraction math. */
export const MONTH_DAYS = 365 / 12;

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

function parseYearMonth(ym: YearMonth): { year: number; month: number } {
  const match = YEAR_MONTH.exec(ym);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) throw new RangeError(`Invalid year-month: "${ym}"`);
  return { year, month };
}

function parseDate(d: ISODate): { year: number; month: number; day: number; utcMs: number } {
  const match = ISO_DATE.exec(d);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    match !== null &&
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day;
  if (!isRealDate) throw new RangeError(`Invalid ISO date: "${d}"`);
  return { year, month, day, utcMs: utc.getTime() };
}

/** Whole days from `a` to `b` (`b - a`), computed in UTC so daylight saving never skews it. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return (parseDate(b).utcMs - parseDate(a).utcMs) / MS_PER_DAY;
}

/** Adds `n` calendar months (negative `n` subtracts) to a year-month. */
export function addMonths(ym: YearMonth, n: number): YearMonth {
  const { year, month } = parseYearMonth(ym);
  const index = year * 12 + (month - 1) + n;
  const newYear = Math.floor(index / 12);
  const newMonth = index - newYear * 12 + 1;
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}`;
}

/** Calendar month number (1-12) of a year-month. */
export function calendarMonth(ym: YearMonth): number {
  return parseYearMonth(ym).month;
}

/** Calendar month number (1-12) of an ISO date. */
export function monthOfDate(d: ISODate): number {
  return parseDate(d).month;
}

/** Calendar year of an ISO date. */
export function yearOfDate(d: ISODate): number {
  return parseDate(d).year;
}
