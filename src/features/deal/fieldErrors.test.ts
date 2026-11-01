import { describe, expect, it } from "vitest";
import type { DealEvaluation, DealInputs } from "@engine";
import { sampleDealInputs } from "../../data/sample";
import { evaluated } from "../../testing/engineContext";
import { fieldError } from "./fieldErrors";

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
