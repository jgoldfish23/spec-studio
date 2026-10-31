import { CompSchema, DealInputsSchema } from "@engine";
import type { Comp, DealInputs } from "@engine";
// The one place app code reads engine fixtures: the sample is the golden deal, so it stays in step with the engine's checks.
import goldenComps from "../engine/__fixtures__/golden-comps.json";
import goldenDeal from "../engine/__fixtures__/golden-deal.inputs.json";

export const SAMPLE_DEAL_NAME = "Sample — Kaysville lot";

/** The bids the sample keeps; every other line is priced from the cost book, so the estimate shows both. */
const SAMPLE_BID_CODES: readonly string[] = ["plans", "foundation", "framing", "cabinets"];

/**
 * The golden deal with a few changes: only four of its bids, so the rest of the estimate comes from the starter cost
 * book; no price or days-on-market override, so the market drives the scenarios; and a fireplace and a 400 sf covered
 * patio, so those lines show. Parsed on every call, so each caller gets its own copy to change.
 */
export function sampleDealInputs(): DealInputs {
  const deal = DealInputsSchema.parse(goldenDeal);
  deal.bids = deal.bids.filter((bid) => SAMPLE_BID_CODES.includes(bid.code));
  deal.overrides = {};
  deal.house.rooms.fireplaces = 1;
  deal.house.outside.coveredPatioSf = 400;
  return deal;
}

/** The golden deal's 8 sold comps, parsed on every call so each caller gets its own copy. */
export function sampleComps(): Comp[] {
  return goldenComps.map((comp) => CompSchema.parse(comp));
}
