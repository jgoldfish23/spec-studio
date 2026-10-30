import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbProFormaInput } from "./__fixtures__/arbitraries";
import { GOLDEN_DEAL, GOLDEN_EXPECTED } from "./__fixtures__/golden";
import { buildProFormaInput, drawWeights, runCashFlow, type Period, type ProFormaInput } from "./cashflow";
import type { DealInputs } from "./deal";
import { buildEstimate, type EstimateContext } from "./estimate";
import { roundCents } from "./money";
import { computeQuantities, DEFAULT_QUANTITY_RULES } from "./quantities";
import { isOk, type Result } from "./result";

function unwrap<T>(r: Result<T>): T {
  if (!isOk(r)) throw new Error(`expected ok, got incomplete: ${JSON.stringify(r.missing)}`);
  return r.value;
}

/** Hand-case input: every field 0, cash, or "paid" unless overridden. */
const input = (overrides: Partial<ProFormaInput> = {}): ProFormaInput => ({
  landPriceCents: 0,
  landClosingCents: 0,
  landFinancing: { kind: "cash" },
  preConMonths: 0,
  buildMonths: 1,
  listEarlyMonths: 0,
  closingDays: 0,
  softCents: 0,
  hardCents: 0,
  estimateTotalCents: 0,
  overrunPct: 0,
  // extensionMonths must be at least 1 (deal schema); with no extension fee it changes nothing.
  loan: {
    ltc: 0,
    rate: 0,
    points: 0,
    drawFeeCents: 0,
    termMonths: 0,
    extensionPct: 0,
    extensionMonths: 1,
    interestMode: "paid",
  },
  carry: {
    insuranceRate: 0,
    utilitiesBuildMonthlyCents: 0,
    utilitiesAfterMonthlyCents: 0,
    stagingMonthlyCents: 0,
    upkeepMonthlyCents: 0,
  },
  taxRate: 0,
  hoaMonthlyCents: 0,
  selling: { listingPct: 0, buyerPct: 0, closingPct: 0, concessionsCents: 0 },
  salePriceCents: 0,
  domDays: 0,
  ...overrides,
});

/** Hard cost only: the estimate total is the hard cost. */
const hardOnly = (cents: number) => ({ softCents: 0, hardCents: cents, estimateTotalCents: cents });

const column = (periods: Period[], field: keyof Period): number[] => periods.map((p) => p[field]);
const total = (periods: Period[], field: keyof Period): number => periods.reduce((s, p) => s + p[field], 0);

/** Hard 100,000,000 over 2 build months, 80% LTC at 12% with 1 point, 30 days on market. */
const loanCase = (overrides: Partial<ProFormaInput> = {}, loan: Partial<ProFormaInput["loan"]> = {}) => {
  const base = input({ ...hardOnly(100_000_000), buildMonths: 2, domDays: 30, closingDays: 0 });
  return { ...base, ...overrides, loan: { ...base.loan, ltc: 0.8, rate: 0.12, points: 0.01, ...loan } };
};

