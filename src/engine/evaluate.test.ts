import { describe, expect, it } from "vitest";
import { uniformBookFor } from "./__fixtures__/books";
import { GOLDEN_COMPS, GOLDEN_DEAL, GOLDEN_EXPECTED, goldenEstimate, goldenProFormaInput } from "./__fixtures__/golden";
import { linePartsFor } from "./costbook";
import type { DealInputs } from "./deal";
import { evaluateDeal, type DealEvaluation, type EngineContext } from "./evaluate";
import * as engine from "./index";
import { DEFAULT_MARKET_SETTINGS } from "./market";
import { breakEvenDomDays, type Metrics } from "./metrics";
import { roundCents } from "./money";
import { computeQuantities, DEFAULT_QUANTITY_RULES } from "./quantities";
import type { MissingItem, Result } from "./result";
import { sensitivityGrid } from "./scenarios";

const CTX: EngineContext = {
  today: "2026-10-30",
  costBook: { defaults: [], priceBook: [] },
  comps: GOLDEN_COMPS,
  marketSettings: DEFAULT_MARKET_SETTINGS,
  quantityRules: DEFAULT_QUANTITY_RULES,
};

/** The value of an ok result; fails the test on anything else. */
function unwrap<T>(r: Result<T>): T {
  if (r.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

/** The missing items of an incomplete result; fails the test on anything else. */
function missingOf<T>(r: Result<T>): MissingItem[] {
  if (r.status !== "incomplete") throw new Error(`expected incomplete, got status ${r.status}`);
  return r.missing;
}

let goldenCache: DealEvaluation | undefined;
/** The golden deal evaluated once and shared: it is pure, so every test sees the same result. */
const golden = (): DealEvaluation => (goldenCache ??= evaluateDeal(GOLDEN_DEAL, CTX));

const withLotPrice = (priceCents: number): DealInputs => ({ ...GOLDEN_DEAL, lot: { ...GOLDEN_DEAL.lot, priceCents } });

/** Every step after validation is incomplete and nothing downstream was computed. */
function expectBlocked(ev: DealEvaluation): void {
  expect(ev.verdict.kind).toBe("incomplete");
  expect(ev.verdict.checks).toEqual([]);
  expect(ev.scenarios.status).toBe("incomplete");
  expect(ev.grid).toBeNull();
  expect(ev.goalSeek).toBeNull();
  expect(ev.breakEvenDomDays).toBeNull();
}

describe("evaluateDeal on the golden deal", () => {
  it("runs the whole pipeline and matches the golden estimate and base scenario", () => {
    const ev = golden();
    expect(ev.validation).toEqual([]);
    expect(unwrap(ev.quantities).finishedSf.value).toBe(3_800);
    expect(unwrap(ev.estimate).totalCents).toBe(73_599_750);
    expect(ev.price.status).toBe("ok");
    expect(ev.dom.status).toBe("ok");

    const expected = GOLDEN_EXPECTED.scenarios.base.metrics;
    const base = unwrap(ev.scenarios).base;
    expect(base.inputs).toEqual(GOLDEN_EXPECTED.scenarios.base.inputs);
    const picked = Object.fromEntries(Object.keys(expected).map((k) => [k, base.metrics[k as keyof Metrics]]));
    expect(picked).toEqual(expected);

    expect(ev.verdict.kind).not.toBe("incomplete");
    expect(ev.verdict.checks).toHaveLength(3);
    expect(ev.grid).toHaveLength(5);
    for (const row of ev.grid ?? []) expect(row).toHaveLength(5);
    expect(ev.grid).toEqual(sensitivityGrid(GOLDEN_DEAL, goldenEstimate(), GOLDEN_EXPECTED.scenarios.base.inputs));
    expect(ev.breakEvenDomDays).not.toBeNull();
    expect(ev.breakEvenDomDays).toBe(breakEvenDomDays(goldenProFormaInput("base")));
  });

  it("estimates days on market for a May listing (land closes 2027-06, then 2 + 9 months)", () => {
    const dom = unwrap(golden().dom);
    expect(dom.factors.seasonal).toBe(DEFAULT_MARKET_SETTINGS.seasonalFactors[4]);
    // No planned list price, so the price position does not slow the sale.
    expect(dom.factors.pricePosition).toBe(1);
  });

  it("keeps the market's price and days-on-market results even though the overrides drive the scenarios", () => {
    const ev = golden();
    const price = unwrap(ev.price);
    const dom = unwrap(ev.dom);
    const scenarios = unwrap(ev.scenarios);
    // The overrides re-centre the market range: base is the override, the others keep the market's proportions.
    expect(scenarios.base.inputs.priceCents).toBe(135_000_000);
    expect(scenarios.downside.inputs.priceCents).toBe(roundCents((135_000_000 * price.lowCents) / price.midCents));
    expect(scenarios.upside.inputs.priceCents).toBe(roundCents((135_000_000 * price.highCents) / price.midCents));
    expect(scenarios.downside.inputs.domDays).toBe(roundCents((62 * dom.highDays) / dom.typicalDays));
    expect(scenarios.upside.inputs.domDays).toBe(roundCents((62 * dom.lowDays) / dom.typicalDays));
  });

  it("is marginal on the margin rule alone, so goal seek reports all three levers", () => {
    const ev = golden();
    expect(ev.verdict.kind).not.toBe("go");
    expect(ev.verdict.kind).toBe("marginal");
    expect(ev.verdict.checks.map((c) => [c.rule, c.pass])).toEqual([
      ["marginOnSale", false],
      ["annualizedReturn", true],
      ["downsideProfit", true],
    ]);
    const { profitCents } = GOLDEN_EXPECTED.scenarios.base.metrics;
    expect(ev.verdict.checks[0]?.actual).toBe(profitCents / 135_000_000);
    expect(ev.goalSeek?.map((r) => r.lever)).toEqual(["lotPrice", "salePrice", "buildCost"]);
  });

  it("finds a lot price that makes it a go, where $100 more does not", () => {
    const lot = golden().goalSeek?.find((r) => r.lever === "lotPrice");
    expect(lot?.reachable).toBe(true);
    if (lot?.reachable && lot.valueCents !== undefined) {
      expect(lot.valueCents).toBeLessThan(GOLDEN_DEAL.lot.priceCents);
      expect(evaluateDeal(withLotPrice(lot.valueCents), CTX).verdict.kind).toBe("go");
      expect(evaluateDeal(withLotPrice(lot.valueCents + 10_000), CTX).verdict.kind).not.toBe("go");
    }
  });

  it("skips goal seek when the deal is already a go", () => {
    const ev = evaluateDeal(withLotPrice(0), CTX);
    expect(ev.verdict.kind).toBe("go");
    expect(ev.goalSeek).toBeNull();
    expect(ev.grid).toHaveLength(5);
    // With a free lot the profit outlasts three years on the market, the longest break-even searched.
    expect(ev.breakEvenDomDays).toBeNull();
  });

  it("finds a sale price that makes it a go, where $100 less does not", () => {
    const sale = golden().goalSeek?.find((r) => r.lever === "salePrice");
    expect(sale?.reachable).toBe(true);
    if (sale?.reachable && sale.valueCents !== undefined) {
      expect(sale.valueCents).toBeGreaterThan(135_000_000);
      // A base price override gives the base scenario goal seek's exact price. The other scenarios' prices
      // can differ from goal seek's scaling by a cent, far too little to flip the downside rule here.
      const withBasePrice = (basePriceCents: number): DealInputs => ({
        ...GOLDEN_DEAL,
        overrides: { ...GOLDEN_DEAL.overrides, basePriceCents },
      });
      expect(evaluateDeal(withBasePrice(sale.valueCents), CTX).verdict.kind).toBe("go");
      expect(evaluateDeal(withBasePrice(sale.valueCents - 10_000), CTX).verdict.kind).not.toBe("go");
    }
  });

  it("raises every scenario's sale price when seeking a go, so a downside shortfall can be priced away", () => {
    const deal: DealInputs = { ...GOLDEN_DEAL, rules: { ...GOLDEN_DEAL.rules, minDownsideProfitCents: 17_000_000 } };
    const ev = evaluateDeal(deal, CTX);
    expect(ev.verdict.kind).toBe("nogo");
    const sale = ev.goalSeek?.find((r) => r.lever === "salePrice");
    expect(sale?.reachable).toBe(true);
    // The downside rule, not the margin, sets this price, so it is above the golden deal's answer.
    const goldenSale = golden().goalSeek?.find((r) => r.lever === "salePrice");
    expect(sale?.valueCents).toBeGreaterThan(goldenSale?.valueCents ?? Infinity);
  });

  it("finds a build cost that makes it a go, where $100 more does not", () => {
    const build = golden().goalSeek?.find((r) => r.lever === "buildCost");
    expect(build?.reachable).toBe(true);
    // Every golden line is a bid, so scaling the bids scales the estimate exactly as goal seek does.
    expect(unwrap(golden().estimate).lines.every((l) => l.source === "bid")).toBe(true);
    if (build?.reachable && build.valueCents !== undefined) {
      expect(build.valueCents).toBeLessThan(73_599_750);
      const withBuildTotal = (totalCents: number): DealInputs => {
        const factor = totalCents / 73_599_750;
        const bids = GOLDEN_DEAL.bids.map((b) => ({ ...b, amountCents: roundCents(b.amountCents * factor) }));
        return { ...GOLDEN_DEAL, bids };
      };
      expect(evaluateDeal(withBuildTotal(build.valueCents), CTX).verdict.kind).toBe("go");
      expect(evaluateDeal(withBuildTotal(build.valueCents + 10_000), CTX).verdict.kind).not.toBe("go");
    }
  });

  it("does not mutate the deal or the context, and gives the same answer every time", () => {
    const deal = structuredClone(GOLDEN_DEAL);
    const ctx = structuredClone(CTX);
    const first = evaluateDeal(deal, ctx);
    expect(deal).toEqual(GOLDEN_DEAL);
    expect(ctx).toEqual(CTX);
    // Goal seek scales a copy of the estimate, never the one returned.
    expect(unwrap(first.estimate).totalCents).toBe(73_599_750);
    expect(evaluateDeal(deal, ctx)).toEqual(first);
  });
});

describe("evaluateDeal wiring", () => {
  it("prices the estimate for the lot's region with the deal's contingency and build months", () => {
    const deal: DealInputs = {
      ...GOLDEN_DEAL,
      bids: [],
      timeline: { ...GOLDEN_DEAL.timeline, buildMonths: 10 },
      contingencyPct: 0.1,
    };
    const q = unwrap(computeQuantities(deal.house, deal.lot, DEFAULT_QUANTITY_RULES));
    const parts = linePartsFor(q, deal.house, 10);
    const book = uniformBookFor(parts, "utah-north", 100, "2026-01-01");

    const est = unwrap(evaluateDeal(deal, { ...CTX, costBook: book }).estimate);
    expect(est.contingencyPct).toBe(0.1);
    expect(est.lines.find((l) => l.code === "supervision")?.parts[0]?.quantity).toBe(10);

    const elsewhere = uniformBookFor(parts, "utah-south", 100, "2026-01-01");
    const missing = missingOf(evaluateDeal(deal, { ...CTX, costBook: elsewhere }).estimate);
    expect(missing.every((m) => m.code === "missingPrice")).toBe(true);
  });

  it("passes the planned list price to the days-on-market estimate", () => {
    const mid = unwrap(golden().price).midCents;
    const ev = evaluateDeal({ ...GOLDEN_DEAL, plannedListPriceCents: mid * 2 }, CTX);
    expect(unwrap(ev.dom).factors.pricePosition).toBe(1 + DEFAULT_MARKET_SETTINGS.elasticity);
  });

  it("honours the owner's comp selections", () => {
    const none = Object.fromEntries(GOLDEN_COMPS.map((c) => [c.id, false]));
    const ev = evaluateDeal({ ...GOLDEN_DEAL, compSelections: none }, CTX);
    expect(missingOf(ev.price).map((m) => m.code)).toEqual(["noComps"]);
    expect(missingOf(ev.dom).map((m) => m.code)).toEqual(["noDomComps"]);
  });
});

describe("evaluateDeal with missing inputs", () => {
  it("is incomplete with noComps when there are no comps and no overrides", () => {
    const ev = evaluateDeal({ ...GOLDEN_DEAL, overrides: {} }, { ...CTX, comps: [] });
    expect(ev.validation).toEqual([]);
    expect(ev.estimate.status).toBe("ok");
    expect(ev.price.status).toBe("incomplete");
    expect(ev.dom.status).toBe("incomplete");
    expectBlocked(ev);
    expect(ev.verdict.missing?.map((m) => m.code)).toContain("noComps");
    expect(missingOf(ev.scenarios).map((m) => m.code)).toEqual(["noComps"]);
  });

  it("runs on the overrides alone when there are no comps, with a noMarketRange warning", () => {
    const ev = evaluateDeal(GOLDEN_DEAL, { ...CTX, comps: [] });
    expect(ev.price.status).toBe("incomplete");
    expect(ev.dom.status).toBe("incomplete");
    const scenarios = ev.scenarios;
    expect(scenarios.status).toBe("ok");
    if (scenarios.status === "ok") {
      expect(scenarios.warnings.map((w) => w.code)).toEqual(["noMarketRange"]);
      expect(scenarios.value.downside.inputs.priceCents).toBe(135_000_000);
      expect(scenarios.value.upside.inputs.domDays).toBe(62);
    }
    expect(ev.verdict.kind).not.toBe("incomplete");
    expect(ev.grid).toHaveLength(5);
  });

  it("rolls missing prices up into an incomplete verdict while the market still runs", () => {
    const ev = evaluateDeal({ ...GOLDEN_DEAL, bids: [] }, CTX);
    const missing = missingOf(ev.estimate);
    expect(missing.length).toBeGreaterThan(0);
    expect(ev.price.status).toBe("ok");
    expect(ev.dom.status).toBe("ok");
    expectBlocked(ev);
    expect(ev.verdict.missing).toEqual(missing);
  });

  it("reports every blocking step once when several are missing", () => {
    const ev = evaluateDeal({ ...GOLDEN_DEAL, bids: [], overrides: {} }, { ...CTX, comps: [] });
    expectBlocked(ev);
    const items = ev.verdict.missing ?? [];
    const codes = new Set(items.map((m) => m.code));
    expect(codes).toEqual(new Set(["missingPrice", "noComps"]));
    const keys = items.map((m) => JSON.stringify(m));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("evaluateDeal on an invalid deal", () => {
  it("returns the validation issues and stops: every step incomplete, verdict incomplete", () => {
    const deal: DealInputs = {
      ...GOLDEN_DEAL,
      house: {
        ...GOLDEN_DEAL.house,
        levels: { ...GOLDEN_DEAL.house.levels, basement: { totalSf: 2_200, finishedSf: 2_500, walkout: false } },
      },
    };
    const ev = evaluateDeal(deal, CTX);
    expect(ev.validation.length).toBeGreaterThan(0);
    expectBlocked(ev);
    const expected: MissingItem[] = ev.validation.map((i) => ({
      code: "invalidDeal",
      message: `${i.path}: ${i.message}`,
      step: "house",
    }));
    expect(ev.verdict.missing).toEqual(expected);
    const steps: Result<unknown>[] = [ev.quantities, ev.estimate, ev.price, ev.dom, ev.scenarios];
    for (const r of steps) expect(missingOf(r)).toEqual(expected);
  });

  it("sends each issue to the wizard step that fixes it", () => {
    const deal: DealInputs = { ...GOLDEN_DEAL, lot: { ...GOLDEN_DEAL.lot, priceCents: -1 }, contingencyPct: 2 };
    const ev = evaluateDeal(deal, CTX);
    const steps = Object.fromEntries((ev.verdict.missing ?? []).map((m) => [m.message.split(":")[0], m.step]));
    expect(steps).toEqual({ "lot.priceCents": "lot", contingencyPct: "proforma" });
  });

  it("stops at validation, before any cash flow, when the loan could never extend", () => {
    const deal: DealInputs = { ...GOLDEN_DEAL, loan: { ...GOLDEN_DEAL.loan, extensionMonths: 0 } };
    const ev = evaluateDeal(deal, CTX);
    expect(ev.validation.map((i) => i.path)).toEqual(["loan.extensionMonths"]);
    expectBlocked(ev);
  });
});

describe("evaluateDeal at an unsellable price", () => {
  it("is a no-go, and goal seek still answers for all three levers without throwing", () => {
    const deal: DealInputs = { ...GOLDEN_DEAL, overrides: { ...GOLDEN_DEAL.overrides, basePriceCents: 50_000_000 } };
    let ev: DealEvaluation | undefined;
    expect(() => {
      ev = evaluateDeal(deal, CTX);
    }).not.toThrow();
    expect(ev?.verdict.kind).toBe("nogo");
    expect(ev?.goalSeek).toHaveLength(3);
    expect(ev?.breakEvenDomDays).toBe(0);
  });
});

describe("evaluateDeal performance", () => {
  it("evaluates the golden deal in under 50 ms (median of 20 runs)", () => {
    for (let i = 0; i < 3; i++) evaluateDeal(GOLDEN_DEAL, CTX);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      evaluateDeal(GOLDEN_DEAL, CTX);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = (times[9]! + times[10]!) / 2;
    expect(median).toBeLessThan(50);
  });
});

describe("public API (index.ts)", () => {
  it("re-exports exactly the documented values", () => {
    expect(Object.keys(engine).sort()).toEqual(
      [
        "evaluateDeal",
        "validateDeal",
        "DEFAULT_RULES",
        "DEFAULT_SCENARIO_DEFS",
        "DEFAULT_MARKET_SETTINGS",
        "DEFAULT_QUANTITY_RULES",
        "COST_CODES",
        "formatUsd",
        "fitSeasonalFactors",
        "DealInputsSchema",
        "LotSchema",
        "TimelineSchema",
        "ConstructionLoanSchema",
        "CarrySchema",
        "SellingSchema",
        "RulesSchema",
        "ScenarioDefSchema",
        "ScenarioDefsSchema",
        "BidSchema",
        "UtilitySchema",
        "UtilityStatusSchema",
        "HouseModelSchema",
        "FinishTierSchema",
      ].sort(),
    );
  });

  it("evaluates through the barrel the same as directly", () => {
    expect(engine.evaluateDeal(GOLDEN_DEAL, CTX)).toEqual(golden());
    expect(engine.validateDeal(GOLDEN_DEAL)).toEqual([]);
  });

  it("exposes the input and result types (checked by tsc)", () => {
    const ctx: engine.EngineContext = CTX;
    const ev: engine.DealEvaluation = engine.evaluateDeal(GOLDEN_DEAL, ctx);
    const deal: engine.DealInputs = GOLDEN_DEAL;
    const house: engine.HouseModel = deal.house;
    const comps: engine.Comp[] = ctx.comps;
    const settings: engine.MarketSettings = ctx.marketSettings;
    const rules: engine.QuantityRules = ctx.quantityRules;
    const book: engine.CostBookView = ctx.costBook;
    const issues: engine.ValidationIssue[] = ev.validation;
    const quantities: engine.Result<engine.Quantities> = ev.quantities;
    const estimate: engine.Result<engine.Estimate> = ev.estimate;
    const lines: engine.EstimateLine[] = unwrap(estimate).lines;
    const price: engine.Result<engine.PriceEstimate> = ev.price;
    const dom: engine.Result<engine.DomEstimate> = ev.dom;
    const scenarios: engine.Result<Record<engine.ScenarioName, engine.ScenarioResult>> = ev.scenarios;
    const metrics: engine.Metrics = unwrap(scenarios).base.metrics;
    const cashFlow: engine.CashFlow = unwrap(scenarios).base.cashFlow;
    const grid: engine.GridCell[][] | null = ev.grid;
    const verdict: engine.Verdict = ev.verdict;
    const levers: engine.LeverResult[] | null = ev.goalSeek;
    const missing: engine.MissingItem[] | undefined = verdict.missing;
    const cents: engine.Cents = metrics.profitCents;
    const today: engine.ISODate = ctx.today;
    const all = [house, comps, settings, rules, book, issues, quantities, lines, price, dom, cashFlow, grid, levers];
    expect([...all, missing, cents, today]).toHaveLength(16);
  });
});
