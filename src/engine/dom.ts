import { daysBetween, MONTH_DAYS, monthOfDate, type ISODate } from "./dates";
import { weightedPercentile, type Comp, type MarketSettings, type ScoredComp } from "./market";
import { roundCents, type Cents } from "./money";
import { incomplete, ok, type MissingItem, type Result } from "./result";

/** How sure the days-on-market estimate is, from how many comps back it and how recent they are. */
export type DomConfidence = "high" | "medium" | "low";

/** Days to contract for a subject listed in a given month (spec §5.5), with the working behind it. */
export interface DomEstimate {
  lowDays: number;
  typicalDays: number;
  highDays: number;
  confidence: DomConfidence;
  /** Included sold comps that have days on market. */
  compCount: number;
  /** Those that sold within six months of today. */
  recentCount: number;
  factors: { seasonal: number; pricePosition: number; condition: number };
  /** Each factor applied, in order, for the "What drove it" panel. */
  explain: { label: string; effect: string }[];
}

/** Sold within this many months of today counts as recent; matches the recency tier in `market.ts`. */
const RECENT_MONTHS = 6;
/** Confidence tiers: comps needed, and for high also how many of them are recent. */
const HIGH_COMPS = 10;
const HIGH_RECENT = 5;
const MEDIUM_COMPS = 5;
/** A fitted seasonal curve needs this many sold comps spread over this many list months. */
const MIN_FIT_COMPS = 24;
const MIN_FIT_MONTHS = 9;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A sold comp's days to contract, with the list date they run from. */
function domOf(c: Comp, m: MarketSettings): { listDate: ISODate; days: number } | null {
  const { listDate, contractDate, soldDate } = c;
  if (listDate === undefined) return null;
  let days: number;
  if (contractDate !== undefined) {
    days = daysBetween(listDate, contractDate);
  } else if (soldDate !== undefined) {
    // Closing days come after the contract, so they are not part of days to contract.
    days = daysBetween(listDate, soldDate) - m.assumedClosingDays;
  } else {
    return null;
  }
  return days < 0 ? null : { listDate, days };
}

/**
 * Days from listing to contract (spec §5.5): contract − list when there is a contract date,
 * otherwise sold − list − `assumedClosingDays`. Null when a needed date is missing or the dates
 * are out of order. It does not look at `status`; callers keep to sold comps.
 */
export function compDomDays(c: Comp, m: MarketSettings): number | null {
  return domOf(c, m)?.days ?? null;
}

/** The seasonal factor for a calendar month (1-12). Throws when the month or the curve is unusable. */
function seasonalFactor(m: MarketSettings, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`List month must be a whole number from 1 to 12, got ${month}`);
  }
  const factor = m.seasonalFactors[month - 1];
  if (factor === undefined || !Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`Seasonal factors need 12 positive numbers; month ${month} has ${factor}`);
  }
  return factor;
}

