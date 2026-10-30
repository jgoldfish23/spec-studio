import { buildProFormaInput, type ScenarioInputs } from "./cashflow";
import type { CostBookView, Division } from "./costbook";
import { calendarMonth, type ISODate } from "./dates";
import { listYearMonth, validateDeal, type DealInputs } from "./deal";
import { estimateDom, type DomEstimate } from "./dom";
import { buildEstimate, type Estimate } from "./estimate";
import { goalSeek, type Adjustment, type LeverResult } from "./goalseek";
import {
  estimatePrice,
  scoreComps,
  subjectFromDeal,
  type Comp,
  type MarketSettings,
  type PriceEstimate,
} from "./market";
import { breakEvenDomDays } from "./metrics";
import { mulRate, roundCents, sumCents } from "./money";
import { computeQuantities, type Quantities, type QuantityRules } from "./quantities";
import { incomplete, ok, type MissingItem, type Result, type ValidationIssue } from "./result";
import {
  resolveScenarios,
  runScenarios,
  sensitivityGrid,
  type GridCell,
  type ScenarioName,
  type ScenarioResult,
} from "./scenarios";
import { evaluateVerdict, incompleteVerdict, type Verdict } from "./verdict";

/** Everything a deal is evaluated against besides the deal itself. */
export interface EngineContext {
  /** Passed in, never read from a clock. */
  today: ISODate;
  costBook: CostBookView;
  /** The comps to score; the caller supplies the relevant ones. */
  comps: Comp[];
  marketSettings: MarketSettings;
  quantityRules: QuantityRules;
}

/** One deal, evaluated end to end. A step that could not run is `incomplete` with what it needs. */
export interface DealEvaluation {
  /** Empty when the deal is valid. When it is not, nothing else runs. */
  validation: ValidationIssue[];
  quantities: Result<Quantities>;
  estimate: Result<Estimate>;
  price: Result<PriceEstimate>;
  dom: Result<DomEstimate>;
  scenarios: Result<Record<ScenarioName, ScenarioResult>>;
  /** Null unless the scenarios ran. */
  grid: GridCell[][] | null;
  verdict: Verdict;
  /** Present only when the verdict is marginal or no-go. */
  goalSeek: LeverResult[] | null;
  /** The base scenario's break-even days on market; null when the scenarios did not run or profit outlasts 3 years. */
  breakEvenDomDays: number | null;
}

type ScenarioInputSet = Record<ScenarioName, ScenarioInputs>;

const missingOf = <T>(r: Result<T>): MissingItem[] => (r.status === "incomplete" ? r.missing : []);

