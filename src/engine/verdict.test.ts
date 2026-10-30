import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type Rules } from "./deal";
import type { Metrics } from "./metrics";
import type { MissingItem } from "./result";
import { evaluateVerdict, incompleteVerdict, type RuleCheck } from "./verdict";

/** A passing, loan-free Metrics; each test overrides only what it is about. */
function metrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    salePriceCents: 135_000_000,
    totalProjectCostCents: 110_000_000,
    buildSpentCents: 80_000_000,
    financingCents: 4_000_000,
    carryCents: 3_000_000,
    sellingCostsCents: 8_000_000,
    profitCents: 25_000_000,
    marginOnSale: 0.185,
    marginOnCost: 0.227,
    peakCashCents: 40_000_000,
    returnOnCash: 0.62,
    annualizedReturn: 0.4,
    breakEvenSalePriceCents: 112_000_000,
    monthlyBurnWhileListedCents: 900_000,
    maxDomWithoutExtension: null,
    monthsLandToClose: 14,
    ...overrides,
  };
}

const DOWNSIDE_PASS = metrics({ profitCents: 6_000_000 });

/** The check for one rule; fails the test when it is absent. */
function check(checks: RuleCheck[], rule: RuleCheck["rule"]): RuleCheck {
  const found = checks.find((c) => c.rule === rule);
  if (!found) throw new Error(`no ${rule} check in ${JSON.stringify(checks)}`);
  return found;
}

