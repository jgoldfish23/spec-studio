import { buildProFormaInput, runCashFlow, type CashFlow, type ScenarioInputs } from "./cashflow";
import type { DealInputs, ScenarioDefs } from "./deal";
import type { DomEstimate } from "./dom";
import type { Estimate } from "./estimate";
import type { PriceEstimate } from "./market";
import { computeMetrics, type Metrics } from "./metrics";
import { roundCents, type Cents } from "./money";
import { incomplete, ok, type MissingItem, type Result, type Warning } from "./result";

export type ScenarioName = "downside" | "base" | "upside";

/** The order scenarios are resolved and reported in. */
const SCENARIO_NAMES: readonly ScenarioName[] = ["downside", "base", "upside"];

/**
 * Re-centres a market value on an override: the override times the value's ratio to the market
 * anchor (its mid or typical), so the anchor itself maps to the override. Rounded half away from
 * zero, to the cent for prices and to the whole day for days on market.
 */
const scaleAround = (override: number, value: number, anchor: number): number =>
  roundCents((override * value) / anchor);

/** Where one dimension (price or days on market) of every scenario comes from. */
type Dimension = {
  /** The market's value for each source a scenario can name, or null when there is no usable range. */
  market: Record<"low" | "mid" | "high", number> | null;
  /** The market value an override is anchored to (mid price, typical days). */
  anchor: number;
  override: number | undefined;
};

type DimensionOutcome = { values: Record<"low" | "mid" | "high", number>; fellBack: boolean } | { missing: true };

/**
 * Values of one dimension for the low, mid and high source. An override re-centres a usable market
 * range on itself; with no usable range it replaces the whole range (`fellBack`); with neither the
 * dimension is missing.
 */
function resolveDimension({ market, anchor, override }: Dimension): DimensionOutcome {
  if (override === undefined) {
    return market === null ? { missing: true } : { values: market, fellBack: false };
  }
  if (market === null || !(anchor > 0)) {
    return { values: { low: override, mid: override, high: override }, fellBack: true };
  }
  return {
    values: {
      low: scaleAround(override, market.low, anchor),
      mid: scaleAround(override, market.mid, anchor),
      high: scaleAround(override, market.high, anchor),
    },
    fellBack: false,
  };
}

/**
 * Turns the scenario definitions into concrete price, days on market and overrun for each scenario
 * (spec §5.7). A base override re-centres the market range on itself, keeping the market's
 * proportions: price × low/mid and × high/mid, days × low/typical and × high/typical. With an
 * override but no market range, all three scenarios take the override and a `noMarketRange` warning
 * says so. A dimension with neither a market range nor an override makes the result incomplete.
 */
export function resolveScenarios(
  defs: ScenarioDefs,
  price: PriceEstimate | null,
  dom: DomEstimate | null,
  overrides: DealInputs["overrides"],
): Result<Record<ScenarioName, ScenarioInputs>> {
  const prices = resolveDimension({
    market: price && { low: price.lowCents, mid: price.midCents, high: price.highCents },
    anchor: price?.midCents ?? 0,
    override: overrides.basePriceCents,
  });
  const days = resolveDimension({
    market: dom && { low: dom.lowDays, mid: dom.typicalDays, high: dom.highDays },
    anchor: dom?.typicalDays ?? 0,
    override: overrides.baseDomDays,
  });

  if ("missing" in prices || "missing" in days) {
    const lacking = [
      ...("missing" in prices ? ["sale price"] : []),
      ...("missing" in days ? ["days on market"] : []),
    ].join(" and ");
    const missing: MissingItem = {
      code: "noComps",
      message: `Include sold comps to estimate the ${lacking}, or enter a base ${lacking} override`,
      step: "market",
    };
    return incomplete([missing]);
  }

  const warnings: Warning[] = [];
  if (prices.fellBack || days.fellBack) {
    warnings.push({
      code: "noMarketRange",
      message: "No market range was available, so the base price or days on market override is used in every scenario",
    });
  }

  const scenarios = {} as Record<ScenarioName, ScenarioInputs>;
  for (const name of SCENARIO_NAMES) {
    const def = defs[name];
    scenarios[name] = {
      priceCents: prices.values[def.priceSource],
      // `typical` is the days-on-market range's mid.
      domDays: days.values[def.domSource === "typical" ? "mid" : def.domSource],
      overrunPct: def.overrunPct,
    };
  }
  return ok(scenarios, warnings);
}

