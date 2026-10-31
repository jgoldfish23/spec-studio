import { DEFAULT_QUANTITY_RULES, evaluateDeal } from "@engine";
import type { Comp, DealEvaluation, DealInputs, EngineContext, ISODate } from "@engine";
import { createLocalRepository } from "../data/local/localRepository";
import { sampleComps, sampleDealInputs } from "../data/sample";
import { MemoryStorage } from "../data/testing/memoryStorage";
import type { Repository } from "../data/types";

/** The date tests evaluate deals on, unless one says otherwise: the sample's comps are inside their year on it. */
export const TEST_TODAY: ISODate = "2026-10-31";

export interface ContextOptions {
  /** Where the cost book and market settings are read from. A fresh in-memory repository when omitted. */
  repository?: Repository;
  today?: ISODate;
  /** The comps to score; the sample's comps when omitted. */
  comps?: Comp[];
}

/** What the engine is given besides a deal, the way the app builds it: the starter cost book and market settings. */
export async function contextFor({
  repository = createLocalRepository(new MemoryStorage()),
  today = TEST_TODAY,
  comps = sampleComps(),
}: ContextOptions = {}): Promise<EngineContext> {
  return {
    today,
    costBook: await repository.getCostBook("utah-north"),
    comps,
    marketSettings: await repository.getMarketSettings("utah-north"),
    quantityRules: DEFAULT_QUANTITY_RULES,
  };
}

/** A deal (the sample deal when omitted) evaluated against `contextFor` on `today`. */
export async function evaluated(inputs: DealInputs = sampleDealInputs(), today: ISODate = TEST_TODAY): Promise<DealEvaluation> {
  return evaluateDeal(inputs, await contextFor({ today }));
}
