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

/** The sample comp ids the demo build stored before ids became UUIDs, and the UUID each one became (fixture order). */
export const LEGACY_SAMPLE_COMP_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  goldenComps.map((comp, index) => [comp.id, `5a3e0c0e-5a3e-4000-8000-${String(index + 1).padStart(12, "0")}`]),
);

/**
 * The ids of the sample's comps: fixed v4 UUIDs, so the sample is the same rows on every device. They are sample data
 * in the shared comps library: a deal other than the sample leaves them out unless the owner puts them in, the Market
 * step tags them "Sample", and they go with the last sample deal.
 */
export const SAMPLE_COMP_IDS: ReadonlySet<string> = new Set(Object.values(LEGACY_SAMPLE_COMP_IDS));

/** A deal's comp choices that leave out every sample comp in `library`, so a real deal is never priced from sample data. */
export function leaveOutSampleComps(library: readonly Comp[]): Record<string, boolean> {
  return Object.fromEntries(library.filter((comp) => SAMPLE_COMP_IDS.has(comp.id)).map((comp) => [comp.id, false]));
}

/** The golden deal's 8 sold comps under their UUIDs, parsed on every call so each caller gets its own copy. */
export function sampleComps(): Comp[] {
  return goldenComps.map((comp) => CompSchema.parse({ ...comp, id: LEGACY_SAMPLE_COMP_IDS[comp.id] }));
}
