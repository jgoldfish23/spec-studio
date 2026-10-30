import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniformBookFor } from "./__fixtures__/books";
import { SAMPLE_HOUSE, SAMPLE_LOT } from "./__fixtures__/sampleHouse";
import {
  COST_CODES,
  linePartsFor,
  type CostBookView,
  type CostCodeId,
  type LinePart,
  type PriceBookEntry,
} from "./costbook";
import type { Bid } from "./deal";
import { buildEstimate, type Estimate, type EstimateContext, type EstimateLine } from "./estimate";
import type { HouseModel } from "./house";
import type { Cents } from "./money";
import { computeQuantities, DEFAULT_QUANTITY_RULES, type Quantities } from "./quantities";
import type { Result } from "./result";

const REGION = "utah-north";
const TODAY = "2026-10-30";
const FRESH = "2026-06-01";
const BUILD_MONTHS = 9;

const ctx = (overrides: Partial<EstimateContext> = {}): EstimateContext => ({
  region: REGION,
  contingencyPct: 0.05,
  buildMonths: BUILD_MONTHS,
  today: TODAY,
  ...overrides,
});

const house = (): HouseModel => structuredClone(SAMPLE_HOUSE);

function quantitiesFor(h: HouseModel): Quantities {
  const r = computeQuantities(h, SAMPLE_LOT, DEFAULT_QUANTITY_RULES);
  if (r.status !== "ok") throw new Error(`expected ok, got incomplete: ${JSON.stringify(r.missing)}`);
  return r.value;
}

const SAMPLE_Q = quantitiesFor(house());
const SAMPLE_PARTS: LinePart[] = linePartsFor(SAMPLE_Q, house(), BUILD_MONTHS);
/** The 27 codes the sample house produces, in cost-code order. */
const SAMPLE_CODES: CostCodeId[] = [...new Set(SAMPLE_PARTS.map((p) => p.code))];

const DISTINCT_PRICE_KEYS = new Set(SAMPLE_PARTS.map((p) => JSON.stringify([p.code, p.variant, p.tier]))).size;

const uniformBook = (unitPriceCents: Cents = 100, asOf = FRESH): CostBookView =>
  uniformBookFor(SAMPLE_PARTS, REGION, unitPriceCents, asOf);

const bid = (code: string, amountCents: Cents, receivedOn = "2026-10-01", vendor = "Acme"): Bid => ({
  code,
  amountCents,
  vendor,
  receivedOn,
});

const bidsFor = (codes: readonly string[], amountCents: Cents): Bid[] => codes.map((c) => bid(c, amountCents));

function okValue(r: Result<Estimate>): Estimate {
  if (r.status !== "ok") throw new Error(`expected ok, got incomplete: ${JSON.stringify(r.missing)}`);
  return r.value;
}

function estimate(
  book: CostBookView = uniformBook(),
  bids: Bid[] = [],
  c: EstimateContext = ctx(),
  q: Quantities = SAMPLE_Q,
): Estimate {
  return okValue(buildEstimate(q, house(), book, bids, c));
}

const lineOf = (est: Estimate, code: CostCodeId): EstimateLine => {
  const line = est.lines.find((l) => l.code === code);
  if (!line) throw new Error(`no line for ${code}`);
  return line;
};

const sumLines = (est: Estimate) => est.lines.reduce((total, l) => total + l.totalCents, 0);

const framingBookEntry = (unitPriceCents: Cents, asOf = FRESH): PriceBookEntry => ({
  code: "framing",
  variant: "base",
  tier: null,
  unitPriceCents,
  unit: "sf",
  asOf,
});