/** The items in order, each distinct item once. */
function distinct(items: readonly MissingItem[]): MissingItem[] {
  const seen = new Set<string>();
  return items.filter((m) => {
    const key = JSON.stringify([m.code, m.message, m.step]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The wizard step that fixes a validation issue, from the top of its path. */
function stepFor(path: string): MissingItem["step"] {
  const top = path.split(".")[0];
  if (top === "house") return "house";
  if (top === "lot") return "lot";
  return "proforma";
}

/** An invalid deal: every step is incomplete with one item per issue, and nothing is computed. */
function invalidEvaluation(validation: ValidationIssue[]): DealEvaluation {
  const missing: MissingItem[] = validation.map((issue) => ({
    code: "invalidDeal",
    message: `${issue.path}: ${issue.message}`,
    step: stepFor(issue.path),
  }));
  return {
    validation,
    quantities: incomplete(missing),
    estimate: incomplete(missing),
    price: incomplete(missing),
    dom: incomplete(missing),
    scenarios: incomplete(missing),
    grid: null,
    verdict: incompleteVerdict(missing),
    goalSeek: null,
    breakEvenDomDays: null,
  };
}

/**
 * The estimate with every line's total scaled by `factor` (rounded per line), and the subtotal,
 * contingency, total and division subtotals worked out again from the scaled lines. Used only to
 * re-run the cash flow, which reads nothing else; the other fields are carried over unchanged.
 */
function scaleEstimate(e: Estimate, factor: number): Estimate {
  const lines = e.lines.map((line) => ({ ...line, totalCents: roundCents(line.totalCents * factor) }));
  const divisionSubtotals = { ...e.divisionSubtotals };
  for (const division of Object.keys(divisionSubtotals) as Division[]) divisionSubtotals[division] = 0;
  for (const line of lines) divisionSubtotals[line.division] += line.totalCents;
  const subtotalCents = sumCents(lines.map((line) => line.totalCents));
  const contingencyCents = mulRate(subtotalCents, e.contingencyPct);
  const totalCents = subtotalCents + contingencyCents;
  return { ...e, lines, divisionSubtotals, subtotalCents, contingencyCents, totalCents };
}

/** Every scenario's sale price scaled by `factor`, rounded to the cent. */
function scalePrices(s: ScenarioInputSet, factor: number): ScenarioInputSet {
  const scale = (inputs: ScenarioInputs): ScenarioInputs => ({
    ...inputs,
    priceCents: roundCents(inputs.priceCents * factor),
  });
  return { downside: scale(s.downside), base: scale(s.base), upside: scale(s.upside) };
}

/** Runs the scenarios and judges them against the deal's rules. */
function judge(
  d: DealInputs,
  e: Estimate,
  inputs: ScenarioInputSet,
): { results: Record<ScenarioName, ScenarioResult>; verdict: Verdict } {
  const results = runScenarios(d, e, inputs);
  const verdict = evaluateVerdict(results.base.metrics, results.downside.metrics, d.rules, inputs.base.domDays);
  return { results, verdict };
}

/**
 * Evaluates a deal end to end (spec §5): validate → quantities → estimate → comps → sale price →
 * days on market → scenarios → sensitivity grid → verdict → goal seek (marginal or no-go only) →
 * base break-even days on market. An invalid deal stops after validation. Missing inputs from any
 * step roll up into an `incomplete` verdict, and nothing past the scenarios is computed then.
 */
export function evaluateDeal(d: DealInputs, ctx: EngineContext): DealEvaluation {
  const validation = validateDeal(d);
  if (validation.length > 0) return invalidEvaluation(validation);

  const quantities = computeQuantities(d.house, d.lot, ctx.quantityRules);
  const estimate: Result<Estimate> =
    quantities.status === "ok"
      ? buildEstimate(quantities.value, d.house, ctx.costBook, d.bids, {
          region: d.lot.region,
          contingencyPct: d.contingencyPct,
          buildMonths: d.timeline.buildMonths,
          today: ctx.today,
        })
      : incomplete(quantities.missing);

  const subject = subjectFromDeal(d.house, d.lot);
  const scored = scoreComps(subject, ctx.comps, ctx.marketSettings, d.compSelections, ctx.today);
  const price = estimatePrice(subject, scored, ctx.marketSettings);
  const priceMidCents = price.status === "ok" ? price.value.midCents : 0;
  const listMonth = calendarMonth(listYearMonth(d.timeline));
  const dom = estimateDom(scored, ctx.marketSettings, listMonth, priceMidCents, d.plannedListPriceCents, ctx.today);

  // The overrides can stand in for a missing market range, so price and days on market block the
  // scenarios only through what `resolveScenarios` reports.
  const resolved = resolveScenarios(
    d.scenarioDefs,
    price.status === "ok" ? price.value : null,
    dom.status === "ok" ? dom.value : null,
    d.overrides,
  );

  if (estimate.status !== "ok" || resolved.status !== "ok") {
    // The scenarios need all of these, so they and the verdict report the same blocking items.
    const missing = distinct([...missingOf(quantities), ...missingOf(estimate), ...missingOf(resolved)]);
    return {
      validation,
      quantities,
      estimate,
      price,
      dom,
      scenarios: incomplete(missing),
      grid: null,
      verdict: incompleteVerdict(missing),
      goalSeek: null,
      breakEvenDomDays: null,
    };
  }

  const e = estimate.value;
  const inputs = resolved.value;
  const { results, verdict } = judge(d, e, inputs);
  const grid = sensitivityGrid(d, e, inputs.base);

  let levers: LeverResult[] | null = null;
  if (verdict.kind === "marginal" || verdict.kind === "nogo") {
    // Each probe re-runs only the scenarios and the verdict, on the inputs already resolved above.
    const isGo = (a: Adjustment): boolean => {
      const deal = a.lotPriceCents === undefined ? d : { ...d, lot: { ...d.lot, priceCents: a.lotPriceCents } };
      const est = a.buildCostFactor === undefined ? e : scaleEstimate(e, a.buildCostFactor);
      const scenarioInputs = a.salePriceFactor === undefined ? inputs : scalePrices(inputs, a.salePriceFactor);
      return judge(deal, est, scenarioInputs).verdict.kind === "go";
    };
    levers = goalSeek(
      { lotPriceCents: d.lot.priceCents, basePriceCents: inputs.base.priceCents, buildTotalCents: e.totalCents },
      isGo,
    );
  }

  return {
    validation,
    quantities,
    estimate,
    price,
    dom,
    scenarios: ok(results, resolved.warnings),
    grid,
    verdict,
    goalSeek: levers,
    breakEvenDomDays: breakEvenDomDays(buildProFormaInput(d, e, inputs.base)),
  };
}
