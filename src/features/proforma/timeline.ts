import type { CashFlowTimes, YearMonth } from "@engine";

/** The segments of the bar: pre-construction, the build, on the market, and the closing. */
export type SegmentKey = "permits" | "build" | "listed" | "closing";

export interface TimelineSegment {
  key: SegmentKey;
  /** Months after land close. */
  startMonth: number;
  endMonth: number;
  label: string;
}

export interface Timeline {
  segments: TimelineSegment[];
  /** The month the loan matures, or null when that falls after the sale closes and so is not on the bar. */
  maturityMonth: number | null;
  dates: { landClose: string; list: string; saleClose: string };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Shown where a month cannot be named, so a blank never reads as a date. */
const MISSING = "—";

/**
 * The month `months` after land close, as "Jun 2027": the land close month plus whole months, a fraction of a month
 * rounded down. "—" for a land close that is not a `YYYY-MM` month or a count that is not a number, so a half-typed
 * date cannot throw.
 */
export function monthLabel(landClose: YearMonth, months: number): string {
  const match = YEAR_MONTH.exec(landClose);
  if (match === null || !Number.isFinite(months)) return MISSING;
  // Months since year 0, so a year end is plain arithmetic: November plus three is February of the next year.
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + Math.floor(months);
  const year = Math.floor(index / 12);
  return `${MONTH_NAMES[index - year * 12]} ${year}`;
}

/** A whole number of months as "9", and anything else to one decimal. */
const monthsText = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export interface TimelineOptions {
  /** The scenario's days on market, for the "Listed N d" label; without it the label is just "Listed". */
  domDays?: number;
  /** False when the deal has no construction loan (the engine's commitment is 0), so there is no maturity to mark. */
  hasLoan?: boolean;
}

/**
 * Cuts one scenario's cash-flow times into the four stretches of the deal for the timeline bar, with the month the
 * loan matures and the names of the three months worth marking. Every month is the engine's own time, not rounded.
 * Only for a scenario that ran, so `landClose` is a real month. The engine gives a maturity month even for a deal with
 * no loan, so the caller says whether there is one.
 */
export function timelineSegments(
  times: CashFlowTimes,
  landClose: YearMonth,
  { domDays, hasLoan = true }: TimelineOptions = {},
): Timeline {
  const { buildStart, completion, list, contract, saleClose, maturity } = times;
  return {
    segments: [
      { key: "permits", startMonth: 0, endMonth: buildStart, label: `Permits ${monthsText(buildStart)} mo` },
      {
        key: "build",
        startMonth: buildStart,
        endMonth: completion,
        label: `Build ${monthsText(completion - buildStart)} mo · loan draws`,
      },
      { key: "listed", startMonth: list, endMonth: contract, label: domDays === undefined ? "Listed" : `Listed ${Math.round(domDays)} d` },
      { key: "closing", startMonth: contract, endMonth: saleClose, label: "Close" },
    ],
    // No loan has no maturity, and a loan that matures after the sale has closed is repaid before it: nothing to mark.
    maturityMonth: hasLoan && Number.isFinite(maturity) && maturity <= saleClose ? maturity : null,
    dates: {
      landClose: monthLabel(landClose, 0),
      list: monthLabel(landClose, list),
      saleClose: monthLabel(landClose, saleClose),
    },
  };
}

export interface BarPiece {
  key: SegmentKey;
  /** Where the piece starts and how wide it is, as a percent of the whole bar. */
  leftPct: number;
  widthPct: number;
}

/**
 * Where each segment sits on the bar, as percents. A segment stops where the next one starts, so a house listed before
 * the build is done (the build and the listing overlap) is drawn as the build up to the listing and then the listing,
 * never two pieces on top of each other. The bar runs to the end of the last segment; the loan marker is inside it,
 * since `timelineSegments` gives no maturity month after the sale closes.
 */
export function barLayout(
  segments: readonly TimelineSegment[],
  maturityMonth: number | null,
): { pieces: BarPiece[]; maturityPct: number | null } {
  const total = segments.at(-1)?.endMonth ?? 0;
  if (!(total > 0)) return { pieces: [], maturityPct: null };
  const pct = (months: number) => (months / total) * 100;
  const pieces = segments.map((segment, index): BarPiece => {
    const next = segments[index + 1];
    const end = next === undefined ? segment.endMonth : Math.min(segment.endMonth, next.startMonth);
    return { key: segment.key, leftPct: pct(segment.startMonth), widthPct: Math.max(0, pct(end - segment.startMonth)) };
  });
  return { pieces, maturityPct: maturityMonth === null ? null : pct(maturityMonth) };
}