describe("buildEstimate with every code bid", () => {
  it("totals the bids, adds contingency, and is entirely bid-sourced", () => {
    const est = estimate(uniformBook(), bidsFor(SAMPLE_CODES, 100_000));
    expect(est.lines).toHaveLength(27);
    expect(est.subtotalCents).toBe(2_700_000);
    expect(est.contingencyPct).toBe(0.05);
    expect(est.contingencyCents).toBe(135_000);
    expect(est.totalCents).toBe(2_835_000);
    expect(est.confidence.bidShare).toBe(1);
    expect(est.confidence.bidCents).toBe(2_700_000);
    expect(est.confidence.priceBookCents).toBe(0);
    expect(est.confidence.defaultCents).toBe(0);
    expect(est.bidsNext).toEqual({ codes: [], defaultShareAfter: 0 });
  });

  it("rounds contingency on the subtotal with mulRate", () => {
    // 26 bids of 100,000 plus one of 67,495,000 = 70,095,000; 5% is exactly 3,504,750.
    const bids = [...bidsFor(SAMPLE_CODES.filter((c) => c !== "plans"), 100_000), bid("plans", 67_495_000)];
    const est = estimate(uniformBook(), bids);
    expect(est.subtotalCents).toBe(70_095_000);
    expect(est.contingencyCents).toBe(3_504_750);
    expect(est.totalCents).toBe(73_599_750);
  });

  it("does not need prices for lines a bid replaces", () => {
    const book = uniformBook();
    book.defaults = book.defaults.filter((d) => d.code !== "windows");
    const est = estimate(book, [bid("windows", 5_000_000)]);
    expect(lineOf(est, "windows").totalCents).toBe(5_000_000);
  });
});

describe("buildEstimate from the default book", () => {
  it("prices every part from the default book when there are no bids", () => {
    const est = estimate();
    expect(est.lines).toHaveLength(27);
    expect(lineOf(est, "framing").totalCents).toBe(456_800);
    expect(lineOf(est, "framing").source).toBe("default");
    expect(est.subtotalCents).toBe(7_089_800);
    expect(est.contingencyCents).toBe(354_490);
    expect(est.totalCents).toBe(7_444_290);
    expect(est.confidence).toEqual({
      bidCents: 0,
      priceBookCents: 0,
      defaultCents: 7_089_800,
      bidShare: 0,
      priceBookShare: 0,
      defaultShare: 1,
    });
  });

  it("orders lines by cost-code number with name and division from the cost book", () => {
    const est = estimate();
    const numbers = est.lines.map((l) => COST_CODES.find((c) => c.id === l.code)?.number ?? -1);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(est.lines.map((l) => l.code).slice(0, 3)).toEqual(["plans", "permits", "surveySoils"]);
    expect(lineOf(est, "hvac")).toMatchObject({ name: "HVAC", division: "mep" });
    expect(lineOf(est, "garageDoors")).toMatchObject({ name: "Garage doors", division: "exteriorFinish" });
  });

  it("carries each part's price, total, source, and the part fields from the takeoff", () => {
    const cabinets = lineOf(estimate(), "cabinets");
    expect(cabinets.parts).toHaveLength(3);
    expect(cabinets.parts[0]).toEqual({
      code: "cabinets",
      variant: "lf",
      tier: "luxury",
      quantity: 36,
      unit: "lf",
      area: "kitchen",
      unitPriceCents: 100,
      totalCents: 3_600,
      source: "default",
      asOf: FRESH,
      stale: false,
    });
    expect(cabinets.totalCents).toBe(6_000);
    expect(cabinets.bid).toBeUndefined();
  });

  it("rounds each part total half away from zero, and sums the rounded parts", () => {
    const q = structuredClone(SAMPLE_Q);
    q.framingSf.value = 100.5;
    const est = estimate(uniformBook(101), [], ctx(), q);
    // 100.5 × 101 = 10,150.5 → 10,151
    expect(lineOf(est, "framing").parts[0]?.totalCents).toBe(10_151);
    expect(lineOf(est, "framing").totalCents).toBe(10_151);
  });

  it("uses the buildMonths in the context for the supervision quantity", () => {
    const est = estimate(uniformBook(), [], ctx({ buildMonths: 12 }));
    expect(lineOf(est, "supervision").parts[0]).toMatchObject({ quantity: 12, totalCents: 1_200 });
  });

  it("computes cost per finished sf from the total, rounded to cents", () => {
    const est = estimate();
    // 7,444,290 / 3,800 = 1,959.02…
    expect(est.costPerFinishedSfCents).toBe(1_959);
  });

  it("subtotals every division, with zero for a division that has no lines, excluding contingency", () => {
    const est = estimate();
    expect(Object.keys(est.divisionSubtotals).sort()).toEqual(
      ["envelope", "exteriorFinish", "general", "interior", "mep", "site", "soft", "structure"].sort(),
    );
    expect(est.divisionSubtotals.soft).toBe(300);
    expect(est.divisionSubtotals.structure).toBe(21_400 + 456_800 + 4_000);
    expect(Object.values(est.divisionSubtotals).reduce((a, b) => a + b, 0)).toBe(est.subtotalCents);

    const q = structuredClone(SAMPLE_Q);
    q.excavationYd3.value = 0;
    q.utilityConnections.value = 0;
    const noSite = estimate(uniformBook(), [], ctx(), q);
    expect(noSite.lines.some((l) => l.division === "site")).toBe(false);
    expect(noSite.divisionSubtotals.site).toBe(0);
  });

  it("is incomplete when the house has no finished area to divide by", () => {
    const q = structuredClone(SAMPLE_Q);
    q.finishedSf.value = 0;
    const r = buildEstimate(q, house(), uniformBook(), [], ctx());
    expect(r.status).toBe("incomplete");
    if (r.status === "incomplete") {
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]).toMatchObject({ code: "missingFinishedArea", step: "house" });
    }
  });

  it("does not change its inputs", () => {
    const q = structuredClone(SAMPLE_Q);
    const book = uniformBook();
    const bids = [bid("plans", 900_000)];
    const before = structuredClone({ q, book, bids });
    buildEstimate(q, house(), book, bids, ctx());
    expect({ q, book, bids }).toEqual(before);
  });
});

