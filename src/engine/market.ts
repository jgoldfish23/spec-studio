import { daysBetween, MONTH_DAYS, yearOfDate, type ISODate } from "./dates";
import type { Lot } from "./deal";
import type { HouseModel } from "./house";
import { roundCents, type Cents } from "./money";
import { incomplete, ok, type Result } from "./result";

/** Where a comp stands: closed, on the market, or under contract (spec §5.5). */
export type CompStatus = "sold" | "active" | "pending";
/** How much of a basement is finished. `none` means the house has no basement. */
export type BasementFinish = "none" | "unfinished" | "partial" | "finished";
/** How a comp entered the app. */
export type CompSource = "manual" | "csv" | "claudeFile" | "ownSale";
/** The owner's read of the market, which scales days on market (Task 11). */
export type MarketCondition = "hot" | "normal" | "slow";

/** One comparable sale or listing (spec §5.5). Money is cents; dates are `YYYY-MM-DD`. */
export interface Comp {
  id: string;
  address: string;
  city: string;
  county: string;
  region: string;
  status: CompStatus;
  listDate?: ISODate;
  listPriceCents?: Cents;
  originalListPriceCents?: Cents;
  priceCuts?: number;
  /** Date the comp went under contract; days on market to contract uses it when present. */
  contractDate?: ISODate;
  soldDate?: ISODate;
  soldPriceCents?: Cents;
  aboveGradeFinishedSf: number;
  basementFinishedSf: number;
  unfinishedSf: number;
  beds: number;
  baths: number;
  yearBuilt: number;
  newConstruction: boolean;
  lotAcres: number;
  garageBays: number;
  basementFinish: BasementFinish;
  walkout: boolean;
  adu: boolean;
  pool: boolean;
  source: CompSource;
  verified: boolean;
  notes?: string;
}

/** The house being priced, reduced to the facts a comp is compared on. */
export interface Subject {
  city: string;
  county: string;
  region: string;
  aboveGradeFinishedSf: number;
  basementFinishedSf: number;
  garageBays: number;
  basementFinish: BasementFinish;
  walkout: boolean;
  adu: boolean;
  pool: boolean;
  lotAcres: number;
}

/** Editable market assumptions (spec §5.5). Dollar values are cents; rates are decimals. */
export interface MarketSettings {
  region: string;
  /** Share of finished basement sf that counts toward effective sf. */
  basementFactor: number;
  /** Price adjustment per unit of difference between subject and comp. */
  featureValues: {
    garageBayCents: Cents;
    walkoutCents: Cents;
    lotPerAcreCents: Cents;
    aduCents: Cents;
    poolCents: Cents;
  };
  /** Points each similarity factor is worth; the defaults add up to 100. */
  similarityWeights: { location: number; size: number; age: number; recency: number; features: number };
  /** Comps scoring at least this are included by default. */
  includeThreshold: number;
  /** Days-on-market multiplier for each list month, January first. */
  seasonalFactors: number[];
  /** Extra days-on-market per unit the planned list price sits above the market mid. */
  elasticity: number;
  marketCondition: MarketCondition;
  conditionFactors: { hot: number; normal: number; slow: number };
  /** Days from contract to closing when a sold comp has no contract date. */
  assumedClosingDays: number;
  /** Annual property tax rate when the region has no better figure. */
  defaultTaxRate: number;
}

export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  region: "utah-north",
  basementFactor: 0.6,
  featureValues: {
    garageBayCents: 1_200_000,
    walkoutCents: 900_000,
    lotPerAcreCents: 6_000_000,
    aduCents: 3_500_000,
    poolCents: 2_500_000,
  },
  similarityWeights: { location: 25, size: 25, age: 15, recency: 20, features: 15 },
  includeThreshold: 75,
  seasonalFactors: [1.2, 1.1, 0.95, 0.9, 0.9, 0.95, 1.0, 1.0, 1.05, 1.1, 1.15, 1.2],
  elasticity: 3.0,
  marketCondition: "normal",
  conditionFactors: { hot: 0.85, normal: 1.0, slow: 1.2 },
  assumedClosingDays: 35,
  defaultTaxRate: 0.0048,
};

/** Reduces a house and its lot to the subject that comps are scored against. */
export function subjectFromDeal(h: HouseModel, lot: Lot): Subject {
  const { main, upper, basement } = h.levels;
  return {
    city: lot.city,
    county: lot.county,
    region: lot.region,
    aboveGradeFinishedSf: main.finishedSf + (upper?.finishedSf ?? 0),
    basementFinishedSf: basement?.finishedSf ?? 0,
    garageBays: h.garage.bays,
    basementFinish: basementFinishOf(basement),
    walkout: basement?.walkout ?? false,
    adu: h.adu.type !== "none",
    pool: h.pool.type !== "none",
    lotAcres: lot.acres,
  };
}