/** "+6%", "−6%" (U+2212) or "no change" for a multiplier, to whole percent. */
function percentEffect(factor: number): string {
  const pct = roundCents((factor - 1) * 100);
  if (pct === 0) return "no change";
  return pct > 0 ? `+${pct}%` : `−${-pct}%`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function priceLabel(planned: Cents | undefined, mid: Cents): string {
  if (planned === undefined) return "Price position (no planned list price)";
  const pct = roundCents((planned / mid - 1) * 100);
  if (pct === 0) return "Price position (at mid)";
  return pct > 0 ? `Price position (${pct}% over mid)` : `Price position (${-pct}% under mid)`;
}

function confidenceOf(compCount: number, recentCount: number): DomConfidence {
  if (compCount >= HIGH_COMPS && recentCount >= HIGH_RECENT) return "high";
  if (compCount >= MEDIUM_COMPS) return "medium";
  return "low";
}

/**
 * Estimates days to contract from the included sold comps (spec §5.5). Each comp's days are
 * divided by the seasonal factor of its list month; the similarity-weighted 25th / 50th / 75th
 * percentiles are then multiplied by the subject's seasonal factor, a price-position factor
 * (planned list price above the mid slows the sale) and the market-condition factor, and rounded
 * to whole days. Incomplete when no included sold comp has days on market. Throws a `RangeError`
 * on a list month outside 1-12 or a seasonal curve that is not 12 positive numbers.
 */
export function estimateDom(
  scored: readonly ScoredComp[],
  m: MarketSettings,
  listMonth: number,
  priceMidCents: Cents,
  plannedListPriceCents: Cents | undefined,
  today: ISODate,
): Result<DomEstimate> {
  const seasonal = seasonalFactor(m, listMonth);

  const points: { value: number; weight: number }[] = [];
  let recentCount = 0;
  for (const { comp, score, included } of scored) {
    if (!included || comp.status !== "sold") continue;
    const dom = domOf(comp, m);
    if (dom === null) continue;
    points.push({ value: dom.days / seasonalFactor(m, monthOfDate(dom.listDate)), weight: score });
    if (comp.soldDate !== undefined && daysBetween(comp.soldDate, today) / MONTH_DAYS <= RECENT_MONTHS) {
      recentCount += 1;
    }
  }

  const missing: MissingItem[] = [];
  if (points.length === 0) {
    missing.push({
      code: "noDomComps",
      message: "Include at least one sold comp with a list date and a contract or sold date to estimate days on market",
      step: "market",
    });
  }
  if (plannedListPriceCents !== undefined && !(priceMidCents > 0)) {
    missing.push({
      code: "noPriceMid",
      message: "A sale price estimate is needed to compare the planned list price with the market",
      step: "market",
    });
  }
  if (missing.length > 0) return incomplete(missing);

  const overMid = plannedListPriceCents === undefined ? 0 : plannedListPriceCents / priceMidCents - 1;
  const pricePosition = 1 + m.elasticity * Math.max(0, overMid);
  const condition = m.conditionFactors[m.marketCondition];

  const afterSeason = seasonal;
  const afterPrice = afterSeason * pricePosition;
  const combined = afterPrice * condition;

  const median = weightedPercentile(points, 0.5);
  const daysAfter = (factor: number): string => plural(roundCents(median * factor), "day", "days");
  const compCount = points.length;

  return ok({
    lowDays: roundCents(weightedPercentile(points, 0.25) * combined),
    typicalDays: roundCents(median * combined),
    highDays: roundCents(weightedPercentile(points, 0.75) * combined),
    confidence: confidenceOf(compCount, recentCount),
    compCount,
    recentCount,
    factors: { seasonal, pricePosition, condition },
    explain: [
      {
        label: `Comps median (${plural(compCount, "comp", "comps")})`,
        effect: plural(roundCents(median), "day", "days"),
      },
      {
        label: `Season (${MONTH_NAMES[listMonth - 1]!}, ×${seasonal.toFixed(2)})`,
        effect: `${percentEffect(afterSeason)} → ${daysAfter(afterSeason)}`,
      },
      {
        label: priceLabel(plannedListPriceCents, priceMidCents),
        effect: `${percentEffect(pricePosition)} → ${daysAfter(afterPrice)}`,
      },
      {
        label: `Market condition (${m.marketCondition})`,
        effect: `${percentEffect(condition)} → ${daysAfter(combined)}`,
      },
    ],
  });
}

/** Median of a non-empty list; an even-sized list takes the mean of its two middle values. */
function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Fits a 12-month seasonal curve (January first) from sold comps (spec §5.5): each list month's
 * median days to contract over the overall median, a month with no comps at 1.0, then a circular
 * 3-month moving average rounded to 2 decimals. Only sold comps with days on market count, and
 * the fit needs at least 24 of them across 9 or more list months. Otherwise (or when the overall
 * median is zero, so there is nothing to compare against) it returns null. Callers pass one
 * region's comps.
 */
export function fitSeasonalFactors(comps: readonly Comp[], m: MarketSettings): number[] | null {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  const all: number[] = [];
  for (const c of comps) {
    if (c.status !== "sold") continue;
    const dom = domOf(c, m);
    if (dom === null) continue;
    all.push(dom.days);
    byMonth[monthOfDate(dom.listDate) - 1]!.push(dom.days);
  }
  const monthsWithData = byMonth.filter((xs) => xs.length > 0).length;
  if (all.length < MIN_FIT_COMPS || monthsWithData < MIN_FIT_MONTHS) return null;

  const overall = median(all);
  if (!(overall > 0)) return null;

  const raw = byMonth.map((xs) => (xs.length === 0 ? 1 : median(xs) / overall));
  // `roundCents` is plain half-away-from-zero rounding to an integer; scaling by 100 gives 2 decimals.
  const smoothed = raw.map((_, i) => roundCents(((raw[(i + 11) % 12]! + raw[i]! + raw[(i + 1) % 12]!) / 3) * 100) / 100);
  // A zero factor would divide by zero when comps are de-seasonalized.
  return smoothed.every((f) => f > 0) ? smoothed : null;
}
