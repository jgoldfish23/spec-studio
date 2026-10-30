import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, DEFAULT_SCENARIO_DEFS, validateDeal } from "../deal";
import { GOLDEN_COMPS, GOLDEN_DEAL, GOLDEN_EXPECTED } from "./golden";
import { SAMPLE_HOUSE, SAMPLE_LOT } from "./sampleHouse";

describe("golden deal fixture", () => {
  it("is a valid deal with the 25 bids from the brief", () => {
    expect(validateDeal(GOLDEN_DEAL)).toEqual([]);
    expect(GOLDEN_DEAL.bids).toHaveLength(25);
    expect(GOLDEN_DEAL.bids.reduce((s, b) => s + b.amountCents, 0)).toBe(70_095_000);
    const soft = GOLDEN_DEAL.bids.filter((b) => ["plans", "permits", "surveySoils"].includes(b.code));
    expect(soft.reduce((s, b) => s + b.amountCents, 0)).toBe(3_850_000);
  });

  it("uses the sample house (no fireplace, no covered patio), the sample lot, and default rules", () => {
    expect(GOLDEN_DEAL.house).toEqual({
      ...SAMPLE_HOUSE,
      rooms: { ...SAMPLE_HOUSE.rooms, fireplaces: 0 },
      outside: { ...SAMPLE_HOUSE.outside, coveredPatioSf: 0 },
    });
    expect(GOLDEN_DEAL.lot).toEqual(SAMPLE_LOT);
    expect(GOLDEN_DEAL.rules).toEqual(DEFAULT_RULES);
    expect(GOLDEN_DEAL.scenarioDefs).toEqual(DEFAULT_SCENARIO_DEFS);
  });

  it("has expected values whose shape matches the reference timeline", () => {
    expect(GOLDEN_EXPECTED.scenarios.base.periods).toHaveLength(15); // saleClose ≈ 14.189
    expect(GOLDEN_EXPECTED.scenarios.base.extensions).toBe(1);
    expect(GOLDEN_EXPECTED.scenarios.stress.extensions).toBe(4); // saleClose ≈ 25.301, maturity 14
    expect(GOLDEN_EXPECTED.scenarios.base.metrics.maxDomWithoutExtension).toBe(56);
  });

  it("has internally consistent expected values for every scenario", () => {
    for (const s of Object.values(GOLDEN_EXPECTED.scenarios)) {
      const sum = (f: (p: (typeof s.periods)[number]) => number) => s.periods.reduce((t, p) => t + f(p), 0);
      expect(sum((p) => p.spendCents)).toBe(s.metrics.buildSpentCents);
      expect(sum((p) => p.equitySpendCents + p.loanDrawCents)).toBe(s.metrics.buildSpentCents);
      expect(s.equityFlows).toHaveLength(s.periods.length + 1);
      expect(s.equityFlows.reduce((t, f) => t + f.cents, 0)).toBe(s.metrics.profitCents);
    }
  });

  it("has the 8 comps from the market mockup", () => {
    expect(GOLDEN_COMPS).toHaveLength(8);
  });
});
