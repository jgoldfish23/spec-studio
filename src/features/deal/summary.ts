import type { Cents, DealEvaluation, DealInputs, ISODate, MissingItem } from "@engine";
import type { StepId } from "./steps";

/** The headline figures of a deal, from its base scenario. Every field is null while the scenarios are incomplete. */
export interface Summary {
  salePriceCents: Cents | null;
  totalProjectCostCents: Cents | null;
  profitCents: Cents | null;
  marginOnSale: number | null;
  annualizedReturn: number | null;
  /** The fewest days on market, from the upside scenario. */
  domLow: number | null;
  /** The most days on market, from the downside scenario. */
  domHigh: number | null;
}

export function summarize(evaluation: DealEvaluation): Summary {
  const { scenarios } = evaluation;
  if (scenarios.status !== "ok") {
    return {
      salePriceCents: null,
      totalProjectCostCents: null,
      profitCents: null,
      marginOnSale: null,
      annualizedReturn: null,
      domLow: null,
      domHigh: null,
    };
  }
  const { base, downside, upside } = scenarios.value;
  return {
    salePriceCents: base.metrics.salePriceCents,
    totalProjectCostCents: base.metrics.totalProjectCostCents,
    profitCents: base.metrics.profitCents,
    marginOnSale: base.metrics.marginOnSale,
    annualizedReturn: base.metrics.annualizedReturn,
    domLow: upside.inputs.domDays,
    domHigh: downside.inputs.domDays,
  };
}

/** The step where a missing item is fixed. The engine's own settings (cost book, comps, rules) show on the pro forma. */
export function stepForMissing(item: MissingItem): StepId {
  return item.step === "settings" ? "proforma" : item.step;
}

/** What the "Needs:" list shows: the first `limit` distinct items, and how many distinct ones are left out. */
export function topNeeds(
  missing: readonly MissingItem[] | undefined,
  limit = 3,
): { shown: MissingItem[]; more: number } {
  const seen = new Set<string>();
  const distinct = (missing ?? []).filter((item) => {
    if (seen.has(item.message)) return false;
    seen.add(item.message);
    return true;
  });
  return { shown: distinct.slice(0, limit), more: Math.max(0, distinct.length - limit) };
}

// ---------------------------------------------------------------------------------------------------------------
// Heads-up (spec §8, the suspicious-input warnings that need no regional data)

const MAX_LAND_SHARE = 0.4;
const MAX_DOM_DAYS = 365;
const MIN_CONTINGENCY = 0.03;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A usable number: stored deals may hold fixable-invalid values, and a check must not trust them. */
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The date a year before `today`, as text. Dates in this form compare in order as text. */
function yearBefore(today: ISODate): string | null {
  const match = DATE.exec(today);
  return match === null ? null : `${String(Number(match[1]) - 1).padStart(4, "0")}-${match[2]}-${match[3]}`;
}

/** The warnings shown under the summary strip. None needs a calculation that could throw on a half-filled deal. */
export function headsUp(inputs: DealInputs, evaluation: DealEvaluation, today: ISODate): string[] {
  const messages: string[] = [];
  const { salePriceCents } = summarize(evaluation);

  const land = finite(inputs.lot?.priceCents) && finite(inputs.lot?.closingCents) ? inputs.lot.priceCents + inputs.lot.closingCents : null;
  if (salePriceCents !== null && salePriceCents > 0 && land !== null && land > MAX_LAND_SHARE * salePriceCents) {
    messages.push("Land and closing are more than 40% of the sale price");
  }

  if (evaluation.scenarios.status === "ok") {
    const baseDays = evaluation.scenarios.value.base.inputs.domDays;
    if (finite(baseDays) && baseDays > MAX_DOM_DAYS) {
      messages.push("Days on market above 365 — check the comps and the price");
    }
  }

  if (finite(inputs.contingencyPct) && inputs.contingencyPct < MIN_CONTINGENCY) {
    messages.push("Contingency is below 3%");
  }

  const cutoff = yearBefore(today);
  if (cutoff !== null) {
    const included = evaluation.scoredComps.filter((scored) => scored.included && scored.comp.status === "sold");
    const isOld = ({ comp }: (typeof included)[number]) =>
      comp.soldDate !== undefined && DATE.test(comp.soldDate) && comp.soldDate < cutoff;
    if (included.length > 0 && included.every(isOld)) messages.push("Every included comp sold more than 12 months ago");
  }

  if (evaluation.estimate.status === "ok") {
    const stale = evaluation.estimate.value.staleCount;
    if (finite(stale) && stale > 0) {
      messages.push(stale === 1 ? "1 price is more than a year old" : `${stale} prices are more than a year old`);
    }
  }

  if (evaluation.scenarios.status === "ok") {
    for (const warning of evaluation.scenarios.warnings) {
      messages.push(
        warning.code === "noMarketRange"
          ? "No market range — the downside and upside use your own numbers"
          : warning.message,
      );
    }
  }

  return messages;
}
