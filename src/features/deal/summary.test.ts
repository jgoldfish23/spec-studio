import { testSampleComps } from "../../testing/sampleIds";
import { describe, expect, it } from "vitest";
import { evaluateDeal } from "@engine";
import type { DealEvaluation, MissingItem } from "@engine";
import { newDealInputs } from "../../data/newDeal";
import { sampleDealInputs } from "../../data/sample";
import { contextFor, evaluated, TEST_TODAY } from "../../testing/engineContext";
import { headsUp, stepForMissing, summarize, topNeeds } from "./summary";

const TODAY = TEST_TODAY;

function okScenarios(evaluation: DealEvaluation) {
  if (evaluation.scenarios.status !== "ok") throw new Error("the scenarios did not run");
  return evaluation.scenarios.value;
}

describe("summarize", () => {
  it("reads the base scenario, and the days on market range from the upside and downside", async () => {
    const evaluation = await evaluated();
    const scenarios = okScenarios(evaluation);
    const summary = summarize(evaluation);

    expect(summary.profitCents).toBe(scenarios.base.metrics.profitCents);
    expect(summary.salePriceCents).toBe(scenarios.base.metrics.salePriceCents);
    expect(summary.totalProjectCostCents).toBe(scenarios.base.metrics.totalProjectCostCents);
    expect(summary.marginOnSale).toBe(scenarios.base.metrics.marginOnSale);
    expect(summary.annualizedReturn).toBe(scenarios.base.metrics.annualizedReturn);
    expect(summary.domLow).toBe(scenarios.upside.inputs.domDays);
    expect(summary.domHigh).toBe(scenarios.downside.inputs.domDays);
    expect(summary.salePriceCents).toBeGreaterThan(0);
    expect(summary.domLow).not.toBeNull();
    expect(summary.domHigh).not.toBeNull();
    expect(summary.domLow as number).toBeLessThanOrEqual(summary.domHigh as number);
  });

  it("is null in every field while the scenarios are incomplete", async () => {
    const evaluation = await evaluated(newDealInputs(TODAY, { rules: sampleDealInputs().rules, contingencyPct: 0.05 }));
    expect(evaluation.scenarios.status).toBe("incomplete");
    expect(summarize(evaluation)).toEqual({
      salePriceCents: null,
      totalProjectCostCents: null,
      profitCents: null,
      marginOnSale: null,
      annualizedReturn: null,
      domLow: null,
      domHigh: null,
    });
  });

  it("keeps a null annualized return null", async () => {
    const evaluation = await evaluated();
    const scenarios = okScenarios(evaluation);
    const base = { ...scenarios.base, metrics: { ...scenarios.base.metrics, annualizedReturn: null } };
    const edited: DealEvaluation = { ...evaluation, scenarios: { status: "ok", value: { ...scenarios, base }, warnings: [] } };
    const summary = summarize(edited);
    expect(summary.annualizedReturn).toBeNull();
    expect(summary.profitCents).toBe(scenarios.base.metrics.profitCents);
  });
});

describe("stepForMissing", () => {
  const item = (step: MissingItem["step"]): MissingItem => ({ code: "x", message: "m", step });

  it.each(["lot", "house", "estimate", "market", "proforma"] as const)("keeps the %s step", (step) => {
    expect(stepForMissing(item(step))).toBe(step);
  });

  it("sends a settings item to the pro forma", () => {
    expect(stepForMissing(item("settings"))).toBe("proforma");
  });
});

describe("topNeeds", () => {
  const item = (message: string, step: MissingItem["step"] = "lot"): MissingItem => ({ code: "c", message, step });

  it("is empty when nothing is missing, or the verdict has no list", () => {
    expect(topNeeds(undefined)).toEqual({ shown: [], more: 0 });
    expect(topNeeds([])).toEqual({ shown: [], more: 0 });
  });

  it("shows up to three items and counts the rest", () => {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    expect(topNeeds(items)).toEqual({ shown: items.slice(0, 3), more: 2 });
    expect(topNeeds(items.slice(0, 3))).toEqual({ shown: items.slice(0, 3), more: 0 });
    expect(topNeeds(items.slice(0, 1))).toEqual({ shown: items.slice(0, 1), more: 0 });
  });

  it("lists items with the same message once", () => {
    const items = [item("a"), item("a", "house"), item("b"), item("a"), item("c"), item("d")];
    expect(topNeeds(items)).toEqual({ shown: [items[0], items[2], items[4]], more: 1 });
  });
});

