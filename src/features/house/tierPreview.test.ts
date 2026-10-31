import { describe, expect, it, vi } from "vitest";
import { evaluateDeal, FinishTierSchema } from "@engine";
import type { DealInputs } from "@engine";
import { sampleDealInputs } from "../../data/sample";
import { contextFor } from "../../testing/engineContext";
import { tierPreview } from "./tierPreview";

// Every call to the engine is counted, but still answered by the real thing.
vi.mock("@engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@engine")>();
  return { ...actual, evaluateDeal: vi.fn(actual.evaluateDeal) };
});

const evaluateCalls = vi.mocked(evaluateDeal);

function withTier(inputs: DealInputs, tier: "standard" | "upgraded" | "luxury"): DealInputs {
  const copy = structuredClone(inputs);
  copy.house.finishes.houseTier = tier;
  return copy;
}

describe("tierPreview", () => {
  it("prices the sample deal higher at each tier: standard < upgraded < luxury", async () => {
    const preview = tierPreview(sampleDealInputs(), await contextFor());

    for (const tier of FinishTierSchema.options) {
      expect(preview[tier].costPerFinishedSfCents).toEqual(expect.any(Number));
      expect(preview[tier].totalCents).toEqual(expect.any(Number));
    }
    expect(preview.standard.costPerFinishedSfCents).toBeLessThan(preview.upgraded.costPerFinishedSfCents ?? 0);
    expect(preview.upgraded.costPerFinishedSfCents).toBeLessThan(preview.luxury.costPerFinishedSfCents ?? 0);
    expect(preview.standard.totalCents).toBeLessThan(preview.upgraded.totalCents ?? 0);
    expect(preview.upgraded.totalCents).toBeLessThan(preview.luxury.totalCents ?? 0);
  });

  it("gives the engine's own estimate for each tier, with only the house tier changed", async () => {
    const inputs = sampleDealInputs();
    const ctx = await contextFor();
    const preview = tierPreview(inputs, ctx);

    for (const tier of FinishTierSchema.options) {
      const estimate = evaluateDeal(withTier(inputs, tier), ctx).estimate;
      if (estimate.status !== "ok") throw new Error(`the ${tier} estimate is incomplete`);
      expect(preview[tier]).toEqual({
        costPerFinishedSfCents: estimate.value.costPerFinishedSfCents,
        totalCents: estimate.value.totalCents,
      });
    }
  });

  it("leaves the inputs it was given alone, even frozen ones", async () => {
    const inputs = sampleDealInputs();
    const ctx = await contextFor();
    const before = structuredClone(inputs);
    tierPreview(inputs, ctx);
    expect(inputs).toEqual(before);

    const freeze = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    };
    freeze(inputs);
    expect(() => tierPreview(inputs, ctx)).not.toThrow();
  });

  it("evaluates the deal once per tier, and reuses the current evaluation for the current tier", async () => {
    const inputs = sampleDealInputs();
    const ctx = await contextFor();
    const current = { tier: inputs.house.finishes.houseTier, evaluation: evaluateDeal(inputs, ctx) };

    evaluateCalls.mockClear();
    const without = tierPreview(inputs, ctx);
    expect(evaluateCalls).toHaveBeenCalledTimes(3);

    evaluateCalls.mockClear();
    const withCurrent = tierPreview(inputs, ctx, current);
    expect(evaluateCalls).toHaveBeenCalledTimes(2);
    expect(withCurrent).toEqual(without);
  });

  it("gives null for a tier whose estimate cannot be worked out, and still prices the others", async () => {
    const inputs = sampleDealInputs();
    const ctx = await contextFor();
    // A house the engine refuses outright (exterior percentages that do not add up) is incomplete at every tier.
    inputs.house.exterior.stonePct = 80;
    const preview = tierPreview(inputs, ctx);
    for (const tier of FinishTierSchema.options) {
      expect(preview[tier]).toEqual({ costPerFinishedSfCents: null, totalCents: null });
    }
  });

  it("prices all three tiers for a deal whose stored tier the engine does not know", async () => {
    const inputs = sampleDealInputs();
    const ctx = await contextFor();
    const raw = structuredClone(inputs);
    (raw.house.finishes as { houseTier: string }).houseTier = "platinum";
    expect(tierPreview(raw, ctx)).toEqual(tierPreview(inputs, ctx));
  });
});