describe("buildEstimate with price-book entries", () => {
  it("prefers the price book and reports the line and confidence from it", () => {
    const book = uniformBook();
    book.priceBook = [framingBookEntry(1_500)];
    const est = estimate(book);
    const framing = lineOf(est, "framing");
    expect(framing.totalCents).toBe(6_852_000);
    expect(framing.source).toBe("priceBook");
    expect(framing.parts[0]).toMatchObject({ unitPriceCents: 1_500, source: "priceBook", asOf: FRESH });
    expect(est.confidence.priceBookCents).toBe(6_852_000);
    expect(est.subtotalCents).toBe(13_485_000);
    expect(est.confidence.priceBookShare).toBe(6_852_000 / 13_485_000);
    expect(est.confidence.defaultCents).toBe(13_485_000 - 6_852_000);
  });

  it("marks a line default as soon as any one of its parts is default", () => {
    const book = uniformBook();
    book.priceBook = [
      { code: "cabinets", variant: "lf", tier: "luxury", unitPriceCents: 5_000, unit: "lf", asOf: FRESH },
    ];
    const cabinets = lineOf(estimate(book), "cabinets");
    expect(cabinets.parts.map((p) => p.source)).toEqual(["priceBook", "default", "default"]);
    expect(cabinets.source).toBe("default");
    expect(cabinets.totalCents).toBe(36 * 5_000 + 24 * 100);
  });
});

