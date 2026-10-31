import { FinishTierSchema } from "@engine";
import type { DealEvaluation, FinishTier, HouseModel } from "@engine";
import type { DealEditor } from "../deal/useDealEditor";

export type Edit = DealEditor["edit"];

/** What each card of the house page is given: the house as stored, the evaluation to read messages from, and the way to change it. */
export interface HouseCardProps {
  house: HouseModel;
  evaluation: DealEvaluation;
  edit: Edit;
}

/** The most an area may be: the engine's cap, 50,000 sf (or ft). */
export const MAX_AREA = 50_000;
/** The most garage bays the engine takes. */
export const MAX_BAYS = 10;
/** The most bedrooms, baths or fireplaces the engine takes. */
export const MAX_ROOMS = 20;

/** Boxes in a row, wrapping to fewer columns on a phone. */
export const FIELD_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-4";
/** Narrow boxes, such as percents, two to a row on a phone. */
export const COUNT_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))] gap-4";
/** Six counts in two rows of three (two to a row on a phone), rather than five and one left over. */
export const SIX_GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3";
/** Choice controls, which need more room than a box. */
export const CHOICE_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4";

export const TIER_NAMES: Record<FinishTier, string> = {
  standard: "Standard",
  upgraded: "Upgraded",
  luxury: "Luxury",
};

/** The three finish tiers as options for a segmented control. */
export const TIER_OPTIONS = FinishTierSchema.options.map((value) => ({ value, label: TIER_NAMES[value] }));

/**
 * The engine's message for exactly `path`, not for a field under it (a rule that spans several boxes, such as the
 * footprint's, is shown once for the group while each box shows its own).
 */
export function issueAt(evaluation: DealEvaluation, path: string): string | undefined {
  return evaluation.validation.find((issue) => issue.path === path)?.message;
}
