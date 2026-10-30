import { describe, expect, it } from "vitest";
import { SAMPLE_HOUSE, SAMPLE_LOT } from "./__fixtures__/sampleHouse";
import {
  DEFAULT_RULES,
  DEFAULT_SCENARIO_DEFS,
  DealInputsSchema,
  listYearMonth,
  validateDeal,
  type DealInputs,
  type Timeline,
} from "./deal";

const validDeal = (): DealInputs => ({
  lot: structuredClone(SAMPLE_LOT),
  house: structuredClone(SAMPLE_HOUSE),
  timeline: { landClose: "2027-06", preConMonths: 2, buildMonths: 9, listEarlyMonths: 0, closingDays: 35 },
  loan: {
    ltc: 0.8,
    rate: 0.095,
    points: 0.01,
    drawFeeCents: 25_000,
    termMonths: 12,
    extensionPct: 0.005,
    extensionMonths: 3,
    interestMode: "paid",
  },
  carry: {
    insuranceRate: 0.004,
    utilitiesBuildMonthlyCents: 15_000,
    utilitiesAfterMonthlyCents: 30_000,
    stagingMonthlyCents: 100_000,
    upkeepMonthlyCents: 20_000,
  },
  selling: { listingPct: 0.025, buyerPct: 0.025, closingPct: 0.005, concessionsCents: 500_000 },
  rules: { ...DEFAULT_RULES },
  scenarioDefs: structuredClone(DEFAULT_SCENARIO_DEFS),
  contingencyPct: 0.05,
  overrides: {},
  bids: [],
  compSelections: {},
});

const paths = (d: unknown): string[] => validateDeal(d).map((i) => i.path);

describe("validateDeal", () => {
  it("accepts a complete valid deal", () => {
    expect(validateDeal(validDeal())).toEqual([]);
  });

  it("accepts optional fields, a financed lot, bids and comp selections", () => {
    const d = validDeal();
    d.lot.frontageFt = 90;
    d.lot.financing = { kind: "loan", ltv: 0.65, rate: 0.085, points: 0.01 };
    d.overrides = { basePriceCents: 125_000_000, baseDomDays: 45 };
    d.plannedListPriceCents = 130_000_000;
    d.bids = [
      { code: "framing", amountCents: 6_500_000, vendor: "Wasatch Framing", receivedOn: "2027-02-14", notes: "incl. lumber" },
    ];
    d.compSelections = { "comp-1": true, "comp-2": false };
    expect(validateDeal(d)).toEqual([]);
  });

  it("rejects zero build months", () => {
    const d = validDeal();
    d.timeline.buildMonths = 0;
    expect(paths(d)).toContain("timeline.buildMonths");
  });

  it("rejects listing earlier than the build is long", () => {
    const d = validDeal();
    d.timeline.listEarlyMonths = 10;
    expect(paths(d)).toContain("timeline.listEarlyMonths");
  });

  it("accepts listing as early as the whole build", () => {
    const d = validDeal();
    d.timeline.listEarlyMonths = 9;
    expect(validateDeal(d)).toEqual([]);
  });

  it("rejects a negative list-early value", () => {
    const d = validDeal();
    d.timeline.listEarlyMonths = -1;
    expect(paths(d)).toContain("timeline.listEarlyMonths");
  });

  it("rejects a loan-to-cost above the limit", () => {
    const d = validDeal();
    d.loan.ltc = 1.2;
    expect(paths(d)).toContain("loan.ltc");
  });

  it("reports a single issue per bad value, even for fields with a tighter range", () => {
    const d = validDeal();
    d.loan.ltc = 1.2;
    d.timeline.buildMonths = -1;
    d.timeline.listEarlyMonths = 0;
    expect(paths(d).sort()).toEqual(["loan.ltc", "timeline.buildMonths"]);
  });

  it("accepts a loan-to-cost of exactly 0.95 and rejects just above it", () => {
    const d = validDeal();
    d.loan.ltc = 0.95;
    expect(validateDeal(d)).toEqual([]);
    d.loan.ltc = 0.9501;
    expect(paths(d)).toContain("loan.ltc");
  });

  it("requires at least one extension month, reporting zero as a single issue", () => {
    const d = validDeal();
    d.loan.extensionMonths = 1;
    expect(validateDeal(d)).toEqual([]);
    d.loan.extensionMonths = 0;
    expect(paths(d)).toEqual(["loan.extensionMonths"]);
  });

  it("rejects non-integer month counts", () => {
    const d = validDeal();
    d.timeline.preConMonths = 1.5;
    d.timeline.buildMonths = 8.5;
    d.loan.termMonths = 12.5;
    expect(paths(d)).toEqual(
      expect.arrayContaining(["timeline.preConMonths", "timeline.buildMonths", "loan.termMonths"]),
    );
  });

  it("rejects rates outside 0 to 1", () => {
    const d = validDeal();
    d.lot.propertyTaxRate = 5;
    d.loan.rate = -0.01;
    d.selling.listingPct = 2.5;
    d.contingencyPct = 1.5;
    expect(paths(d)).toEqual(
      expect.arrayContaining(["lot.propertyTaxRate", "loan.rate", "selling.listingPct", "contingencyPct"]),
    );
  });

  it("rejects fractional and negative cent amounts", () => {
    const d = validDeal();
    d.lot.priceCents = 29_500_000.5;
    d.lot.closingCents = -1;
    d.selling.concessionsCents = 99.9;
    expect(paths(d)).toEqual(
      expect.arrayContaining(["lot.priceCents", "lot.closingCents", "selling.concessionsCents"]),
    );
  });

  it("rejects malformed land-close months", () => {
    for (const bad of ["2027-13", "2027-6", "June 2027", "2027-06-01", ""]) {
      const d = validDeal();
      d.timeline.landClose = bad;
      expect(paths(d)).toContain("timeline.landClose");
    }
  });

  it("rejects an unknown financing kind and incomplete loan financing", () => {
    const d: Record<string, unknown> = structuredClone(validDeal());
    (d.lot as Record<string, unknown>).financing = { kind: "loan", ltv: 0.65 };
    expect(paths(d)).toEqual(expect.arrayContaining(["lot.financing.rate", "lot.financing.points"]));
    (d.lot as Record<string, unknown>).financing = { kind: "barter" };
    expect(paths(d)).toContain("lot.financing.kind");
  });

  it("rejects a utilities record that omits a utility or uses an unknown status", () => {
    const d = validDeal();
    const utilities: Record<string, unknown> = { ...d.lot.utilities };
    delete utilities.gas;
    utilities.power = "maybe";
    (d.lot as { utilities: unknown }).utilities = utilities;
    expect(paths(d)).toEqual(expect.arrayContaining(["lot.utilities.gas", "lot.utilities.power"]));
  });

  it("rejects bids with a bad date, negative amount or empty vendor", () => {
    const d = validDeal();
    d.bids = [{ code: "framing", amountCents: -5, vendor: "", receivedOn: "2027-02-30" }];
    expect(paths(d)).toEqual(
      expect.arrayContaining(["bids.0.amountCents", "bids.0.vendor", "bids.0.receivedOn"]),
    );
  });

  it("requires bid dates in 1900 or later, reporting an earlier one as a single issue", () => {
    // "0026-10-12" is what a browser date input stores for a two-digit year.
    for (const receivedOn of ["0026-10-12", "0000-01-01", "1899-12-31", "0026-02-30"]) {
      const d = validDeal();
      d.bids = [{ code: "framing", amountCents: 6_500_000, vendor: "Wasatch Framing", receivedOn }];
      expect(paths(d), receivedOn).toEqual(["bids.0.receivedOn"]);
    }
    const d = validDeal();
    d.bids = [{ code: "framing", amountCents: 6_500_000, vendor: "Wasatch Framing", receivedOn: "1900-01-01" }];
    expect(validateDeal(d)).toEqual([]);
  });

  it("requires the land-close month in 1900 or later, reporting an earlier one as a single issue", () => {
    for (const landClose of ["0026-10", "0000-01", "1899-12", "0026-13"]) {
      const d = validDeal();
      d.timeline.landClose = landClose;
      expect(paths(d), landClose).toEqual(["timeline.landClose"]);
    }
    const d = validDeal();
    d.timeline.landClose = "1900-01";
    expect(validateDeal(d)).toEqual([]);
  });

  it("rejects invalid scenario sources", () => {
    const d: Record<string, unknown> = structuredClone(validDeal());
    (d.scenarioDefs as { base: Record<string, unknown> }).base.priceSource = "median";
    expect(paths(d)).toContain("scenarioDefs.base.priceSource");
  });

  it("rejects non-object input", () => {
    expect(validateDeal(null)).not.toEqual([]);
    expect(validateDeal("deal")).not.toEqual([]);
  });

  it("reports house problems with a house. prefix", () => {
    const d = validDeal();
    d.house.levels.basement!.finishedSf = 2300;
    expect(paths(d)).toEqual(["house.levels.basement.finishedSf"]);
  });

  it("reports house schema problems with a house. prefix, once", () => {
    const d = validDeal();
    d.house.rooms.bedrooms = -1;
    expect(paths(d)).toEqual(["house.rooms.bedrooms"]);
  });

  it("reports deal and house problems together", () => {
    const d = validDeal();
    d.timeline.buildMonths = 0;
    d.house.exterior.stonePct = 0;
    expect(paths(d)).toEqual(expect.arrayContaining(["timeline.buildMonths", "house.exterior"]));
  });

  it("reports a missing house", () => {
    const d: Record<string, unknown> = structuredClone(validDeal());
    delete d.house;
    expect(paths(d)).toEqual(["house"]);
  });
});