describe("buildEstimate with bids", () => {
  it("lets the latest bid for a code win and replace the whole line", () => {
    const bids = [
      bid("plans", 900_000, "2026-09-01", "Older Co"),
      bid("plans", 850_000, "2026-10-12", "Newer Co"),
    ];
    const plans = lineOf(estimate(uniformBook(), bids), "plans");
    expect(plans.totalCents).toBe(850_000);
    expect(plans.source).toBe("bid");
    expect(plans.bid).toEqual(bids[1]);
    expect(plans.parts).toEqual([]);
  });

  it("picks the latest bid regardless of array order, and the first of equal dates", () => {
    const later = bid("plans", 850_000, "2026-10-12", "Newer Co");
    const earlier = bid("plans", 900_000, "2026-09-01", "Older Co");
    expect(lineOf(estimate(uniformBook(), [later, earlier]), "plans").bid).toBe(later);

    const first = bid("plans", 800_000, "2026-10-12", "First");
    const second = bid("plans", 700_000, "2026-10-12", "Second");
    const tied = lineOf(estimate(uniformBook(), [first, second]), "plans");
    expect(tied.bid).toBe(first);
    expect(tied.totalCents).toBe(800_000);
  });

  it("adds a line for a bid on a code the house does not otherwise use, in cost-code order", () => {
    const est = estimate(uniformBook(), [bid("pool", 6_000_000)]);
    expect(est.lines).toHaveLength(28);
    const codes = est.lines.map((l) => l.code);
    expect(codes.indexOf("pool")).toBe(codes.indexOf("patio") - 1);
    expect(lineOf(est, "pool")).toMatchObject({
      name: "Pool & spa",
      division: "exteriorFinish",
      source: "bid",
      totalCents: 6_000_000,
      parts: [],
    });
  });

  it("ignores a bid whose code is not a cost code, with a warning", () => {
    const r = buildEstimate(
      SAMPLE_Q,
      house(),
      uniformBook(),
      [bid("moatDigging", 1_000_000, "2026-10-01", "Castle Co"), bid("plans", 850_000)],
      ctx(),
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.value.lines).toHaveLength(27);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe("unknownBidCode");
    expect(r.warnings[0]?.message).toContain("moatDigging");
    expect(lineOf(r.value, "plans").totalCents).toBe(850_000);
  });

  it("has no warnings when every bid is for a cost code", () => {
    const r = buildEstimate(SAMPLE_Q, house(), uniformBook(), [bid("plans", 850_000)], ctx());
    expect(r.status === "ok" && r.warnings).toEqual([]);
  });
});

describe("confidence", () => {
  it("splits cents between bids, price-book parts, and default parts, excluding contingency", () => {
    const book = uniformBook();
    book.priceBook = [framingBookEntry(1_500)];
    const est = estimate(book, [bid("plans", 850_000)]);
    // plans 850,000 bid; framing 6,852,000 price book; everything else default at 100/unit,
    // which is the all-default subtotal 7,089,800 less the plans (100) and framing (456,800) lines.
    expect(est.subtotalCents).toBe(850_000 + 6_852_000 + 6_632_900);
    expect(est.confidence.bidCents).toBe(850_000);
    expect(est.confidence.priceBookCents).toBe(6_852_000);
    expect(est.confidence.defaultCents).toBe(6_632_900);
    const { bidCents, priceBookCents } = est.confidence;
    expect(bidCents + priceBookCents + est.confidence.defaultCents).toBe(est.subtotalCents);
    const { bidShare, priceBookShare, defaultShare } = est.confidence;
    expect(bidShare).toBe(bidCents / est.subtotalCents);
    expect(priceBookShare).toBe(priceBookCents / est.subtotalCents);
    expect(defaultShare).toBe(est.confidence.defaultCents / est.subtotalCents);
    expect(bidShare + priceBookShare + defaultShare).toBeCloseTo(1, 12);
  });

  it("reports zero shares when the subtotal is zero", () => {
    const est = estimate(uniformBook(), bidsFor(SAMPLE_CODES, 0));
    expect(est.subtotalCents).toBe(0);
    expect(est.totalCents).toBe(0);
    expect(est.confidence).toMatchObject({ bidShare: 0, priceBookShare: 0, defaultShare: 0 });
    expect(est.bidsNext.defaultShareAfter).toBe(0);
  });
});