describe("headsUp", () => {
  it("has nothing to say about the unmodified sample", async () => {
    const inputs = sampleDealInputs();
    expect(headsUp(inputs, await evaluated(inputs), TODAY)).toEqual([]);
  });

  it("warns when contingency is below 3%, and not at exactly 3%", async () => {
    const low = sampleDealInputs();
    low.contingencyPct = 0.02;
    expect(headsUp(low, await evaluated(low), TODAY)).toContain("Contingency is below 3%");

    const exactly = sampleDealInputs();
    exactly.contingencyPct = 0.03;
    expect(headsUp(exactly, await evaluated(exactly), TODAY)).not.toContain("Contingency is below 3%");
  });

  it("warns when land and closing are more than 40% of the base sale price", async () => {
    const inputs = sampleDealInputs();
    inputs.lot.priceCents = 70_000_000;
    expect(headsUp(inputs, await evaluated(inputs), TODAY)).toContain("Land and closing are more than 40% of the sale price");
  });

  it("counts the closing costs in the land share", async () => {
    const inputs = sampleDealInputs();
    const sale = okScenarios(await evaluated(inputs)).base.metrics.salePriceCents;
    const message = "Land and closing are more than 40% of the sale price";
    inputs.lot.priceCents = Math.floor(sale * 0.4) - 1_000_000;
    inputs.lot.closingCents = 900_000;
    expect(headsUp(inputs, await evaluated(inputs), TODAY)).not.toContain(message);
    inputs.lot.closingCents = 1_100_000;
    expect(headsUp(inputs, await evaluated(inputs), TODAY)).toContain(message);
  });

  it("warns when the base days on market are above 365, and not at 365", async () => {
    const message = "Days on market above 365 — check the comps and the price";
    const slow = sampleDealInputs();
    slow.overrides = { baseDomDays: 366 };
    expect(headsUp(slow, await evaluated(slow), TODAY)).toContain(message);

    const limit = sampleDealInputs();
    limit.overrides = { baseDomDays: 365 };
    expect(headsUp(limit, await evaluated(limit), TODAY)).not.toContain(message);
  });

  describe("old comps", () => {
    const message = "Every included comp sold more than 12 months ago";
    const allIncluded = (ids: readonly string[], included: readonly string[]) =>
      Object.fromEntries(ids.map((id) => [id, included.includes(id)]));
    const ids = testSampleComps().map((comp) => comp.id);

    it("warns when every included sold comp is more than 12 months old", async () => {
      const inputs = sampleDealInputs();
      inputs.compSelections = allIncluded(ids, ["5a3e0c0e-5a3e-4000-8000-000000000002", "5a3e0c0e-5a3e-4000-8000-000000000004"]);
      expect(headsUp(inputs, await evaluated(inputs, "2027-08-01"), "2027-08-01")).toContain(message);
    });

    it("does not warn while one included comp is within 12 months", async () => {
      const inputs = sampleDealInputs();
      inputs.compSelections = allIncluded(ids, ["5a3e0c0e-5a3e-4000-8000-000000000002", "5a3e0c0e-5a3e-4000-8000-000000000004", "5a3e0c0e-5a3e-4000-8000-000000000006"]);
      expect(headsUp(inputs, await evaluated(inputs, "2027-08-01"), "2027-08-01")).not.toContain(message);
    });

    it("counts a comp sold exactly 12 months ago as within the year", async () => {
      const inputs = sampleDealInputs();
      inputs.compSelections = allIncluded(ids, ["5a3e0c0e-5a3e-4000-8000-000000000006"]);
      expect(headsUp(inputs, await evaluated(inputs, "2027-09-15"), "2027-09-15")).not.toContain(message);
      expect(headsUp(inputs, await evaluated(inputs, "2027-09-16"), "2027-09-16")).toContain(message);
    });

    it("does not warn when no sold comp is included", async () => {
      const inputs = sampleDealInputs();
      inputs.compSelections = allIncluded(ids, []);
      inputs.overrides = { basePriceCents: 135_000_000, baseDomDays: 62 };
      expect(headsUp(inputs, await evaluated(inputs, "2028-01-01"), "2028-01-01")).not.toContain(message);
    });
  });

  describe("prices more than a year old", () => {
    it("counts the stale estimate lines", async () => {
      const inputs = sampleDealInputs();
      const evaluation = await evaluated(inputs, "2028-06-01");
      if (evaluation.estimate.status !== "ok") throw new Error("the estimate did not run");
      const count = evaluation.estimate.value.staleCount;
      expect(count).toBeGreaterThan(1);
      expect(headsUp(inputs, evaluation, "2028-06-01")).toContain(`${count} prices are more than a year old`);
    });

    it("says price, not prices, for one", async () => {
      const inputs = sampleDealInputs();
      const evaluation = await evaluated(inputs);
      if (evaluation.estimate.status !== "ok") throw new Error("the estimate did not run");
      const one: DealEvaluation = {
        ...evaluation,
        estimate: { ...evaluation.estimate, value: { ...evaluation.estimate.value, staleCount: 1 } },
      };
      expect(headsUp(inputs, one, TODAY)).toEqual(["1 price is more than a year old"]);
    });
  });

  describe("engine warnings", () => {
    it("explains a missing market range in the owner's words", async () => {
      const inputs = sampleDealInputs();
      inputs.overrides = { basePriceCents: 135_000_000, baseDomDays: 62 };
      const evaluation = evaluateDeal(inputs, await contextFor({ comps: [] }));
      expect(okScenarios(evaluation)).toBeDefined();
      expect(headsUp(inputs, evaluation, TODAY)).toContain(
        "No market range — the downside and upside use your own numbers",
      );
    });

    it("passes any other warning through with its own message", async () => {
      const inputs = sampleDealInputs();
      const evaluation = await evaluated(inputs);
      const scenarios = okScenarios(evaluation);
      const warned: DealEvaluation = {
        ...evaluation,
        scenarios: { status: "ok", value: scenarios, warnings: [{ code: "somethingNew", message: "Something looks odd" }] },
      };
      expect(headsUp(inputs, warned, TODAY)).toEqual(["Something looks odd"]);
    });
  });

  describe("when the deal cannot be evaluated", () => {
    it("still checks contingency, and skips the checks that need a price", async () => {
      const inputs = newDealInputs(TODAY, { rules: sampleDealInputs().rules, contingencyPct: 0.02 });
      inputs.lot.priceCents = 99_000_000;
      const evaluation = await evaluated(inputs);
      expect(evaluation.scenarios.status).toBe("incomplete");
      expect(headsUp(inputs, evaluation, TODAY)).toEqual(["Contingency is below 3%"]);
    });

    it("does not throw on a fixable-invalid date, a bad today, or numbers that are not numbers", async () => {
      const inputs = sampleDealInputs();
      inputs.timeline.landClose = "2026-13";
      const evaluation = await evaluated(inputs);
      expect(evaluation.validation.length).toBeGreaterThan(0);
      expect(headsUp(inputs, evaluation, TODAY)).toEqual([]);

      const broken = sampleDealInputs();
      broken.contingencyPct = Number.NaN;
      broken.lot.priceCents = Number.POSITIVE_INFINITY;
      expect(headsUp(broken, await evaluated(sampleDealInputs()), "not a date")).toEqual([]);
      expect(headsUp(broken, await evaluated(sampleDealInputs()), TODAY)).toEqual([]);
    });
  });
});