describe("drawWeights", () => {
  it("follows a sine curve over the build and sums to 1", () => {
    const w = drawWeights(9);
    expect(w).toHaveLength(9);
    expect(w[0]).toBeCloseTo(0.03015369, 8);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

describe("runCashFlow: hand cases", () => {
  it("draws the hard cost on the weights, the last draw taking the remainder", () => {
    const cf = runCashFlow(input({ ...hardOnly(90_000_000), buildMonths: 9 }));
    expect(cf.periods[0]?.spendCents).toBe(2_713_832);
    expect(total(cf.periods, "spendCents")).toBe(90_000_000);
  });

  it("funds equity first, then the loan, with points at build start and interest on the drawn balance", () => {
    const cf = runCashFlow(loanCase());
    expect(cf.periods).toHaveLength(3);
    expect(column(cf.periods, "index")).toEqual([0, 1, 2]);
    expect(column(cf.periods, "pointsCents")).toEqual([800_000, 0, 0]);
    expect(cf.periods[0]).toMatchObject({ equitySpendCents: 20_000_000, loanDrawCents: 30_000_000 });
    expect(cf.periods[1]).toMatchObject({ equitySpendCents: 0, loanDrawCents: 50_000_000 });
    expect(column(cf.periods, "interestCents")).toEqual([0, 300_000, 789_041]);
    expect(column(cf.periods, "loanBalanceEndCents")).toEqual([30_000_000, 80_000_000, 80_000_000]);
    expect(column(cf.periods, "equityOutCents")).toEqual([20_800_000, 300_000, 789_041]);
    expect(column(cf.periods, "cumulativeEquityCents")).toEqual([20_800_000, 21_100_000, 21_889_041]);
    expect(cf.commitmentCents).toBe(80_000_000);
    expect(cf.loanDrawnCents).toBe(80_000_000);
    expect(cf.capitalizedInterestCents).toBe(0);
  });

  it("charges an extension fee when the sale closes after the loan matures", () => {
    const cf = runCashFlow(loanCase({}, { termMonths: 2, extensionPct: 0.005, extensionMonths: 3 }));
    expect(cf.times.maturity).toBe(2);
    expect(cf.extensions).toBe(1);
    expect(column(cf.periods, "extensionFeeCents")).toEqual([0, 0, 400_000]);
  });

  it("charges a draw fee in each period the loan funds", () => {
    const cf = runCashFlow(loanCase({}, { drawFeeCents: 25_000 }));
    expect(column(cf.periods, "drawFeeCents")).toEqual([25_000, 25_000, 0]);
  });

  it("adds capitalized interest to the balance instead of charging equity", () => {
    const cf = runCashFlow(loanCase({}, { interestMode: "capitalized" }));
    expect(column(cf.periods, "interestCents")).toEqual([0, 300_000, 792_000]);
    expect(column(cf.periods, "loanBalanceEndCents")).toEqual([30_000_000, 80_300_000, 81_092_000]);
    expect(column(cf.periods, "equityOutCents")).toEqual([20_800_000, 0, 0]);
    expect(cf.capitalizedInterestCents).toBe(1_092_000);
    expect(cf.sale.loanPayoffCents).toBe(81_092_000);
  });

  it("finances the land: equity buys the rest plus closing and points, interest runs to sale, the sale repays it", () => {
    const cf = runCashFlow(
      loanCase({
        landPriceCents: 10_000_000,
        landClosingCents: 300_000,
        landFinancing: { kind: "loan", ltv: 0.7, rate: 0.12, points: 0.02 },
        salePriceCents: 120_000_000,
        selling: { listingPct: 0.025, buyerPct: 0.025, closingPct: 0.01, concessionsCents: 500_000 },
      }),
    );
    expect(cf.landLoanCents).toBe(7_000_000);
    expect(column(cf.periods, "landLoanInterestCents")).toEqual([70_000, 70_000, 69_041]);
    // Land points sit in the land purchase, not in pointsCents (construction points only).
    expect(column(cf.periods, "pointsCents")).toEqual([800_000, 0, 0]);
    expect(cf.periods[0]?.equityOutCents).toBe(3_440_000 + 20_000_000 + 800_000 + 70_000);
    expect(cf.sale).toEqual({
      priceCents: 120_000_000,
      commissionsCents: 6_000_000,
      closingCents: 1_200_000,
      concessionsCents: 500_000,
      netCents: 112_300_000,
      loanPayoffCents: 87_000_000,
      equityReturnCents: 25_300_000,
    });
  });

  it("charges each carry cost over its own window and adds it all to equity out", () => {
    // Build start 1, completion 3, list 2, contract = sale close = 4.4 (73 days = 2.4 months).
    const cf = runCashFlow(
      input({
        landPriceCents: 20_000_000,
        landClosingCents: 300_000,
        preConMonths: 1,
        buildMonths: 2,
        listEarlyMonths: 1,
        domDays: 73,
        softCents: 2_000_000,
        hardCents: 98_000_000,
        estimateTotalCents: 100_000_000,
        taxRate: 0.012,
        hoaMonthlyCents: 10_000,
        carry: {
          insuranceRate: 0.0036,
          utilitiesBuildMonthlyCents: 15_000,
          utilitiesAfterMonthlyCents: 25_000,
          stagingMonthlyCents: 50_000,
          upkeepMonthlyCents: 10_000,
        },
      }),
    );
    expect(cf.times.saleClose).toBeCloseTo(4.4, 12);
    expect(column(cf.periods, "spendCents")).toEqual([2_000_000, 49_000_000, 49_000_000, 0, 0]);
    expect(column(cf.periods, "taxCents")).toEqual([22_000, 71_000, 120_000, 120_000, 48_000]);
    expect(column(cf.periods, "insuranceCents")).toEqual([0, 30_000, 30_000, 30_000, 12_000]);
    expect(column(cf.periods, "utilitiesCents")).toEqual([0, 15_000, 15_000, 25_000, 10_000]);
    expect(column(cf.periods, "stagingCents")).toEqual([0, 0, 50_000, 50_000, 20_000]);
    expect(column(cf.periods, "upkeepCents")).toEqual([0, 0, 0, 10_000, 4_000]);
    expect(column(cf.periods, "hoaCents")).toEqual([10_000, 10_000, 10_000, 10_000, 4_000]);
    expect(column(cf.periods, "equityOutCents")).toEqual([22_332_000, 49_126_000, 49_225_000, 245_000, 98_000]);
  });

  it("never closes the sale before completion, even when listed early and sold fast", () => {
    const cf = runCashFlow(input({ buildMonths: 3, listEarlyMonths: 2, domDays: 10, closingDays: 10 }));
    expect(cf.times.list).toBe(1);
    expect(cf.times.saleClose).toBe(3);
    expect(cf.periods).toHaveLength(3);
  });

  it("charges no loan costs on an all-cash deal that runs past the loan term", () => {
    const cf = runCashFlow(
      loanCase({ domDays: 200 }, { ltc: 0, termMonths: 1, drawFeeCents: 25_000, extensionPct: 0.005 }),
    );
    expect(cf.times.saleClose).toBeGreaterThan(cf.times.maturity);
    expect(cf.commitmentCents).toBe(0);
    expect(cf.extensions).toBe(0);
    for (const field of ["pointsCents", "drawFeeCents", "interestCents", "extensionFeeCents", "loanDrawCents"] as const) {
      expect(column(cf.periods, field).every((c) => c === 0)).toBe(true);
    }
    expect(total(cf.periods, "equitySpendCents")).toBe(100_000_000);
  });
});

describe("buildProFormaInput", () => {
  it("splits soft from hard, takes tax and HOA from the lot, and copies the deal's terms", () => {
    const deal: DealInputs = {
      ...GOLDEN_DEAL,
      lot: {
        ...GOLDEN_DEAL.lot,
        hoaMonthlyCents: 12_500,
        financing: { kind: "loan", ltv: 0.6, rate: 0.1, points: 0.01 },
      },
    };
    const p = buildProFormaInput(deal, goldenEstimate(), { priceCents: 135_000_000, domDays: 62, overrunPct: 0.05 });
    expect(p).toEqual({
      landPriceCents: 29_500_000,
      landClosingCents: 400_000,
      landFinancing: { kind: "loan", ltv: 0.6, rate: 0.1, points: 0.01 },
      preConMonths: 2,
      buildMonths: 9,
      listEarlyMonths: 0,
      closingDays: 35,
      softCents: 3_850_000,
      hardCents: 69_749_750,
      estimateTotalCents: 73_599_750,
      overrunPct: 0.05,
      loan: GOLDEN_DEAL.loan,
      carry: GOLDEN_DEAL.carry,
      taxRate: 0.0048,
      hoaMonthlyCents: 12_500,
      selling: GOLDEN_DEAL.selling,
      salePriceCents: 135_000_000,
      domDays: 62,
    });
    expect(p.loan).not.toBe(deal.loan);
  });
});

function goldenEstimate() {
  const goldenQ = unwrap(computeQuantities(GOLDEN_DEAL.house, GOLDEN_DEAL.lot, DEFAULT_QUANTITY_RULES));
  const goldenCtx: EstimateContext = { region: "utah-north", contingencyPct: 0.05, buildMonths: 9, today: "2026-10-30" };
  return unwrap(buildEstimate(goldenQ, GOLDEN_DEAL.house, { defaults: [], priceBook: [] }, GOLDEN_DEAL.bids, goldenCtx));
}

describe("runCashFlow: golden deal", () => {
  const est = goldenEstimate();

  it("prices the golden estimate from bids alone", () => {
    expect(est.totalCents).toBe(73_599_750);
  });

  describe.each(["base", "stress"] as const)("%s scenario", (name) => {
    const expected = GOLDEN_EXPECTED.scenarios[name];
    const cf = runCashFlow(buildProFormaInput(GOLDEN_DEAL, est, expected.inputs));

    it("matches the spreadsheet's times and extension count", () => {
      for (const [key, value] of Object.entries(expected.times)) {
        expect(cf.times[key as keyof typeof expected.times], key).toBeCloseTo(value, 9);
      }
      expect(cf.extensions).toBe(expected.extensions);
    });

    it("matches every period field of the spreadsheet exactly", () => {
      expect(cf.periods).toMatchObject(expected.periods);
    });

    it("matches the spreadsheet's sale exactly", () => {
      expect(cf.sale).toEqual({
        ...expected.sale,
        priceCents: expected.inputs.priceCents,
        concessionsCents: GOLDEN_DEAL.selling.concessionsCents,
      });
    });

    it("tracks the loan balance and cumulative equity out", () => {
      expect(cf.commitmentCents).toBe(58_879_800);
      expect(cf.loanDrawnCents).toBe(expected.sale.loanPayoffCents);
      expect(cf.periods.at(-1)?.loanBalanceEndCents).toBe(expected.sale.loanPayoffCents);
      expect(Math.max(...column(cf.periods, "cumulativeEquityCents"))).toBe(expected.metrics.peakCashCents);
    });
  });
});

describe("runCashFlow: properties", () => {
  it("funds every cent spent from equity or the loan, and spends exactly the overrun-adjusted costs", () => {
    fc.assert(
      fc.property(arbProFormaInput(), (p) => {
        const cf = runCashFlow(p);
        const spend = total(cf.periods, "spendCents");
        expect(total(cf.periods, "equitySpendCents") + total(cf.periods, "loanDrawCents")).toBe(spend);
        const softActual = roundCents(p.softCents * (1 + p.overrunPct));
        const hardActual = roundCents(p.hardCents * (1 + p.overrunPct));
        expect(spend).toBe(softActual + hardActual);
      }),
    );
  });
});
