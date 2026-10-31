import type { Cents, DealEvaluation } from "@engine";
import { formatMoney } from "../../lib/format";

/**
 * The land price plus the closing costs, or null unless both are whole numbers of cents. Stored deals can hold
 * values the engine would refuse (a fraction, a missing figure), and a sum of those is not an amount to show.
 */
export function landPlusClosing(lot: { priceCents: unknown; closingCents: unknown }): Cents | null {
  const { priceCents, closingCents } = lot;
  if (typeof priceCents !== "number" || typeof closingCents !== "number") return null;
  if (!Number.isInteger(priceCents) || !Number.isInteger(closingCents)) return null;
  const sum = priceCents + closingCents;
  return Number.isSafeInteger(sum) ? sum : null;
}

/** `part` as a share of `whole` (a decimal), or null when either is missing or not above zero. */
export function shareOf(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (typeof part !== "number" || typeof whole !== "number") return null;
  if (!Number.isFinite(part) || !Number.isFinite(whole) || part <= 0 || whole <= 0) return null;
  return part / whole;
}

/** What the "Price that makes this a Go" row says, from goal seek's answer for the lot price alone. */
export function priceThatMakesGo(evaluation: DealEvaluation): string {
  if (evaluation.verdict.kind === "go") return "Already a Go";
  const lever = evaluation.goalSeek?.find((result) => result.lever === "lotPrice");
  if (lever === undefined) return "—";
  if (!lever.reachable) return "Not reachable with lot price alone";
  if (lever.valueCents === undefined || lever.deltaCents === undefined) return "—";
  return `${formatMoney(lever.valueCents)} (${formatMoney(lever.deltaCents)})`;
}
