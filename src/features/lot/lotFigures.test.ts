import { describe, expect, it } from "vitest";
import { DEFAULT_QUANTITY_RULES, evaluateDeal } from "@engine";
import type { DealEvaluation, DealInputs, EngineContext } from "@engine";
import { createLocalRepository } from "../../data/local/localRepository";
import { newDealInputs } from "../../data/newDeal";
import { sampleComps, sampleDealInputs } from "../../data/sample";
import { MemoryStorage } from "../../data/testing/memoryStorage";
import { landPlusClosing, priceThatMakesGo, shareOf } from "./lotFigures";

describe("landPlusClosing", () => {
  it("adds the price and the closing costs", () => {
    expect(landPlusClosing({ priceCents: 29_500_000, closingCents: 400_000 })).toBe(29_900_000);
    expect(landPlusClosing({ priceCents: 0, closingCents: 0 })).toBe(0);
  });

  it("is null unless both are whole numbers of cents", () => {
    expect(landPlusClosing({ priceCents: 100.5, closingCents: 0 })).toBeNull();
    expect(landPlusClosing({ priceCents: 100, closingCents: 0.25 })).toBeNull();
    expect(landPlusClosing({ priceCents: Number.NaN, closingCents: 0 })).toBeNull();
    expect(landPlusClosing({ priceCents: 100, closingCents: Number.POSITIVE_INFINITY })).toBeNull();
    expect(landPlusClosing({ priceCents: undefined, closingCents: 0 })).toBeNull();
    expect(landPlusClosing({ priceCents: "100", closingCents: 0 })).toBeNull();
  });

  it("is null when the sum is too large to be exact", () => {
    expect(landPlusClosing({ priceCents: Number.MAX_SAFE_INTEGER, closingCents: 5 })).toBeNull();
  });
});

describe("shareOf", () => {
  it("divides the part by the whole", () => {
    expect(shareOf(25, 100)).toBe(0.25);
  });

  it("is null when either figure is missing, zero or not a finite number", () => {
    expect(shareOf(null, 100)).toBeNull();
    expect(shareOf(25, null)).toBeNull();
    expect(shareOf(undefined, 100)).toBeNull();
    expect(shareOf(0, 100)).toBeNull();
    expect(shareOf(25, 0)).toBeNull();
    expect(shareOf(Number.NaN, 100)).toBeNull();
    expect(shareOf(25, Number.POSITIVE_INFINITY)).toBeNull();
    expect(shareOf(-5, 100)).toBeNull();
  });
});

describe("priceThatMakesGo", () => {
  async function evaluated(inputs: DealInputs): Promise<DealEvaluation> {
    const repository = createLocalRepository(new MemoryStorage());
    const context: EngineContext = {
      today: "2026-10-31",
      costBook: await repository.getCostBook("utah-north"),
      comps: sampleComps(),
      marketSettings: await repository.getMarketSettings("utah-north"),
      quantityRules: DEFAULT_QUANTITY_RULES,
    };
    return evaluateDeal(inputs, context);
  }

  it("gives the price and how far it is below the current one", async () => {
    const evaluation = await evaluated(sampleDealInputs());
    expect(evaluation.verdict.kind).toBe("marginal");
    const lever = evaluation.goalSeek?.find((result) => result.lever === "lotPrice");
    expect(lever?.reachable).toBe(true);
    expect(priceThatMakesGo(evaluation)).toBe("$227,100 (−$67,900)");
  });

  it("says so when the deal is already a Go", async () => {
    const inputs = sampleDealInputs();
    inputs.lot.priceCents = 100;
    const evaluation = await evaluated(inputs);
    expect(evaluation.verdict.kind).toBe("go");
    expect(priceThatMakesGo(evaluation)).toBe("Already a Go");
  });

  it("says when the lot price alone cannot get there", async () => {
    const inputs = sampleDealInputs();
    inputs.overrides.basePriceCents = 50_000_000;
    const evaluation = await evaluated(inputs);
    expect(evaluation.verdict.kind).toBe("nogo");
    expect(priceThatMakesGo(evaluation)).toBe("Not reachable with lot price alone");
  });

  it("is a dash while the deal is incomplete, and when goal seek has no lot-price answer", async () => {
    const incomplete = await evaluated(newDealInputs("2026-10-31", { rules: sampleDealInputs().rules, contingencyPct: 0.05 }));
    expect(incomplete.goalSeek).toBeNull();
    expect(priceThatMakesGo(incomplete)).toBe("—");

    const marginal = await evaluated(sampleDealInputs());
    expect(priceThatMakesGo({ ...marginal, goalSeek: [] })).toBe("—");
    expect(priceThatMakesGo({ ...marginal, goalSeek: [{ lever: "lotPrice", reachable: true }] })).toBe("—");
  });
});
