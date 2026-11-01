import { listYearMonth } from "@engine";
import type { Cents, Comp, MissingItem, Timeline } from "@engine";
import { needText } from "../deal/needText";

/** Shown wherever a figure is missing, so a blank never reads as zero. */
export const MISSING = "—";

/** The top of the days-on-market bar, in days. */
export const BAR_DAYS = 180;

// Months are named in UTC, so a date never slips to the day before in a time zone west of Greenwich.
const SHORT_MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const LONG_MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const DATE = /^(\d{4})-(\d{2})-\d{2}$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

/** The first of a month as a UTC date, or null for a month that is not 1 to 12. */
function firstOf(year: number, month: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const date = new Date(0);
  // `setUTCFullYear` takes the year as written; `Date.UTC` reads 0 to 99 as 1900 to 1999.
  date.setUTCFullYear(year, month - 1, 1);
  return date;
}

/** "Mar 2026" for a `YYYY-MM-DD` date; "—" when there is none or it is not a date. */
export function monthYear(date: string | undefined): string {
  const match = date === undefined ? null : DATE.exec(date);
  const first = match === null ? null : firstOf(Number(match[1]), Number(match[2]));
  return first === null ? MISSING : SHORT_MONTH_YEAR.format(first);
}

/** "Mar 2026 → May 2026": the months a comp was listed and sold, a dash for a side that is not known. */
export function listedToSold(comp: Pick<Comp, "listDate" | "soldDate">): string {
  return `${monthYear(comp.listDate)} → ${monthYear(comp.soldDate)}`;
}

/** "May 2028" for a `YYYY-MM` month; null when it is not one. */
export function longMonthYear(yearMonth: string): string | null {
  const match = YEAR_MONTH.exec(yearMonth);
  const first = match === null ? null : firstOf(Number(match[1]), Number(match[2]));
  return first === null ? null : LONG_MONTH_YEAR.format(first);
}

/**
 * The month a house lists in, as "May 2028", from the timeline an evaluation was run on. Null when the timeline
 * cannot give one, in which case the screen leaves the month out rather than guess.
 */
export function listingMonthOf(timeline: Timeline): string | null {
  try {
    return longMonthYear(listYearMonth(timeline));
  } catch {
    return null;
  }
}

/** A comp's finished area: above grade plus finished basement. Null unless both are numbers. */
export function finishedSf(comp: Pick<Comp, "aboveGradeFinishedSf" | "basementFinishedSf">): number | null {
  const total = comp.aboveGradeFinishedSf + comp.basementFinishedSf;
  return Number.isFinite(total) ? total : null;
}

/** What a comp sold for per finished sf, in cents. Null when it has no sold price or no finished area. */
export function pricePerFinishedSf(
  comp: Pick<Comp, "aboveGradeFinishedSf" | "basementFinishedSf" | "soldPriceCents">,
): Cents | null {
  const area = finishedSf(comp);
  if (comp.soldPriceCents === undefined || area === null || area <= 0) return null;
  const perSf = comp.soldPriceCents / area;
  return Number.isFinite(perSf) ? perSf : null;
}

/** Where `days` sits on the bar, 0 to 100, with days outside the bar held at its ends. */
export function barPercent(days: number): number {
  if (!Number.isFinite(days)) return 0;
  return (Math.min(Math.max(days, 0), BAR_DAYS) / BAR_DAYS) * 100;
}

// ---------------------------------------------------------------------------------------------------------------
// What the estimates say while they cannot be worked out

export const NEEDS_PRICE_COMPS =
  "Needs sold comps — add at least one below, or enter your own base sale price above.";
export const NEEDS_DOM_COMPS =
  "Needs sold comps — add at least one below, or enter your own base days on market above.";

/**
 * Why an estimate is incomplete, in words for the card: the "needs sold comps" message when that is what is
 * missing (`code` is the engine's code for it), otherwise the engine's own first reason, since a deal that is
 * invalid or has no finished area is not helped by being told to add comps.
 */
export function whyIncomplete(missing: readonly MissingItem[], code: string, needsComps: string): string {
  if (missing.some((item) => item.code === code)) return needsComps;
  const [first] = missing;
  return first === undefined ? "Not available yet." : needText(first);
}