describe("DealInputsSchema", () => {
  it("parses a valid deal to an equal value", () => {
    const d = validDeal();
    expect(DealInputsSchema.parse(d)).toEqual(d);
  });
});

describe("defaults", () => {
  it("DEFAULT_RULES holds the standard investment hurdles", () => {
    expect(DEFAULT_RULES).toEqual({ minMarginOnSale: 0.15, minAnnualizedReturn: 0.25, minDownsideProfitCents: 0 });
  });

  it("DEFAULT_SCENARIO_DEFS pairs each scenario with its price and days-on-market source", () => {
    expect(DEFAULT_SCENARIO_DEFS).toEqual({
      downside: { priceSource: "low", domSource: "high", overrunPct: 0.05 },
      base: { priceSource: "mid", domSource: "typical", overrunPct: 0 },
      upside: { priceSource: "high", domSource: "low", overrunPct: 0 },
    });
  });
});

describe("listYearMonth", () => {
  const timeline = (over: Partial<Timeline>): Timeline => ({
    landClose: "2027-06",
    preConMonths: 2,
    buildMonths: 9,
    listEarlyMonths: 0,
    closingDays: 35,
    ...over,
  });

  it("is land close plus pre-construction plus build", () => {
    expect(listYearMonth(timeline({}))).toBe("2028-05");
  });

  it("moves earlier by the list-early months", () => {
    expect(listYearMonth(timeline({ listEarlyMonths: 2 }))).toBe("2028-03");
  });

  it("crosses a year boundary", () => {
    expect(listYearMonth(timeline({ landClose: "2027-11", preConMonths: 1, buildMonths: 3 }))).toBe("2028-03");
  });
});
