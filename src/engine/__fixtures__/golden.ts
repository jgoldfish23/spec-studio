import { buildProFormaInput, type ProFormaInput, type ScenarioInputs } from "../cashflow";
import type { DealInputs } from "../deal";
import { buildEstimate, type Estimate } from "../estimate";
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
  scenarios: { base: GoldenScenario; stress: GoldenScenario };
}

/** Expected cash flow and metrics for the golden deal's `base` and `stress` scenarios. */
export const GOLDEN_EXPECTED: GoldenExpected = goldenExpected;

/** The 8 sold comps from the market mockup. Typed as `Comp[]` once the market model exists. */
export const GOLDEN_COMPS: unknown[] = goldenComps;

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
  return buildProFormaInput(GOLDEN_DEAL, goldenEstimate(), inputs);
}
