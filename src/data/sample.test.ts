import { describe, expect, it } from "vitest";
import {
  CompSchema,
  DEFAULT_MARKET_SETTINGS,
  DEFAULT_QUANTITY_RULES,
  evaluateDeal,
  validateDeal,
  type EngineContext,
} from "@engine";
import goldenComps from "../engine/__fixtures__/golden-comps.json";
import goldenDeal from "../engine/__fixtures__/golden-deal.inputs.json";
import { isUuid } from "../lib/uuid";
import { SAMPLE_COMP_IDS, SAMPLE_DEAL_NAME, sampleComps, sampleDealInputs } from "./sample";
import { STARTER_COST_BOOK } from "./starterCostBook";

const ctx = (): EngineContext => ({
  today: "2026-10-30",
  costBook: { defaults: STARTER_COST_BOOK, priceBook: [] },
  comps: sampleComps(),
  marketSettings: DEFAULT_MARKET_SETTINGS,
  quantityRules: DEFAULT_QUANTITY_RULES,
});

describe("the sample deal", () => {
  it("is named for the Kaysville lot", () => {
    expect(SAMPLE_DEAL_NAME).toBe("Sample — Kaysville lot");
  });

  it("is a valid deal", () => {
    expect(validateDeal(sampleDealInputs())).toEqual([]);
  });

  it("evaluates to a real verdict against the starter cost book", () => {
    const evaluation = evaluateDeal(sampleDealInputs(), ctx());
    expect(evaluation.validation).toEqual([]);
    expect(evaluation.verdict.kind).not.toBe("incomplete");
    expect(evaluation.estimate.status).toBe("ok");
    if (evaluation.estimate.status === "ok") {
      const { confidence } = evaluation.estimate.value;
      expect(confidence.bidCents).toBeGreaterThan(0);
      expect(confidence.defaultCents).toBeGreaterThan(0);
    }
    expect(evaluation.scoredComps).toHaveLength(8);
  });

  it("keeps only the plans, foundation, framing and cabinets bids", () => {
    expect(sampleDealInputs().bids.map((b) => b.code)).toEqual(["plans", "foundation", "framing", "cabinets"]);
  });

  it("lets the market drive the scenarios: no price or days-on-market override", () => {
    expect(sampleDealInputs().overrides).toEqual({});
  });

  it("shows a fireplace and a 400 sf covered patio", () => {
    const { house } = sampleDealInputs();
    expect(house.rooms.fireplaces).toBe(1);
    expect(house.outside.coveredPatioSf).toBe(400);
  });

  it("is otherwise the golden deal", () => {
    const expected = structuredClone(goldenDeal) as unknown as ReturnType<typeof sampleDealInputs>;
    expected.bids = expected.bids.filter((b) => ["plans", "foundation", "framing", "cabinets"].includes(b.code));
    expected.overrides = {};
    expected.house.rooms.fireplaces = 1;
    expected.house.outside.coveredPatioSf = 400;
    expect(sampleDealInputs()).toEqual(expected);
  });

  it("returns a fresh deep copy on every call", () => {
    const a = sampleDealInputs();
    a.lot.city = "Elsewhere";
    a.house.rooms.bedrooms = 1;
    a.bids.length = 0;
    a.compSelections["5a3e0c0e-5a3e-4000-8000-000000000001"] = false;
    const b = sampleDealInputs();
    expect(b.lot.city).toBe("Kaysville");
    expect(b.house.rooms.bedrooms).toBe(5);
    expect(b.bids).toHaveLength(4);
    expect(b.compSelections).toEqual({});
  });
});

describe("the sample comps", () => {
  it("are the 8 golden comps, each valid", () => {
    const comps = sampleComps();
    expect(comps).toHaveLength(8);
    const withoutId = (comp: { id: string }) => ({ ...comp, id: undefined });
    expect(comps.map(withoutId)).toEqual(goldenComps.map(withoutId));
    for (const comp of comps) expect(CompSchema.safeParse(comp).success, comp.id).toBe(true);
  });

  it("have UUID ids", () => {
    for (const comp of sampleComps()) expect(isUuid(comp.id), comp.id).toBe(true);
  });

  it("have 8 fixed ids, in fixture order", () => {
    const expected = Array.from({ length: 8 }, (_, i) => `5a3e0c0e-5a3e-4000-8000-00000000000${i + 1}`);
    expect(sampleComps().map((comp) => comp.id)).toEqual(expected);
    expect([...SAMPLE_COMP_IDS]).toEqual(expected);
  });

  it("return a fresh deep copy on every call", () => {
    const a = sampleComps();
    a[0]!.soldPriceCents = 1;
    a.pop();
    const b = sampleComps();
    expect(b).toHaveLength(8);
    expect(b[0]?.soldPriceCents).toBe(136_500_000);
  });
});