function basementFinishOf(basement: HouseModel["levels"]["basement"]): BasementFinish {
  if (basement === undefined) return "none";
  if (basement.finishedSf === basement.totalSf) return "finished";
  if (basement.finishedSf === 0) return "unfinished";
  return "partial";
}

/** Finished area as a buyer prices it: above-grade plus finished basement at a discount. */
export function effectiveSf(aboveGrade: number, basementFin: number, basementFactor: number): number {
  return aboveGrade + basementFin * basementFactor;
}

/** Location score by closest shared place (spec §5.5). */
const SAME_CITY = 1.0;
const SAME_COUNTY = 0.7;
const SAME_REGION = 0.4;
/** Size score reaches zero when effective sf differs by this share of the subject's. */
const SIZE_TOLERANCE = 0.3;
/** A comp sold within this many years of being built counts as new-ish. */
const NEW_YEARS = 3;
const NEW_SCORE = 1.0;
const OLDER_SCORE = 0.5;
/** Recency tiers: months since sale, and the score up to that age. */
const RECENT_MONTHS = 6;
const RECENT_SCORE = 1.0;
const WITHIN_YEAR_MONTHS = 12;
const WITHIN_YEAR_SCORE = 0.7;
const STALE_SCORE = 0.4;
/** The features compared: garage bays, basement finish, walkout, ADU, pool. */
const FEATURE_COUNT = 5;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function locationFactor(s: Subject, c: Comp): number {
  if (same(s.city, c.city)) return SAME_CITY;
  if (same(s.county, c.county)) return SAME_COUNTY;
  if (same(s.region, c.region)) return SAME_REGION;
  return 0;
}

function sizeFactor(s: Subject, c: Comp, basementFactor: number): number {
  const subjectSf = effectiveSf(s.aboveGradeFinishedSf, s.basementFinishedSf, basementFactor);
  const compSf = effectiveSf(c.aboveGradeFinishedSf, c.basementFinishedSf, basementFactor);
  const gap = Math.abs(compSf - subjectSf);
  const tolerance = SIZE_TOLERANCE * subjectSf;
  // A subject with no finished area has no tolerance band: only an equally empty comp matches.
  if (tolerance <= 0) return gap === 0 ? 1 : 0;
  return Math.max(0, 1 - gap / tolerance);
}

function ageFactor(c: Comp, today: ISODate): number {
  const saleYear = yearOfDate(c.soldDate ?? today);
  return saleYear - c.yearBuilt <= NEW_YEARS ? NEW_SCORE : OLDER_SCORE;
}

function recencyFactor(c: Comp, today: ISODate): number {
  const monthsAgo = daysBetween(c.soldDate ?? today, today) / MONTH_DAYS;
  if (monthsAgo <= RECENT_MONTHS) return RECENT_SCORE;
  if (monthsAgo <= WITHIN_YEAR_MONTHS) return WITHIN_YEAR_SCORE;
  return STALE_SCORE;
}

function featuresFactor(s: Subject, c: Comp): number {
  const matches = [
    s.garageBays === c.garageBays,
    s.basementFinish === c.basementFinish,
    s.walkout === c.walkout,
    s.adu === c.adu,
    s.pool === c.pool,
  ].filter(Boolean).length;
  return matches / FEATURE_COUNT;
}

/**
 * How alike a comp and the subject are, 0 to 100 and unrounded (spec §5.5). Each factor scores
 * 0 to 1 and is worth its weight in points. A comp with no sold date is scored as if it sold today.
 */
export function similarity(s: Subject, c: Comp, m: MarketSettings, today: ISODate): number {
  const w = m.similarityWeights;
  return (
    w.location * locationFactor(s, c) +
    w.size * sizeFactor(s, c, m.basementFactor) +
    w.age * ageFactor(c, today) +
    w.recency * recencyFactor(c, today) +
    w.features * featuresFactor(s, c)
  );
}

/** A comp with its similarity score and whether it feeds the estimates. */
export interface ScoredComp {
  comp: Comp;
  score: number;
  included: boolean;
}

/**
 * Scores every comp and sorts them best first (ties keep input order). A comp is included when
 * the owner's selection for its id says so, otherwise when it scores at or above the threshold.
 */
