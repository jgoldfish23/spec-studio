import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbProFormaInput } from "./__fixtures__/arbitraries";
import { GOLDEN_EXPECTED, goldenProFormaInput } from "./__fixtures__/golden";
import { runCashFlow, type ProFormaInput } from "./cashflow";
import { breakEvenDomDays, computeMetrics, equityFlows, irrMonthly, type Metrics } from "./metrics";
import { roundCents } from "./money";

const metricsFor = (input: ProFormaInput): Metrics => computeMetrics(runCashFlow(input), input);
const profitFor = (input: ProFormaInput): number => metricsFor(input).profitCents;

describe("irrMonthly", () => {
  it("finds the monthly rate that discounts the flows to zero", () => {
    const r = irrMonthly([
      { t: 0, cents: -10_000 },
      { t: 12, cents: 11_000 },
    ]);
    expect(r).not.toBeNull();
    expect((1 + r!) ** 12 - 1).toBeCloseTo(0.1, 9);
  });

  it("finds a negative rate when the inflow is smaller than the outflow", () => {
    const r = irrMonthly([
      { t: 0, cents: -10_000 },
      { t: 6, cents: 9_000 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(0);
    expect(-10_000 + 9_000 / (1 + r!) ** 6).toBeCloseTo(0, 6);
  });

  it("is null when there is no positive flow", () => {
    expect(
      irrMonthly([
        { t: 0, cents: -10_000 },
        { t: 12, cents: -1 },
      ]),
    ).toBeNull();
  });

  it("is null when the flows never change sign", () => {
    expect(irrMonthly([])).toBeNull();
    expect(
      irrMonthly([
        { t: 0, cents: 10_000 },
        { t: 12, cents: 500 },
      ]),
    ).toBeNull();
  });

  it("is null when the rate would be outside −99% to 100% a month", () => {
    expect(
      irrMonthly([
        { t: 0, cents: -100 },
        { t: 1, cents: 300 },
      ]),
    ).toBeNull();
    expect(
      irrMonthly([
        { t: 0, cents: -1_000_000 },
        { t: 1, cents: 1 },
      ]),
    ).toBeNull();
  });
});

describe("equityFlows", () => {
  it("is one outflow per period (zeros included) and the equity return at the sale close", () => {
    const input = goldenProFormaInput("base");
    const cf = runCashFlow(input);
    const flows = equityFlows(cf);
    expect(flows).toHaveLength(cf.periods.length + 1);
    expect(flows.slice(0, -1).map((f) => f.t)).toEqual(cf.periods.map((p) => p.index));
    expect(flows.slice(0, -1).map((f) => f.cents)).toEqual(cf.periods.map((p) => 0 - p.equityOutCents));
    expect(flows.at(-1)).toEqual({ t: cf.times.saleClose, cents: cf.sale.equityReturnCents });
  });

  it("keeps zero outflows as +0", () => {
    const flows = equityFlows(runCashFlow(goldenProFormaInput("base")));
    expect(flows.every((f) => !Object.is(f.cents, -0))).toBe(true);
  });
});

describe("computeMetrics: golden deal", () => {
  describe.each(["base", "stress"] as const)("%s scenario", (name) => {
    const expected = GOLDEN_EXPECTED.scenarios[name];
    const input = goldenProFormaInput(name);
    const metrics = metricsFor(input);

    it("matches every metric of the spreadsheet exactly", () => {
      expect(metrics).toMatchObject(expected.metrics);
    });

    it("has no missing or NaN numbers", () => {
      for (const [key, value] of Object.entries(metrics)) {
        if (value !== null) expect(Number.isFinite(value), key).toBe(true);
      }
    });

    it("reports the sale price, the land-to-close time, and the margins", () => {
      expect(metrics.salePriceCents).toBe(expected.inputs.priceCents);
      expect(metrics.monthsLandToClose).toBe(runCashFlow(input).times.saleClose);
      expect(metrics.marginOnSale).toBe(metrics.profitCents / metrics.salePriceCents);
      expect(metrics.marginOnCost).toBe(metrics.profitCents / metrics.totalProjectCostCents);
      expect(metrics.returnOnCash).toBe(metrics.profitCents / metrics.peakCashCents);
    });
  });

  it("annualizes the return from the monthly IRR of the equity flows", () => {
    const base = metricsFor(goldenProFormaInput("base"));
    const r = irrMonthly(equityFlows(runCashFlow(goldenProFormaInput("base"))))!;
    expect(base.annualizedReturn).toBe((1 + r) ** 12 - 1);
    expect(base.annualizedReturn!).toBeGreaterThan(0);
    // The stress case loses money but still gets some equity back, so its return is a negative rate.
    expect(metricsFor(goldenProFormaInput("stress")).annualizedReturn!).toBeLessThan(0);
  });

  it("discounts the spreadsheet's base equity flows to zero at the engine's monthly IRR", () => {
    const r = irrMonthly(equityFlows(runCashFlow(goldenProFormaInput("base"))))!;
    const npv = GOLDEN_EXPECTED.scenarios.base.equityFlows.reduce((sum, f) => sum + f.cents / (1 + r) ** f.t, 0);
    expect(Math.abs(npv)).toBeLessThan(1);
  });

  it("reports a deep loss without a return and without NaN", () => {
    const m = metricsFor(goldenProFormaInput("base", { priceCents: 50_000_000 }));
    expect(m.profitCents).toBeLessThan(0);
    expect(m.annualizedReturn).toBeNull();
    for (const [key, value] of Object.entries(m)) {
      if (value !== null) expect(Number.isNaN(value), key).toBe(false);
    }
  });

  it("breaks even, within rounding, at the break-even sale price", () => {
    for (const name of ["base", "stress"] as const) {
      const input = goldenProFormaInput(name);
      const { breakEvenSalePriceCents } = metricsFor(input);
      const atBreakEven = profitFor({ ...input, salePriceCents: breakEvenSalePriceCents });
      expect(Math.abs(atBreakEven), name).toBeLessThanOrEqual(2);
    }
  });
});

describe("computeMetrics: variations on the golden deal", () => {
  it("has no max days without extension when there is no construction loan", () => {
    const noLoan = goldenProFormaInput("base");
    noLoan.loan = { ...noLoan.loan, ltc: 0 };
    expect(metricsFor(noLoan).maxDomWithoutExtension).toBeNull();
  });

  it("counts land-loan points and interest as financing and land-loan interest in the monthly burn", () => {
    const cash = goldenProFormaInput("base");
    const financed: ProFormaInput = { ...cash, landFinancing: { kind: "loan", ltv: 0.5, rate: 0.12, points: 0.02 } };
    const cf = runCashFlow(financed);
    const landLoan = 14_750_000; // half of the $295,000 lot
    expect(cf.landLoanCents).toBe(landLoan);
    const landInterest = cf.periods.reduce((sum, p) => sum + p.landLoanInterestCents, 0);
    expect(landInterest).toBeGreaterThan(0);

    // Land financing leaves the construction loan alone, so only the land-loan terms change.
    const before = metricsFor(cash);
    const after = computeMetrics(cf, financed);
    expect(after.financingCents - before.financingCents).toBe(roundCents(0.02 * landLoan) + landInterest);
    expect(after.monthlyBurnWhileListedCents - before.monthlyBurnWhileListedCents).toBe(
      roundCents((landLoan * 0.12) / 12),
    );
  });
});

describe("breakEvenDomDays", () => {
  it("is the first day count at which the golden base deal no longer makes a profit", () => {
    const input = goldenProFormaInput("base");
    const d = breakEvenDomDays(input);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(GOLDEN_EXPECTED.scenarios.base.inputs.domDays);
    expect(profitFor({ ...input, domDays: d! })).toBeLessThanOrEqual(0);
    expect(profitFor({ ...input, domDays: d! - 1 })).toBeGreaterThan(0);
  });

  it("is 0 when the deal already loses money with no days on market", () => {
    expect(breakEvenDomDays(goldenProFormaInput("base", { priceCents: 50_000_000 }))).toBe(0);
  });

  it("is null when the deal still profits after three years on market", () => {
    expect(breakEvenDomDays(goldenProFormaInput("base", { priceCents: 1_000_000_000 }))).toBeNull();
  });
});

describe("extension boundary", () => {
  it("adds the first loan extension at 57 days on the golden base deal (max without extension is 56)", () => {
    const at = (domDays: number) => runCashFlow(goldenProFormaInput("base", { domDays }));
    expect(at(56).times.saleClose).toBeCloseTo(13.992, 3);
    expect(at(57).times.saleClose).toBeCloseTo(14.025, 3);
    expect(at(56).times.saleClose).toBeLessThanOrEqual(at(56).times.maturity);
    expect(at(56).extensions).toBe(0);
    expect(at(57).extensions).toBe(1);
    expect(metricsFor(goldenProFormaInput("base")).maxDomWithoutExtension).toBe(56);
  });

  const golden = goldenProFormaInput("base");
  /** The golden deal on a different timeline and loan term. */
  const timed = (t: { pre: number; build: number; listEarly: number; closing: number; term: number }) => ({
    ...golden,
    preConMonths: t.pre,
    buildMonths: t.build,
    listEarlyMonths: t.listEarly,
    closingDays: t.closing,
    loan: { ...golden.loan, termMonths: t.term },
  });

  it("does not extend at the reported max days on market when the sale closes exactly at a whole-month maturity", () => {
    // List at month 5, maturity at month 17: (17 − 5) × 365/12 − 13 = 352 days lands the close on month 17,
    // which floating point puts at 17.000000000000004 unless the cash flow snaps it.
    const input = timed({ pre: 0, build: 5, listEarly: 0, closing: 13, term: 17 });
    expect(metricsFor(input).maxDomWithoutExtension).toBe(352);

    const atMax = runCashFlow({ ...input, domDays: 352 });
    expect(atMax.commitmentCents).toBeGreaterThan(0);
    expect(atMax.times.maturity).toBe(17);
    expect(atMax.times.saleClose).toBe(17);
    expect(atMax.extensions).toBe(0);
    expect(atMax.periods).toHaveLength(Math.ceil(atMax.times.saleClose));
    expect(atMax.periods.every((p) => p.extensionFeeCents === 0)).toBe(true);

    expect(runCashFlow({ ...input, domDays: 353 }).extensions).toBe(1);
  });

  it("extends one day past the reported max days on market and not at it, for loans maturing a year or two after listing", () => {
    const timing = fc
      .record({
        pre: fc.integer({ min: 0, max: 4 }),
        build: fc.integer({ min: 4, max: 18 }),
        closing: fc.integer({ min: 0, max: 90 }),
        yearsAfterList: fc.constantFrom(1, 2),
      })
      .chain((t) =>
        fc.integer({ min: 0, max: Math.min(2, t.build) }).map((listEarly) => ({
          ...t,
          listEarly,
          term: t.build - listEarly + 12 * t.yearsAfterList,
        })),
      );
    fc.assert(
      fc.property(timing, (t) => {
        const input = timed(t);
        const max = metricsFor(input).maxDomWithoutExtension;
        expect(max).not.toBeNull();
        expect(runCashFlow({ ...input, domDays: max! }).extensions).toBe(0);
        expect(runCashFlow({ ...input, domDays: max! + 1 }).extensions).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});

describe("metrics: properties", () => {
  it("profit never rises as days on market rise", () => {
    fc.assert(
      fc.property(arbProFormaInput(), fc.integer({ min: 0, max: 400 }), (p, extraDays) => {
        const longer = profitFor({ ...p, domDays: p.domDays + extraDays });
        expect(longer).toBeLessThanOrEqual(profitFor(p));
      }),
    );
  });

  it("profit never falls as the sale price rises (in whole dollars, so cent rounding of fees cannot reverse it)", () => {
    fc.assert(
      fc.property(arbProFormaInput(), fc.integer({ min: 1, max: 100_000 }), (p, extraDollars) => {
        const higher = profitFor({ ...p, salePriceCents: p.salePriceCents + extraDollars * 100 });
        expect(higher).toBeGreaterThanOrEqual(profitFor(p));
      }),
    );
  });

  it("the equity flows add up to the profit", () => {
    fc.assert(
      fc.property(arbProFormaInput(), (p) => {
        const cf = runCashFlow(p);
        const total = equityFlows(cf).reduce((sum, f) => sum + f.cents, 0);
        expect(total).toBe(computeMetrics(cf, p).profitCents);
      }),
    );
  });
});