/** One scenario run through the monthly cash flow and the headline metrics. */
export interface ScenarioResult {
  inputs: ScenarioInputs;
  cashFlow: CashFlow;
  metrics: Metrics;
}

/** Runs the cash flow and metrics for each scenario. */
export function runScenarios(
  d: DealInputs,
  e: Estimate,
  s: Record<ScenarioName, ScenarioInputs>,
): Record<ScenarioName, ScenarioResult> {
  const run = (inputs: ScenarioInputs): ScenarioResult => {
    const proForma = buildProFormaInput(d, e, inputs);
    const cashFlow = runCashFlow(proForma);
    return { inputs, cashFlow, metrics: computeMetrics(cashFlow, proForma) };
  };
  return { downside: run(s.downside), base: run(s.base), upside: run(s.upside) };
}

/** Sale price steps of the sensitivity grid, as a share of the base price, one row each. */
export const PRICE_DELTAS: readonly number[] = [0.05, 0, -0.05, -0.1, -0.15];

/** Days-on-market columns of the sensitivity grid, in ascending order. */
export const DOM_COLUMNS: readonly number[] = [30, 60, 90, 120, 180];

/** Profit bands for the grid's colors; `b50_100` is $50,000 up to but not including $100,000. */
export type Band = "loss" | "b0_50" | "b50_100" | "b100_150" | "b150_200" | "b200plus";

/** Lower edge of each band above `loss`, in cents; a profit on an edge belongs to the higher band. */
const BAND_FLOORS: readonly (readonly [Band, Cents])[] = [
  ["b200plus", 20_000_000],
  ["b150_200", 15_000_000],
  ["b100_150", 10_000_000],
  ["b50_100", 5_000_000],
  ["b0_50", 0],
];

/** The band a profit falls in: a loss below $0, then $50,000 steps up to $200,000 and over. */
export function bandOf(profitCents: Cents): Band {
  for (const [band, floorCents] of BAND_FLOORS) {
    if (profitCents >= floorCents) return band;
  }
  return "loss";
}

export interface GridCell {
  /** Share of the base price: `0.05` is 5% above it. */
  priceDelta: number;
  domDays: number;
  profitCents: Cents;
  band: Band;
  /** The cell closest to the base scenario: no price change, at the column nearest the base days on market. */
  isBase: boolean;
}

/**
 * Profit for each sale price step (rows, in `PRICE_DELTAS` order) and days on market (columns, in
 * `DOM_COLUMNS` order), with the overrun held at the base scenario's (spec §5.7). The base cell is
 * the 0% row at the column nearest the base days on market; a tie goes to the lower column.
 */
export function sensitivityGrid(d: DealInputs, e: Estimate, base: ScenarioInputs): GridCell[][] {
  const baseColumn = DOM_COLUMNS.reduce((best, column) =>
    Math.abs(column - base.domDays) < Math.abs(best - base.domDays) ? column : best,
  );
  return PRICE_DELTAS.map((priceDelta) =>
    DOM_COLUMNS.map((domDays): GridCell => {
      const inputs: ScenarioInputs = {
        priceCents: roundCents(base.priceCents * (1 + priceDelta)),
        domDays,
        overrunPct: base.overrunPct,
      };
      const proForma = buildProFormaInput(d, e, inputs);
      const profitCents = computeMetrics(runCashFlow(proForma), proForma).profitCents;
      return {
        priceDelta,
        domDays,
        profitCents,
        band: bandOf(profitCents),
        isBase: priceDelta === 0 && domDays === baseColumn,
      };
    }),
  );
}