export function scoreComps(
  s: Subject,
  comps: readonly Comp[],
  m: MarketSettings,
  selections: Record<string, boolean>,
  today: ISODate,
): ScoredComp[] {
  return comps
    .map((comp) => {
      const score = similarity(s, comp, m, today);
      // `hasOwn` keeps an id such as "constructor" from reading an inherited property.
      const chosen = Object.hasOwn(selections, comp.id) ? selections[comp.id] : undefined;
      return { comp, score, included: chosen ?? score >= m.includeThreshold };
    })
    .sort((a, b) => b.score - a.score);
}

/** Absorbs float error in running weight totals so a percentile landing exactly on a value picks it. */
const PERCENTILE_TOLERANCE = 1e-12;

/**
 * Weighted percentile (spec §5.5): sort by value, add up weights, and take the first value whose
 * cumulative weight reaches `p` of the total. `p` runs 0 to 1. Throws on an empty list.
 */
export function weightedPercentile(xs: readonly { value: number; weight: number }[], p: number): number {
  if (xs.length === 0) throw new RangeError("weightedPercentile needs at least one value");
  if (!(p >= 0 && p <= 1)) throw new RangeError(`Percentile must be between 0 and 1, got ${p}`);
  const sorted = [...xs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, x) => sum + x.weight, 0);
  const target = (p - PERCENTILE_TOLERANCE) * total;
  let cumulative = 0;
  for (const x of sorted) {
    cumulative += x.weight;
    if (cumulative >= target) return x.value;
  }
  // Unreachable with finite weights, since the final cumulative weight is the total.
  return sorted[sorted.length - 1]!.value;
}

/** Sale-price estimate with the per-comp working that produced it. */
export interface PriceEstimate {
  lowCents: Cents;
  midCents: Cents;
  highCents: Cents;
  midPerEffectiveSfCents: Cents;
  comps: { id: string; adjustedCents: Cents; impliedCents: Cents; weight: number }[];
}

const flag = (b: boolean): number => (b ? 1 : 0);

/** A comp's sold price moved toward the subject: Σ (subject feature − comp feature) × feature value. */
function adjustedPriceCents(soldPriceCents: Cents, s: Subject, c: Comp, v: MarketSettings["featureValues"]): Cents {
  const garage = (s.garageBays - c.garageBays) * v.garageBayCents;
  const walkout = (flag(s.walkout) - flag(c.walkout)) * v.walkoutCents;
  const adu = (flag(s.adu) - flag(c.adu)) * v.aduCents;
  const pool = (flag(s.pool) - flag(c.pool)) * v.poolCents;
  const lot = roundCents((s.lotAcres - c.lotAcres) * v.lotPerAcreCents);
  return soldPriceCents + garage + walkout + adu + pool + lot;
}

/**
 * Estimates the subject's sale price from the included sold comps (spec §5.5): adjust each toward
 * the subject, scale by effective sf, then take the similarity-weighted 25th, 50th and 75th
 * percentile. Comps with no effective sf are skipped. Incomplete when no comp is usable.
 */
export function estimatePrice(s: Subject, scored: readonly ScoredComp[], m: MarketSettings): Result<PriceEstimate> {
  const subjectSf = effectiveSf(s.aboveGradeFinishedSf, s.basementFinishedSf, m.basementFactor);
  if (subjectSf <= 0) {
    return incomplete([
      {
        code: "missingFinishedArea",
        message: "The house needs finished area above zero to compare it with sold comps",
        step: "house",
      },
    ]);
  }

  const comps: PriceEstimate["comps"] = [];
  for (const { comp: c, score, included } of scored) {
    if (!included || c.status !== "sold" || c.soldPriceCents === undefined) continue;
    const compSf = effectiveSf(c.aboveGradeFinishedSf, c.basementFinishedSf, m.basementFactor);
    if (compSf <= 0) continue;
    const adjustedCents = adjustedPriceCents(c.soldPriceCents, s, c, m.featureValues);
    comps.push({
      id: c.id,
      adjustedCents,
      impliedCents: roundCents((adjustedCents / compSf) * subjectSf),
      weight: score,
    });
  }

  if (comps.length === 0) {
    return incomplete([
      {
        code: "noComps",
        message: "Include at least one sold comp to estimate the sale price",
        step: "market",
      },
    ]);
  }

  const points = comps.map((c) => ({ value: c.impliedCents, weight: c.weight }));
  const midCents = weightedPercentile(points, 0.5);
  return ok({
    lowCents: weightedPercentile(points, 0.25),
    midCents,
    highCents: weightedPercentile(points, 0.75),
    midPerEffectiveSfCents: roundCents(midCents / subjectSf),
    comps,
  });
}
