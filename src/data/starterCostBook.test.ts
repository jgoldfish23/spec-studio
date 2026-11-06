import { testSampleComps } from "../testing/sampleIds";
import { describe, expect, it } from "vitest";
import {
  CostBookViewSchema,
  DEFAULT_MARKET_SETTINGS,
  DEFAULT_QUANTITY_RULES,
  evaluateDeal,
  type DealInputs,
  type EngineContext,
  type FinishTier,
} from "@engine";
import { sampleDealInputs } from "./sample";
import { STARTER_COST_BOOK } from "./starterCostBook";

const keyOf = (p: { code: string; variant: string; tier: string | null }) => JSON.stringify([p.code, p.variant, p.tier]);
const priceOf = (code: string, variant: string, tier: FinishTier | null = null) =>
  STARTER_COST_BOOK.find((p) => p.code === code && p.variant === variant && p.tier === tier);

describe("STARTER_COST_BOOK", () => {
  it("has 74 entries, each (code, variant, tier) once", () => {
    expect(STARTER_COST_BOOK).toHaveLength(74);
    expect(new Set(STARTER_COST_BOOK.map(keyOf)).size).toBe(74);
  });

  it("prices every entry at a positive whole number of cents", () => {
    for (const p of STARTER_COST_BOOK) {
      expect(Number.isInteger(p.unitPriceCents), keyOf(p)).toBe(true);
      expect(p.unitPriceCents, keyOf(p)).toBeGreaterThan(0);
    }
  });

  it("marks every entry as an unverified Utah North estimate", () => {
    for (const p of STARTER_COST_BOOK) {
      expect(p.region).toBe("utah-north");
      expect(p.asOf).toBe("2026-10-30");
      expect(p.verified).toBe(false);
      expect(p.sourceNote).toBe("Starter estimate — unverified");
    }
  });

  it("passes the cost book schema", () => {
    const parsed = CostBookViewSchema.safeParse({ defaults: STARTER_COST_BOOK, priceBook: [] });
    expect(parsed.success).toBe(true);
  });

  it("stores dollars as cents, keeping the cents of a unit price", () => {
    expect(priceOf("plans", "ls")).toMatchObject({ unit: "ls", unitPriceCents: 900_000, tier: null });
    expect(priceOf("framing", "base")).toMatchObject({ unit: "sf", unitPriceCents: 2_350 });
    expect(priceOf("insulation", "base")?.unitPriceCents).toBe(240);
    expect(priceOf("cleaning", "base")?.unitPriceCents).toBe(110);
    expect(priceOf("paint", "base")?.unitPriceCents).toBe(120);
    expect(priceOf("cladding", "stone")).toMatchObject({ unit: "sf", unitPriceCents: 3_200 });
    expect(priceOf("adu", "detached")).toMatchObject({ unit: "ls", unitPriceCents: 16_500_000 });
    expect(priceOf("pool", "safety")?.unitPriceCents).toBe(750_000);
    expect(priceOf("hvac", "ton")).toMatchObject({ unit: "ton", unitPriceCents: 530_000 });
    expect(priceOf("supervision", "month")).toMatchObject({ unit: "mo", unitPriceCents: 370_000 });
  });

  it("prices the tiered codes once per finish tier", () => {
    expect(priceOf("windows", "window", "standard")?.unitPriceCents).toBe(95_000);
    expect(priceOf("windows", "window", "upgraded")?.unitPriceCents).toBe(115_000);
    expect(priceOf("windows", "window", "luxury")?.unitPriceCents).toBe(160_000);
    expect(priceOf("electrical", "base", "standard")?.unitPriceCents).toBe(600);
    expect(priceOf("electrical", "base", "upgraded")?.unitPriceCents).toBe(675);
    expect(priceOf("electrical", "base", "luxury")?.unitPriceCents).toBe(850);
    expect(priceOf("landscaping", "allowance", "standard")?.unitPriceCents).toBe(125);
    expect(priceOf("landscaping", "allowance", "luxury")?.unitPriceCents).toBe(350);
    expect(priceOf("fixtures", "kitchen", "luxury")?.unitPriceCents).toBe(2_200_000);
    expect(priceOf("fireplaces", "unit", "upgraded")?.unitPriceCents).toBe(550_000);
    // Untiered codes carry no tier, so one entry prices them at every tier.
    expect(priceOf("framing", "base", "standard")).toBeUndefined();
    expect(priceOf("landscaping", "fence")?.unitPriceCents).toBe(3_800);
  });
});

const ctx = (): EngineContext => ({
  today: "2026-10-30",
  costBook: { defaults: STARTER_COST_BOOK, priceBook: [] },
  comps: testSampleComps(),
  marketSettings: DEFAULT_MARKET_SETTINGS,
  quantityRules: DEFAULT_QUANTITY_RULES,
});

const withHouse = (change: (d: DealInputs) => void): DealInputs => {
  const deal = sampleDealInputs();
  change(deal);
  return deal;
};

// Each variant exercises price keys the plain sample does not reach.
const variants: [string, DealInputs][] = [
  ["standard house tier", withHouse((d) => { d.house.finishes.houseTier = "standard"; })],
  ["upgraded house tier", withHouse((d) => { d.house.finishes.houseTier = "upgraded"; })],
  ["luxury house tier", withHouse((d) => { d.house.finishes.houseTier = "luxury"; })],
  [
    "every override at luxury",
    withHouse((d) => { d.house.finishes.overrides = { kitchen: "luxury", primaryBath: "luxury", basement: "luxury" }; }),
  ],
  ["basement ADU", withHouse((d) => { d.house.adu = { type: "basement" }; })],
  ["detached ADU (600 sf)", withHouse((d) => { d.house.adu = { type: "detached", finishedSf: 600 }; })],
  ["gunite pool with spa and heater", withHouse((d) => { d.house.pool = { type: "gunite", spa: true, heated: true }; })],
  ["fiberglass pool", withHouse((d) => { d.house.pool = { type: "fiberglass", spa: false, heated: false }; })],
  [
    "fiber cement at 10%",
    withHouse((d) => { d.house.exterior = { stonePct: 15, stuccoPct: 50, boardBattenPct: 25, fiberCementPct: 10 }; }),
  ],
  ["RV bay", withHouse((d) => { d.house.garage.rvBay = true; })],
  ["landscaping at luxury", withHouse((d) => { d.house.outside.landscapingTier = "luxury"; })],
];

describe("the starter cost book prices every house variant", () => {
  it.each(variants)("with the sample's bids: %s", (_name, deal) => {
    const evaluation = evaluateDeal(deal, ctx());
    expect(evaluation.validation).toEqual([]);
    expect(evaluation.estimate.status).toBe("ok");
  });

  // With no bids, every line has to come from the book, so a missing price key cannot hide behind a bid.
  it.each(variants)("with no bids at all: %s", (_name, deal) => {
    const evaluation = evaluateDeal({ ...deal, bids: [] }, ctx());
    expect(evaluation.validation).toEqual([]);
    expect(evaluation.estimate.status).toBe("ok");
    if (evaluation.estimate.status === "ok") {
      expect(evaluation.estimate.value.confidence.bidCents).toBe(0);
      expect(evaluation.estimate.value.confidence.defaultShare).toBe(1);
    }
  });
});
