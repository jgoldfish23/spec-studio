import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES, DEFAULT_SCENARIO_DEFS, validateDeal } from "@engine";
import golden from "../engine/__fixtures__/golden-deal.inputs.json";
import { newDealInputs } from "./newDeal";
import type { CompanySettings } from "./types";

const defaults: CompanySettings = { rules: DEFAULT_RULES, contingencyPct: 0.05 };

describe("newDealInputs", () => {
  it("is valid except for the city, which the owner has to fill in", () => {
    const issues = validateDeal(newDealInputs("2026-10-30", defaults));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("lot.city");
  });

  it("is valid once the city is set", () => {
    const deal = newDealInputs("2026-10-30", defaults);
    deal.lot.city = "Kaysville";
    expect(validateDeal(deal)).toEqual([]);
  });

  it("lands the lot the month after today", () => {
    expect(newDealInputs("2026-10-30", defaults).timeline.landClose).toBe("2026-11");
    expect(newDealInputs("2026-12-15", defaults).timeline.landClose).toBe("2027-01");
    expect(newDealInputs("2027-01-01", defaults).timeline.landClose).toBe("2027-02");
  });

  it("starts a Davis County cash lot with nothing known about it", () => {
    const { lot, timeline } = newDealInputs("2026-10-30", defaults);
    expect(lot).toEqual({
      city: "",
      county: "Davis",
      region: "utah-north",
      acres: 0.25,
      priceCents: 0,
      closingCents: 0,
      financing: { kind: "cash" },
      utilities: { water: "unknown", sewer: "unknown", gas: "unknown", power: "unknown", secondaryWater: "unknown" },
      hoaMonthlyCents: 0,
      propertyTaxRate: DEFAULT_MARKET_SETTINGS.defaultTaxRate,
    });
    expect(timeline).toEqual({ landClose: "2026-11", preConMonths: 2, buildMonths: 9, listEarlyMonths: 0, closingDays: 35 });
  });

  it("uses the golden deal's loan, carry and selling terms", () => {
    const deal = newDealInputs("2026-10-30", defaults);
    expect(deal.loan).toEqual(golden.loan);
    expect(deal.carry).toEqual(golden.carry);
    expect(deal.selling).toEqual(golden.selling);
  });

  it("takes the rules and contingency from the company settings", () => {
    const rules = { minMarginOnSale: 0.2, minAnnualizedReturn: 0.3, minDownsideProfitCents: 500_000 };
    const deal = newDealInputs("2026-10-30", { rules, contingencyPct: 0.08 });
    expect(deal.rules).toEqual(rules);
    expect(deal.contingencyPct).toBe(0.08);
  });

  it("starts with the default scenarios and no overrides, bids or comp selections", () => {
    const deal = newDealInputs("2026-10-30", defaults);
    expect(deal.scenarioDefs).toEqual(DEFAULT_SCENARIO_DEFS);
    expect(deal.overrides).toEqual({});
    expect(deal.bids).toEqual([]);
    expect(deal.compSelections).toEqual({});
  });

  it("starts from a 2,000 sf upgraded rambler", () => {
    expect(newDealInputs("2026-10-30", defaults).house).toEqual({
      schemaVersion: 1,
      source: "described",
      style: "rambler",
      levels: {
        main: { finishedSf: 2000, unfinishedSf: 0, ceilingFt: 9 },
        basement: { totalSf: 2000, finishedSf: 0, walkout: false },
      },
      footprint: { widthFt: 50, depthFt: 40, complexity: "moderate" },
      garage: { bays: 3, tandem: false, rvBay: false },
      roof: { style: "hip", pitchPer12: 6 },
      rooms: { bedrooms: 4, fullBaths: 2, halfBaths: 1, fireplaces: 0 },
      exterior: { stonePct: 20, stuccoPct: 60, boardBattenPct: 20, fiberCementPct: 0 },
      finishes: { houseTier: "upgraded", overrides: {} },
      adu: { type: "none" },
      pool: { type: "none", spa: false, heated: false },
      outside: { coveredPatioSf: 300, flatworkSf: 1200, fenceLf: 200, landscapingTier: "standard" },
    });
  });

  it("returns a fresh deal each call, sharing nothing with the settings or an earlier deal", () => {
    const settings: CompanySettings = { rules: { ...DEFAULT_RULES }, contingencyPct: 0.05 };
    const a = newDealInputs("2026-10-30", settings);
    const b = newDealInputs("2026-10-30", settings);
    a.house.rooms.bedrooms = 9;
    a.lot.utilities.water = "available";
    a.rules.minMarginOnSale = 0.99;
    a.scenarioDefs.base.overrunPct = 0.5;
    a.bids.push({ code: "plans", amountCents: 1, vendor: "x", receivedOn: "2026-10-30" });
    expect(b.house.rooms.bedrooms).toBe(4);
    expect(b.lot.utilities.water).toBe("unknown");
    expect(settings.rules.minMarginOnSale).toBe(DEFAULT_RULES.minMarginOnSale);
    expect(DEFAULT_SCENARIO_DEFS.base.overrunPct).toBe(0);
    expect(b.bids).toEqual([]);
  });

  it("rejects a today that is not a calendar date", () => {
    expect(() => newDealInputs("soon", defaults)).toThrow(RangeError);
    expect(() => newDealInputs("2026-13-01", defaults)).toThrow(RangeError);
  });
});