describe("bidsNext", () => {
  it("lists the four largest default lines, largest first, lower cost-code number winning ties", () => {
    const est = estimate();
    // drywall and paint tie at 1,537,000; landscaping is 974,700 and framing 456,800.
    expect(est.bidsNext.codes).toEqual(["drywall", "paint", "landscaping", "framing"]);
    expect(est.bidsNext.defaultShareAfter).toBe((7_089_800 - 4_505_500) / 7_089_800);
  });

  it("skips lines that are bid or priced entirely from the price book", () => {
    const book = uniformBook();
    book.priceBook = [framingBookEntry(1_500)];
    const est = estimate(book, [bid("drywall", 1_000_000)]);
    expect(est.bidsNext.codes).toEqual(["paint", "landscaping", "electrical", "insulation"]);
  });

  it("lists fewer than four when fewer lines are default, breaking ties by cost-code number", () => {
    const rest = SAMPLE_CODES.filter((c) => c !== "plans" && c !== "permits" && c !== "surveySoils");
    const est = estimate(uniformBook(), bidsFor(rest, 1_000));
    expect(est.bidsNext.codes).toEqual(["plans", "permits", "surveySoils"]);
    expect(est.bidsNext.defaultShareAfter).toBe(0);
  });

  it("counts only the default parts of a mixed line toward the share it would remove", () => {
    const book = uniformBook();
    book.priceBook = [
      { code: "cabinets", variant: "lf", tier: "luxury", unitPriceCents: 5_000, unit: "lf", asOf: FRESH },
    ];
    const defaultCodes: CostCodeId[] = ["plans", "permits", "surveySoils", "cabinets", "cleaning"];
    const est = estimate(
      book,
      bidsFor(
        SAMPLE_CODES.filter((c) => !defaultCodes.includes(c)),
        1_000,
      ),
    );
    // Default lines: cleaning 380,000; cabinets 182,400 (180,000 of it price book); plans, permits,
    // surveySoils 100 each. Bidding the top four leaves only surveySoils' 100.
    expect(est.subtotalCents).toBe(22_000 + 182_400 + 380_000 + 300);
    expect(est.confidence.defaultCents).toBe(382_700);
    expect(est.confidence.priceBookCents).toBe(180_000);
    expect(est.bidsNext.codes).toEqual(["cleaning", "cabinets", "plans", "permits"]);
    expect(est.bidsNext.defaultShareAfter).toBe(100 / 584_700);
  });
});

describe("staleness", () => {
  it("flags parts and lines whose price is more than 365 days old", () => {
    const est = estimate(uniformBook(100, "2025-09-01"));
    expect(est.staleCount).toBeGreaterThan(0);
    expect(est.staleCount).toBe(27);
    expect(lineOf(est, "framing").stale).toBe(true);
    expect(lineOf(est, "framing").parts[0]?.stale).toBe(true);
  });

  it("treats exactly 365 days as fresh and 366 as stale", () => {
    expect(estimate(uniformBook(100, "2025-10-30")).staleCount).toBe(0);
    expect(estimate(uniformBook(100, "2025-10-29")).staleCount).toBe(27);
  });

  it("counts lines, and a line is stale if any one of its parts is", () => {
    const book = uniformBook();
    book.priceBook = [
      { code: "cabinets", variant: "lf", tier: "luxury", unitPriceCents: 5_000, unit: "lf", asOf: "2024-01-01" },
    ];
    const est = estimate(book);
    expect(lineOf(est, "cabinets").parts.map((p) => p.stale)).toEqual([true, false, false]);
    expect(lineOf(est, "cabinets").stale).toBe(true);
    expect(est.staleCount).toBe(1);
  });

  it("judges a bid by its receivedOn date", () => {
    const old = estimate(uniformBook(), [bid("plans", 850_000, "2025-01-15")]);
    expect(lineOf(old, "plans").stale).toBe(true);
    expect(old.staleCount).toBe(1);
    const recent = estimate(uniformBook(), [bid("plans", 850_000, "2025-11-01")]);
    expect(lineOf(recent, "plans").stale).toBe(false);
    expect(recent.staleCount).toBe(0);
  });
});

