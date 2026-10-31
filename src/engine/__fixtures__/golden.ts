import { buildProFormaInput, type ProFormaInput, type ScenarioInputs } from "../cashflow";
import type { DealInputs } from "../deal";
import { buildEstimate, type Estimate } from "../estimate";
import type { Comp } from "../market";
import type { Cents } from "../money";
import { computeQuantities, DEFAULT_QUANTITY_RULES } from "../quantities";
import { isOk } from "../result";
import goldenComps from "./golden-comps.json";
import goldenExpected from "./golden-deal.expected.json";
import goldenInputs from "./golden-deal.inputs.json";

/**
 * The golden deal: one fixed sample deal whose money math was worked out independently in
 * `docs/golden-deal.xlsx` (built by `scripts/golden/build_golden.py`, run with `npm run golden`).
 * `validateDeal` checks it in `golden.test.ts`; the JSON's literal types are wider than the schema's.
 */
export const GOLDEN_DEAL = goldenInputs as DealInputs;

/** One month of the golden schedule, in cents (spreadsheet dollars × 100, half away from zero). */
export interface GoldenPeriod {
  spendCents: Cents;
  equitySpendCents: Cents;
  loanDrawCents: Cents;
  drawFeeCents: Cents;
  pointsCents: Cents;
  interestCents: Cents;
  landLoanInterestCents: Cents;
  extensionFeeCents: Cents;
  taxCents: Cents;
  insuranceCents: Cents;
  utilitiesCents: Cents;
  stagingCents: Cents;
  upkeepCents: Cents;
  hoaCents: Cents;
  equityOutCents: Cents;
}

/** Expected results for one golden scenario, read from the recalculated spreadsheet. */
export interface GoldenScenario {
  inputs: { priceCents: Cents; domDays: number; overrunPct: number };
  /**
   * Months from land close, unrounded. LibreOffice stores them to 15 significant digits,
   * so compare with `toBeCloseTo`, not exact equality.
   */
  times: {
    buildStart: number;
    completion: number;
    list: number;
    contract: number;
    saleClose: number;
    maturity: number;
  };
  extensions: number;
  periods: GoldenPeriod[];
  sale: {
    commissionsCents: Cents;
    closingCents: Cents;
    netCents: Cents;
    loanPayoffCents: Cents;
    equityReturnCents: Cents;
  };
  metrics: {
    totalProjectCostCents: Cents;
    buildSpentCents: Cents;
    financingCents: Cents;
    carryCents: Cents;
    sellingCostsCents: Cents;
    profitCents: Cents;
    peakCashCents: Cents;
    breakEvenSalePriceCents: Cents;
    monthlyBurnWhileListedCents: Cents;
    maxDomWithoutExtension: number | null;
  };
  /** −equity out at t = k for every period, then +equity return at t = saleClose. */
  equityFlows: { t: number; cents: Cents }[];
}

export interface GoldenExpected {
  scenarios: { base: GoldenScenario; stress: GoldenScenario; financed: GoldenScenario };
}

/** Expected cash flow and metrics for the golden deal's `base`, `stress` and `financed` scenarios. */
export const GOLDEN_EXPECTED: GoldenExpected = goldenExpected;

/**
 * The golden deal as the `financed` scenario runs it: a 70% land loan at 10% with 1.5 points, construction
 * interest capitalized, and listing 2 months before completion. The spreadsheet applies the same overrides
 * (`FINANCED` in `scripts/golden/build_golden.py`); the scenario's price, days on market and overrun are its `inputs`.
 */
export const GOLDEN_FINANCED_DEAL: DealInputs = {
  ...GOLDEN_DEAL,
  lot: { ...GOLDEN_DEAL.lot, financing: { kind: "loan", ltv: 0.7, rate: 0.1, points: 0.015 } },
  timeline: { ...GOLDEN_DEAL.timeline, listEarlyMonths: 2 },
  loan: { ...GOLDEN_DEAL.loan, interestMode: "capitalized" },
};

/** The deal a golden scenario runs on: `financed` changes the deal's terms, `base` and `stress` only its scenario inputs. */
export function goldenDeal(scenario: keyof GoldenExpected["scenarios"]): DealInputs {
  return scenario === "financed" ? GOLDEN_FINANCED_DEAL : GOLDEN_DEAL;
}

/** The 8 sold comps from the market mockup. `market.test.ts` checks the JSON's enum fields against `Comp`. */
export const GOLDEN_COMPS = goldenComps as Comp[];

/** The golden deal's estimate, priced from its 25 bids alone (no price book or defaults). */
export function goldenEstimate(): Estimate {
  const quantities = computeQuantities(GOLDEN_DEAL.house, GOLDEN_DEAL.lot, DEFAULT_QUANTITY_RULES);
  if (!isOk(quantities)) throw new Error(`golden quantities incomplete: ${JSON.stringify(quantities.missing)}`);
  const context = { region: "utah-north", contingencyPct: 0.05, buildMonths: 9, today: "2026-10-30" };
  const book = { defaults: [], priceBook: [] };
  const estimate = buildEstimate(quantities.value, GOLDEN_DEAL.house, book, GOLDEN_DEAL.bids, context);
  if (!isOk(estimate)) throw new Error(`golden estimate incomplete: ${JSON.stringify(estimate.missing)}`);
  return estimate.value;
}

/** The cash-flow input for a golden scenario; `overrides` replaces any of its price, days on market, or overrun. */
export function goldenProFormaInput(
  scenario: keyof GoldenExpected["scenarios"],
  overrides: Partial<ScenarioInputs> = {},
): ProFormaInput {
  const inputs = { ...GOLDEN_EXPECTED.scenarios[scenario].inputs, ...overrides };
  return buildProFormaInput(goldenDeal(scenario), goldenEstimate(), inputs);
}