describe("evaluateVerdict", () => {
  it("is marginal when only the margin rule fails (margin 12%, annual 31%, downside $28,970)", () => {
    const base = metrics({ marginOnSale: 0.12, annualizedReturn: 0.31 });
    const downside = metrics({ profitCents: 2_897_000 });
    const v = evaluateVerdict(base, downside, DEFAULT_RULES, 54);
    expect(v.kind).toBe("marginal");
    expect(v.checks.map((c) => [c.rule, c.pass])).toEqual([
      ["marginOnSale", false],
      ["annualizedReturn", true],
      ["downsideProfit", true],
    ]);
  });

  it("is a go when every rule passes", () => {
    const v = evaluateVerdict(metrics(), DOWNSIDE_PASS, DEFAULT_RULES, 54);
    expect(v.kind).toBe("go");
    expect(v.checks.every((c) => c.pass)).toBe(true);
  });

  it("is marginal when only the annualized return rule fails", () => {
    const v = evaluateVerdict(metrics({ annualizedReturn: 0.2 }), DOWNSIDE_PASS, DEFAULT_RULES, 54);
    expect(v.kind).toBe("marginal");
  });

  it("is a no-go when the base profit is below zero by one cent, even if every rule passes", () => {
    const v = evaluateVerdict(metrics({ profitCents: -1 }), DOWNSIDE_PASS, DEFAULT_RULES, 54);
    expect(v.kind).toBe("nogo");
    expect(v.checks.every((c) => c.pass)).toBe(true);
  });

  it("is a no-go when the base profit is exactly zero", () => {
    const v = evaluateVerdict(metrics({ profitCents: 0 }), DOWNSIDE_PASS, DEFAULT_RULES, 54);
    expect(v.kind).toBe("nogo");
  });

  it("is a no-go when only the downside rule fails", () => {
    const v = evaluateVerdict(metrics(), metrics({ profitCents: -1 }), DEFAULT_RULES, 54);
    expect(v.kind).toBe("nogo");
    expect(v.checks.filter((c) => !c.pass).map((c) => c.rule)).toEqual(["downsideProfit"]);
  });

  it("is a no-go when the margin and annualized return rules both fail", () => {
    const base = metrics({ marginOnSale: 0.1, annualizedReturn: 0.2 });
    const v = evaluateVerdict(base, DOWNSIDE_PASS, DEFAULT_RULES, 54);
    expect(v.kind).toBe("nogo");
    expect(v.checks.filter((c) => !c.pass).map((c) => c.rule)).toEqual(["marginOnSale", "annualizedReturn"]);
  });

  it("fails the annualized return check with actual null when the return is null", () => {
    const v = evaluateVerdict(metrics({ annualizedReturn: null }), DOWNSIDE_PASS, DEFAULT_RULES, 54);
    expect(check(v.checks, "annualizedReturn")).toEqual({
      rule: "annualizedReturn",
      pass: false,
      actual: null,
      threshold: 0.25,
    });
    expect(v.kind).toBe("marginal");
  });

  it("reports each rule's actual value and threshold, in rule order", () => {
    const base = metrics({ marginOnSale: 0.12, annualizedReturn: 0.31 });
    const v = evaluateVerdict(base, metrics({ profitCents: 2_897_000 }), DEFAULT_RULES, 54);
    expect(v.checks).toEqual([
      { rule: "marginOnSale", pass: false, actual: 0.12, threshold: 0.15 },
      { rule: "annualizedReturn", pass: true, actual: 0.31, threshold: 0.25 },
      { rule: "downsideProfit", pass: true, actual: 2_897_000, threshold: 0 },
    ]);
  });

  it("passes a rule that sits exactly on its threshold", () => {
    const rules: Rules = { minMarginOnSale: 0.185, minAnnualizedReturn: 0.4, minDownsideProfitCents: 6_000_000 };
    const v = evaluateVerdict(metrics(), DOWNSIDE_PASS, rules, 54);
    expect(v.checks.every((c) => c.pass)).toBe(true);
    expect(v.kind).toBe("go");
  });

  it("judges the downside rule on the downside scenario's profit, not the base's", () => {
    const rules: Rules = { ...DEFAULT_RULES, minDownsideProfitCents: 5_000_000 };
    const v = evaluateVerdict(metrics({ profitCents: 90_000_000 }), metrics({ profitCents: 4_999_999 }), rules, 54);
    expect(check(v.checks, "downsideProfit")).toEqual({
      rule: "downsideProfit",
      pass: false,
      actual: 4_999_999,
      threshold: 5_000_000,
    });
    expect(v.kind).toBe("nogo");
  });

  it("adds a loan warning when the base days on market pass the loan's limit (limit 56, base 62)", () => {
    const v = evaluateVerdict(metrics({ maxDomWithoutExtension: 56 }), DOWNSIDE_PASS, DEFAULT_RULES, 62);
    expect(v.loanWarning).toEqual({ maxDomWithoutExtension: 56, baseDomDays: 62 });
    expect(v.kind).toBe("go");
  });

  it("adds no loan warning at exactly the limit", () => {
    const v = evaluateVerdict(metrics({ maxDomWithoutExtension: 56 }), DOWNSIDE_PASS, DEFAULT_RULES, 56);
    expect(v).not.toHaveProperty("loanWarning");
  });

  it("adds no loan warning when there is no construction loan", () => {
    const v = evaluateVerdict(metrics({ maxDomWithoutExtension: null }), DOWNSIDE_PASS, DEFAULT_RULES, 400);
    expect(v).not.toHaveProperty("loanWarning");
  });

  it("never lists missing items", () => {
    const v = evaluateVerdict(metrics(), DOWNSIDE_PASS, DEFAULT_RULES, 54);
    expect(v).not.toHaveProperty("missing");
  });

  it("only returns go when every check passes (property)", () => {
    const arbMetrics = fc.record({
      profitCents: fc.integer({ min: -50_000_000, max: 50_000_000 }),
      marginOnSale: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
      annualizedReturn: fc.option(fc.double({ min: -1, max: 2, noNaN: true }), { nil: null }),
      maxDomWithoutExtension: fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }),
    });
    const arbRules = fc.record({
      minMarginOnSale: fc.double({ min: 0, max: 0.4, noNaN: true }),
      minAnnualizedReturn: fc.double({ min: 0, max: 1, noNaN: true }),
      minDownsideProfitCents: fc.integer({ min: -5_000_000, max: 5_000_000 }),
    });
    fc.assert(
      fc.property(
        arbMetrics,
        fc.integer({ min: -50_000_000, max: 50_000_000 }),
        arbRules,
        fc.integer({ min: 0, max: 250 }),
        (baseParts, downsideProfit, rules, domDays) => {
          const v = evaluateVerdict(metrics(baseParts), metrics({ profitCents: downsideProfit }), rules, domDays);
          expect(v.checks).toHaveLength(3);
          const failures = v.checks.filter((c) => !c.pass).length;
          if (v.kind === "go") {
            expect(failures).toBe(0);
            expect(baseParts.profitCents).toBeGreaterThan(0);
          }
          if (failures === 0 && baseParts.profitCents > 0) expect(v.kind).toBe("go");
          if (failures >= 2 || baseParts.profitCents <= 0) expect(v.kind).toBe("nogo");
          expect(v.kind).not.toBe("incomplete");
        },
      ),
    );
  });
});

describe("incompleteVerdict", () => {
  it("carries the missing items and no checks", () => {
    const missing: MissingItem[] = [{ code: "noComps", message: "Add comps", step: "market" }];
    expect(incompleteVerdict(missing)).toEqual({ kind: "incomplete", checks: [], missing });
  });
});