describe("missing prices", () => {
  const without = (...codes: CostCodeId[]): CostBookView => {
    const book = uniformBook();
    book.defaults = book.defaults.filter((d) => !codes.includes(d.code));
    return book;
  };

  it("is incomplete when a part has no price, naming the code, variant, and tier", () => {
    const r = buildEstimate(SAMPLE_Q, house(), without("windows"), [], ctx());
    expect(r.status).toBe("incomplete");
    if (r.status !== "incomplete") return;
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]).toMatchObject({ code: "missingPrice", step: "estimate" });
    expect(r.missing[0]?.message).toContain("windows");
    expect(r.missing[0]?.message).toContain("window");
    expect(r.missing[0]?.message).toContain("upgraded");
  });

  it("lists every missing key, in cost-code order, rather than stopping at the first", () => {
    const r = buildEstimate(SAMPLE_Q, house(), without("hvac", "windows", "plans"), [], ctx());
    expect(r.status).toBe("incomplete");
    if (r.status !== "incomplete") return;
    expect(r.missing).toHaveLength(3);
    expect(r.missing.every((m) => m.code === "missingPrice" && m.step === "estimate")).toBe(true);
    expect(r.missing.map((m) => ["plans", "windows", "hvac"].findIndex((c) => m.message.includes(c)))).toEqual([
      0, 1, 2,
    ]);
  });

  it("reports a key shared by several parts once", () => {
    // Primary-bath and remaining cabinets are both cabinets / lf / upgraded.
    const book = uniformBook();
    book.defaults = book.defaults.filter((d) => !(d.code === "cabinets" && d.tier === "upgraded"));
    const r = buildEstimate(SAMPLE_Q, house(), book, [], ctx());
    expect(r.status).toBe("incomplete");
    if (r.status === "incomplete") expect(r.missing).toHaveLength(1);
  });

  it("does not use a default from another region", () => {
    const r = buildEstimate(SAMPLE_Q, house(), uniformBook(), [], ctx({ region: "elsewhere" }));
    expect(r.status).toBe("incomplete");
    if (r.status === "incomplete") expect(r.missing).toHaveLength(DISTINCT_PRICE_KEYS);
  });
});

describe("estimate invariants", () => {
  const codeArb = fc.constantFrom(...COST_CODES.map((c) => c.id));
  const bidArb = fc.record({
    code: codeArb,
    amountCents: fc.integer({ min: 0, max: 5_000_000_000 }),
    vendor: fc.constantFrom("Acme", "Bolt", "Crane"),
    receivedOn: fc.constantFrom("2025-01-10", "2026-03-04", "2026-09-30", "2026-10-12"),
  });
  const bidsArb = fc.array(bidArb, { maxLength: 40 });
  const rateArb = fc.integer({ min: 0, max: 3_000 }).map((n) => n / 10_000);

  it("total equals the sum of line totals plus contingency, for any bids", () => {
    fc.assert(
      fc.property(bidsArb, rateArb, (bids, contingencyPct) => {
        const est = estimate(uniformBook(), bids, ctx({ contingencyPct }));
        expect(est.totalCents).toBe(sumLines(est) + est.contingencyCents);
        expect(est.subtotalCents).toBe(sumLines(est));
        expect(Object.values(est.divisionSubtotals).reduce((a, b) => a + b, 0)).toBe(est.subtotalCents);
        const { bidCents, priceBookCents, defaultCents } = est.confidence;
        expect(bidCents + priceBookCents + defaultCents).toBe(est.subtotalCents);
        expect(est.bidsNext.codes.length).toBeLessThanOrEqual(4);
      }),
    );
  });
});
