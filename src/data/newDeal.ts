import { DEFAULT_MARKET_SETTINGS, DEFAULT_SCENARIO_DEFS } from "@engine";
import type { DealInputs, ISODate, YearMonth } from "@engine";
import type { CompanySettings } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar month after `today`. Throws a `RangeError` when `today` is not a real `YYYY-MM-DD` date. */
function monthAfter(today: ISODate): YearMonth {
  const match = ISO_DATE.exec(today);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const isRealDate =
    match !== null && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate) throw new RangeError(`Invalid ISO date: "${today}"`);
  const next = year * 12 + month; // zero-based month index, plus one month
  return `${String(Math.floor(next / 12)).padStart(4, "0")}-${String((next % 12) + 1).padStart(2, "0")}`;
}

/**
 * The inputs for a deal the owner is just starting: a 2,000 sf upgraded rambler on a quarter acre in Davis County,
 * bought for cash, with loan, carry and selling terms taken from the golden deal. The city is left empty on
 * purpose, so the deal reads "Needs info: city" until it is filled in. Every call returns a fresh object.
 */
export function newDealInputs(today: ISODate, settings: CompanySettings): DealInputs {
  return {
    lot: {
      city: "",
      county: "Davis",
      region: "utah-north",
      acres: 0.25,
      priceCents: 0,
      closingCents: 0,
      financing: { kind: "cash" },
      utilities: { water: "unknown", sewer: "unknown", gas: "unknown", power: "unknown", secondaryWater: "unknown" },
      hoaMonthlyCents: 0,
      propertyTaxRate: DEFAULT_MARKET_SETTINGS.defaultTaxRate,
    },
    house: {
      schemaVersion: 1,
      source: "described",
      style: "rambler",
      levels: {
        main: { finishedSf: 2000, unfinishedSf: 0, ceilingFt: 9 },
        basement: { totalSf: 2000, finishedSf: 0, walkout: false },
      },
      footprint: { widthFt: 50, depthFt: 40, complexity: "moderate" },
      garage: { bays: 3, tandem: false, rvBay: false },
      roof: { style: "hip", pitchPer12: 6 },
      rooms: { bedrooms: 4, fullBaths: 2, halfBaths: 1, fireplaces: 0 },
      exterior: { stonePct: 20, stuccoPct: 60, boardBattenPct: 20, fiberCementPct: 0 },
      finishes: { houseTier: "upgraded", overrides: {} },
      adu: { type: "none" },
      pool: { type: "none", spa: false, heated: false },
      outside: { coveredPatioSf: 300, flatworkSf: 1200, fenceLf: 200, landscapingTier: "standard" },
    },
    timeline: { landClose: monthAfter(today), preConMonths: 2, buildMonths: 9, listEarlyMonths: 0, closingDays: 35 },
    loan: {
      ltc: 0.8,
      rate: 0.09,
      points: 0.01,
      drawFeeCents: 20_000,
      termMonths: 12,
      extensionPct: 0.005,
      extensionMonths: 3,
      interestMode: "paid",
    },
    carry: {
      insuranceRate: 0.0035,
      utilitiesBuildMonthlyCents: 15_000,
      utilitiesAfterMonthlyCents: 25_000,
      stagingMonthlyCents: 50_000,
      upkeepMonthlyCents: 10_000,
    },
    selling: { listingPct: 0.025, buyerPct: 0.025, closingPct: 0.01, concessionsCents: 1_500_000 },
    rules: { ...settings.rules },
    scenarioDefs: structuredClone(DEFAULT_SCENARIO_DEFS),
    contingencyPct: settings.contingencyPct,
    overrides: {},
    bids: [],
    compSelections: {},
  };
}
