import { describe, expect, it } from "vitest";
import { DEFAULT_QUANTITY_RULES, evaluateDeal } from "@engine";
import type { DealEvaluation, DealInputs, EngineContext } from "@engine";
import { createLocalRepository } from "../../data/local/localRepository";
import { sampleComps, sampleDealInputs } from "../../data/sample";
import { MemoryStorage } from "../../data/testing/memoryStorage";
import { fieldError } from "./fieldErrors";

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

/** The sample deal with edits that break rules the owner can fix. */
async function withProblems(edit: (draft: DealInputs) => void): Promise<DealEvaluation> {
  const inputs = sampleDealInputs();
  edit(inputs);
  return evaluated(inputs);
}

describe("fieldError", () => {
  it("returns the message of the issue at exactly that path", async () => {
    const evaluation = await withProblems((draft) => {
      draft.lot.city = "";
    });
    expect(evaluation.validation.map((issue) => issue.path)).toEqual(["lot.city"]);
    expect(fieldError(evaluation, "lot.city")).toBe("Required");
    expect(fieldError(evaluation, "lot.county")).toBeUndefined();
  });

  it("returns the first issue when a path has more than one", async () => {
    const evaluation = await withProblems((draft) => {
      draft.lot.city = "";
    });
    const twice = { ...evaluation, validation: [...evaluation.validation, { path: "lot.city", message: "Second" }] };
    expect(fieldError(twice, "lot.city")).toBe("Required");
  });

  it("returns an issue under the path when none is at the path itself", async () => {
    const evaluation = await withProblems((draft) => {
      draft.lot.financing = { kind: "loan", ltv: 1.5, rate: 0.1, points: 0.01 };
    });
    expect(evaluation.validation.map((issue) => issue.path)).toEqual(["lot.financing.ltv"]);
    expect(fieldError(evaluation, "lot.financing.ltv")).toMatch(/1 or less/);
    expect(fieldError(evaluation, "lot.financing")).toBe(fieldError(evaluation, "lot.financing.ltv"));
    expect(fieldError(evaluation, "lot")).toBe(fieldError(evaluation, "lot.financing.ltv"));
  });

  it("prefers an issue at the exact path over one under it", async () => {
    const evaluation = await withProblems(() => {});
    const mixed: DealEvaluation = {
      ...evaluation,
      validation: [
        { path: "lot.financing.ltv", message: "Under" },
        { path: "lot.financing", message: "Exact" },
      ],
    };
    expect(fieldError(mixed, "lot.financing")).toBe("Exact");
  });

  it("does not treat a path that only starts with the same letters as under it", async () => {
    const evaluation = await withProblems((draft) => {
      draft.lot.county = "";
    });
    expect(fieldError(evaluation, "lot.count")).toBeUndefined();
    expect(fieldError(evaluation, "lot.county.name")).toBeUndefined();
  });

  it("is undefined for a valid evaluation", async () => {
    const evaluation = await evaluated(sampleDealInputs());
    expect(evaluation.validation).toEqual([]);
    expect(fieldError(evaluation, "lot.city")).toBeUndefined();
    expect(fieldError(evaluation, "lot")).toBeUndefined();
  });

  it("is undefined when there is no evaluation yet", () => {
    expect(fieldError(undefined, "lot.city")).toBeUndefined();
  });
});
