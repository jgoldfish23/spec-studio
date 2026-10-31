import { evaluateDeal, FinishTierSchema } from "@engine";
import type { Cents, DealEvaluation, DealInputs, EngineContext, FinishTier } from "@engine";

/** What a house costs at one finish tier: per finished square foot, and in all. Null when the estimate is incomplete. */
export interface TierCost {
  costPerFinishedSfCents: Cents | null;
  totalCents: Cents | null;
}

/** The evaluation the deal already has, and the house tier it was worked out at. */
export interface CurrentEvaluation {
  tier: FinishTier;
  evaluation: DealEvaluation;
}

function costOf(evaluation: DealEvaluation): TierCost {
  const { estimate } = evaluation;
  if (estimate.status !== "ok") return { costPerFinishedSfCents: null, totalCents: null };
  return { costPerFinishedSfCents: estimate.value.costPerFinishedSfCents, totalCents: estimate.value.totalCents };
}

/** The deal with only the house tier changed. The deal it is given is not touched. */
function atTier(inputs: DealInputs, tier: FinishTier): DealInputs {
  const { house } = inputs;
  return { ...inputs, house: { ...house, finishes: { ...house.finishes, houseTier: tier } } };
}

/**
 * What the estimate comes to at each house finish tier, to show beside the tier buttons. The deal is evaluated once
 * per tier with only `finishes.houseTier` changed (kitchen, primary bath and basement overrides stay as they are).
 * An evaluation takes up to about 50 ms, so when the caller already has one, `current` gives it for its tier and that
 * tier is not evaluated again.
 */
export function tierPreview(
  inputs: DealInputs,
  ctx: EngineContext,
  current?: CurrentEvaluation,
): Record<FinishTier, TierCost> {
  const costs = {} as Record<FinishTier, TierCost>;
  for (const tier of FinishTierSchema.options) {
    const evaluation = current?.tier === tier ? current.evaluation : evaluateDeal(atTier(inputs, tier), ctx);
    costs[tier] = costOf(evaluation);
  }
  return costs;
}
