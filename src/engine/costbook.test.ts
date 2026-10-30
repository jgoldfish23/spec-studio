import { describe, expect, it } from "vitest";
import { uniformBookFor } from "./__fixtures__/books";
import { SAMPLE_HOUSE, SAMPLE_LOT } from "./__fixtures__/sampleHouse";
import {
  COST_CODES,
  linePartsFor,
  resolvePrice,
  type CostBookView,
  type CostCodeId,
  type DefaultPrice,
  type LinePart,
  type PriceBookEntry,
} from "./costbook";
import type { HouseModel } from "./house";
import { computeQuantities, DEFAULT_QUANTITY_RULES, type Quantities } from "./quantities";

const house = (): HouseModel => structuredClone(SAMPLE_HOUSE);

function quantitiesFor(h: HouseModel): Quantities {
  const r = computeQuantities(h, SAMPLE_LOT, DEFAULT_QUANTITY_RULES);
  if (r.status !== "ok") throw new Error(`expected ok, got incomplete: ${JSON.stringify(r.missing)}`);
  return r.value;
}

const partsFor = (h: HouseModel = house(), buildMonths = 9): LinePart[] =>
  linePartsFor(quantitiesFor(h), h, buildMonths);

const forCode = (parts: LinePart[], code: CostCodeId): LinePart[] => parts.filter((p) => p.code === code);

describe("COST_CODES", () => {
  it("lists the 29 codes numbered 1 through 29", () => {
    expect(COST_CODES).toHaveLength(29);
    expect(COST_CODES.map((c) => c.number)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it("has unique ids and the spec names and divisions", () => {
    expect(new Set(COST_CODES.map((c) => c.id)).size).toBe(29);
    const byId = (id: CostCodeId) => COST_CODES.find((c) => c.id === id);
    expect(byId("plans")).toEqual({ id: "plans", number: 1, name: "Plans & engineering", division: "soft" });
    expect(byId("framing")).toMatchObject({ number: 7, name: "Framing", division: "structure" });
    expect(byId("garageDoors")).toMatchObject({ number: 21, name: "Garage doors", division: "exteriorFinish" });
    expect(byId("hvac")).toMatchObject({ number: 14, name: "HVAC", division: "mep" });
    expect(byId("cladding")).toMatchObject({ number: 10, name: "Exterior cladding", division: "envelope" });
    expect(byId("fireplaces")).toMatchObject({ number: 26, division: "interior" });
    expect(byId("adu")).toMatchObject({ number: 27, name: "ADU package", division: "interior" });
    expect(byId("pool")).toMatchObject({ number: 28, name: "Pool & spa", division: "exteriorFinish" });
    expect(byId("patio")).toMatchObject({ number: 29, name: "Covered patio / deck", division: "exteriorFinish" });
  });
});

describe("linePartsFor on the sample house", () => {
  it("produces parts for 27 codes: the 25 base codes plus fireplaces and patio", () => {
    const parts = partsFor();
    expect(new Set(parts.map((p) => p.code)).size).toBe(27);
    expect(forCode(parts, "fireplaces")).toHaveLength(1);
    expect(forCode(parts, "patio")).toHaveLength(1);
  });

  it("prices each cabinet area at its own tier, in kitchen, primary bath, rest order", () => {
    const cabinets = forCode(partsFor(), "cabinets");
    expect(cabinets.map((p) => p.tier)).toEqual(["luxury", "upgraded", "upgraded"]);
    expect(cabinets.map((p) => p.area)).toEqual(["kitchen", "primaryBath", "house"]);
    expect(cabinets.every((p) => p.unit === "lf")).toBe(true);
  });

  it("prices basement carpet at the basement tier, after above-grade carpet", () => {
    const carpet = partsFor().filter((p) => p.code === "flooring" && p.variant === "carpet");
    expect(carpet.map((p) => p.tier)).toEqual(["upgraded", "standard"]);
    expect(carpet.map((p) => p.area)).toEqual(["house", "basement"]);
  });

  it("lists flooring parts in table order", () => {
    const flooring = forCode(partsFor(), "flooring");
    expect(flooring.map((p) => [p.variant, p.tier])).toEqual([
      ["tile", "upgraded"],
      ["hard", "upgraded"],
      ["carpet", "upgraded"],
      ["hard", "standard"],
      ["carpet", "standard"],
    ]);
    expect(flooring.every((p) => p.unit === "sf")).toBe(true);
  });

  it("splits trim above grade and basement", () => {
    const trim = forCode(partsFor(), "trim");
    expect(trim.map((p) => [p.variant, p.tier, p.area])).toEqual([
      ["aboveGrade", "upgraded", "house"],
      ["basement", "standard", "basement"],
    ]);
  });

  it("splits fixtures by area and omits nothing that has a quantity", () => {
    const fixtures = forCode(partsFor(), "fixtures");
    expect(fixtures.map((p) => [p.variant, p.tier, p.area, p.quantity, p.unit])).toEqual([
      ["kitchen", "luxury", "kitchen", 1, "ea"],
      ["primaryBath", "upgraded", "primaryBath", 1, "ea"],
      ["fullBath", "upgraded", "house", 2, "ea"],
      ["halfBath", "upgraded", "house", 1, "ea"],
    ]);
  });

  it("takes supervision quantity from the build months", () => {
    const supervision = partsFor(house(), 9).find((p) => p.code === "supervision");
    expect(supervision).toEqual({ code: "supervision", variant: "month", tier: null, quantity: 9, unit: "mo" });
    expect(partsFor(house(), 14).find((p) => p.code === "supervision")?.quantity).toBe(14);
  });

  it("emits lump-sum soft costs with no tier", () => {
    const parts = partsFor();
    for (const code of ["plans", "permits", "surveySoils"] as const) {
      expect(forCode(parts, code)).toEqual([{ code, variant: "ls", tier: null, quantity: 1, unit: "ls" }]);
    }
  });

  it("takes every quantity from the matching Q value", () => {
    const h = house();
    const q = quantitiesFor(h);
    const parts = linePartsFor(q, h, 9);
    const one = (code: CostCodeId, variant: string): LinePart => {
      const found = parts.find((p) => p.code === code && p.variant === variant);
      if (!found) throw new Error(`no ${code}/${variant} part`);
      return found;
    };
    expect(one("excavation", "base")).toMatchObject({ quantity: q.excavationYd3.value, unit: "yd3", tier: null });
    expect(one("utilities", "connection")).toMatchObject({ quantity: q.utilityConnections.value, unit: "ea" });
    expect(one("foundation", "base")).toMatchObject({ quantity: q.foundationLf.value, unit: "lf" });
    expect(one("framing", "base")).toMatchObject({ quantity: q.framingSf.value, unit: "sf" });
    expect(one("roofing", "base")).toMatchObject({ quantity: q.roofSquares.value, unit: "sq" });
    expect(one("windows", "window")).toMatchObject({ quantity: q.windowCount.value, unit: "ea", tier: "upgraded" });
    expect(one("cladding", "stone")).toMatchObject({ quantity: q.cladding.stone.value, unit: "sf", tier: null });
    expect(one("cladding", "stucco").quantity).toBe(q.cladding.stucco.value);
    expect(one("cladding", "boardBatten").quantity).toBe(q.cladding.boardBatten.value);
    expect(one("insulation", "base").quantity).toBe(q.insulatedEnvelopeSf.value);
    expect(one("plumbing", "fixture")).toMatchObject({ quantity: q.plumbingFixtures.value, unit: "ea" });
    expect(one("electrical", "base")).toMatchObject({ quantity: q.conditionedSf.value, unit: "sf", tier: "upgraded" });
    expect(one("hvac", "ton")).toMatchObject({ quantity: q.hvacTons.value, unit: "ton" });
    expect(one("drywall", "base").quantity).toBe(q.drywallSf.value);
    expect(one("paint", "base").quantity).toBe(q.paintSf.value);
    expect(one("garageDoors", "double")).toMatchObject({ quantity: q.garageDoors.double.value, unit: "ea" });
    expect(one("garageDoors", "single").quantity).toBe(q.garageDoors.single.value);
    expect(one("flatwork", "base").quantity).toBe(q.flatworkSf.value);
    expect(one("landscaping", "allowance")).toMatchObject({
      quantity: q.landscapedSf.value,
      unit: "sf",
      tier: "upgraded",
    });
    expect(one("landscaping", "fence")).toMatchObject({ quantity: q.fenceLf.value, unit: "lf", tier: null });
    expect(one("cleaning", "base").quantity).toBe(q.finishedSf.value);
    expect(one("fireplaces", "unit")).toMatchObject({ quantity: q.fireplaces.value, unit: "ea", tier: "upgraded" });
    expect(one("patio", "base")).toMatchObject({ quantity: q.coveredPatioSf.value, unit: "sf" });
    expect(forCode(parts, "cabinets").map((p) => p.quantity)).toEqual([
      q.cabinetLf.kitchen.value,
      q.cabinetLf.primaryBath.value,
      q.cabinetLf.rest.value,
    ]);
  });

  it("omits parts with a zero quantity and the codes left empty", () => {
    const parts = partsFor();
    expect(parts.every((p) => p.quantity !== 0)).toBe(true);
    expect(parts.some((p) => p.code === "garageDoors" && p.variant === "rv")).toBe(false);
    expect(parts.some((p) => p.code === "cladding" && p.variant === "fiberCement")).toBe(false);
    expect(parts.some((p) => p.code === "adu" || p.code === "pool")).toBe(false);
  });

  it("drops fireplaces and patio when the house has none", () => {
    const h = house();
    h.rooms.fireplaces = 0;
    h.outside.coveredPatioSf = 0;
    const parts = partsFor(h);
    expect(new Set(parts.map((p) => p.code)).size).toBe(25);
    expect(parts.some((p) => p.code === "fireplaces" || p.code === "patio")).toBe(false);
  });

  it("follows the order of the cost codes", () => {
    const order = COST_CODES.map((c) => c.id);
    const indexes = partsFor().map((p) => order.indexOf(p.code));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("prices landscaping at the landscaping tier, not the house tier", () => {
    const h = house();
    h.outside.landscapingTier = "luxury";
    const allowance = forCode(partsFor(h), "landscaping").find((p) => p.variant === "allowance");
    expect(allowance?.tier).toBe("luxury");
    expect(allowance?.area).toBeUndefined();
  });

  it("leaves area unset on parts with no tier", () => {
    const parts = partsFor();
    expect(parts.filter((p) => p.tier === null).every((p) => p.area === undefined)).toBe(true);
  });
});

describe("linePartsFor with an ADU or pool", () => {
  it("adds one lump-sum part for a basement ADU", () => {
    const h = house();
    h.adu = { type: "basement" };
    expect(forCode(partsFor(h), "adu")).toEqual([
      { code: "adu", variant: "basement", tier: null, quantity: 1, unit: "ls" },
    ]);
  });

  it("adds one lump-sum part for a detached ADU", () => {
    const h = house();
    h.adu = { type: "detached", finishedSf: 800 };
    expect(forCode(partsFor(h), "adu").map((p) => p.variant)).toEqual(["detached"]);
  });

  it("adds the type, spa, and safety parts for a gunite pool with a spa", () => {
    const h = house();
    h.pool = { type: "gunite", spa: true, heated: false };
    const pool = forCode(partsFor(h), "pool");
    expect(pool.map((p) => p.variant)).toEqual(["gunite", "spa", "safety"]);
    expect(pool.every((p) => p.tier === null && p.quantity === 1 && p.unit === "ls")).toBe(true);
  });

  it("adds a heater for a heated fiberglass pool", () => {
    const h = house();
    h.pool = { type: "fiberglass", spa: false, heated: true };
    expect(forCode(partsFor(h), "pool").map((p) => p.variant)).toEqual(["fiberglass", "heater", "safety"]);
  });

  it("adds every pool part when the pool has a spa and a heater", () => {
    const h = house();
    h.pool = { type: "gunite", spa: true, heated: true };
    expect(forCode(partsFor(h), "pool").map((p) => p.variant)).toEqual(["gunite", "spa", "heater", "safety"]);
  });
});

describe("resolvePrice", () => {
  const part: LinePart = { code: "framing", variant: "base", tier: null, quantity: 4000, unit: "sf" };
  const luxuryPart: LinePart = {
    code: "cabinets",
    variant: "lf",
    tier: "luxury",
    quantity: 36,
    unit: "lf",
    area: "kitchen",
  };

  const def = (over: Partial<DefaultPrice> = {}): DefaultPrice => ({
    code: "framing",
    variant: "base",
    tier: null,
    region: "utah-north",
    unitPriceCents: 1000,
    unit: "sf",
    asOf: "2026-01-15",
    verified: false,
    sourceNote: "starter",
    ...over,
  });
  const entry = (over: Partial<PriceBookEntry> = {}): PriceBookEntry => ({
    code: "framing",
    variant: "base",
    tier: null,
    unitPriceCents: 1200,
    unit: "sf",
    asOf: "2026-03-01",
    ...over,
  });
  const book = (defaults: DefaultPrice[], priceBook: PriceBookEntry[] = []): CostBookView => ({
    defaults,
    priceBook,
  });

  it("returns a default when the price book has nothing", () => {
    expect(resolvePrice(part, book([def()]), "utah-north")).toEqual({
      unitPriceCents: 1000,
      source: "default",
      asOf: "2026-01-15",
    });
  });

  it("prefers a price book entry over a default", () => {
    expect(resolvePrice(part, book([def()], [entry()]), "utah-north")).toEqual({
      unitPriceCents: 1200,
      source: "priceBook",
      asOf: "2026-03-01",
    });
  });

  it("prefers a price book entry even when the default has an exact tier match", () => {
    const cabinetsDefault = def({ code: "cabinets", variant: "lf", tier: "luxury", unit: "lf" });
    const cabinetsEntry = entry({ code: "cabinets", variant: "lf", tier: null, unit: "lf" });
    const resolved = resolvePrice(luxuryPart, book([cabinetsDefault], [cabinetsEntry]), "utah-north");
    expect(resolved?.source).toBe("priceBook");
  });

  it("prefers an exact tier match over a tier-less entry within the price book", () => {
    const nullEntry = entry({ code: "cabinets", variant: "lf", tier: null, unitPriceCents: 100, unit: "lf" });
    const luxuryEntry = entry({ code: "cabinets", variant: "lf", tier: "luxury", unitPriceCents: 900, unit: "lf" });
    expect(resolvePrice(luxuryPart, book([], [nullEntry, luxuryEntry]), "utah-north")?.unitPriceCents).toBe(900);
    expect(resolvePrice(luxuryPart, book([], [luxuryEntry, nullEntry]), "utah-north")?.unitPriceCents).toBe(900);
  });

  it("prefers an exact tier match over a tier-less default", () => {
    const nullDefault = def({ code: "cabinets", variant: "lf", tier: null, unitPriceCents: 100, unit: "lf" });
    const luxuryDefault = def({ code: "cabinets", variant: "lf", tier: "luxury", unitPriceCents: 900, unit: "lf" });
    expect(resolvePrice(luxuryPart, book([nullDefault, luxuryDefault]), "utah-north")?.unitPriceCents).toBe(900);
  });

  it("falls back to a tier-less entry when no exact tier exists", () => {
    const nullEntry = entry({ code: "cabinets", variant: "lf", tier: null, unitPriceCents: 100, unit: "lf" });
    const standardEntry = entry({ code: "cabinets", variant: "lf", tier: "standard", unitPriceCents: 50, unit: "lf" });
    expect(resolvePrice(luxuryPart, book([], [standardEntry, nullEntry]), "utah-north")?.unitPriceCents).toBe(100);
  });

  it("does not match an entry with a tier when the part has no tier", () => {
    const tiered = entry({ tier: "luxury" });
    expect(resolvePrice(part, book([], [tiered]), "utah-north")).toBeNull();
  });

  it("falls back to a default when the best price book entry is for another variant", () => {
    const other = entry({ variant: "other" });
    expect(resolvePrice(part, book([def()], [other]), "utah-north")?.source).toBe("default");
  });

  it("ignores a default for another region", () => {
    const south = def({ region: "utah-south" });
    expect(resolvePrice(part, book([south]), "utah-north")).toBeNull();
    expect(resolvePrice(part, book([south]), "utah-south")?.unitPriceCents).toBe(1000);
  });

  it("picks the default in the requested region when several regions exist", () => {
    const south = def({ region: "utah-south", unitPriceCents: 5 });
    const north = def({ region: "utah-north", unitPriceCents: 7 });
    expect(resolvePrice(part, book([south, north]), "utah-north")?.unitPriceCents).toBe(7);
  });

  it("matches on exact code and variant", () => {
    expect(resolvePrice(part, book([def({ code: "roofing" })]), "utah-north")).toBeNull();
    expect(resolvePrice(part, book([def({ variant: "other" })]), "utah-north")).toBeNull();
  });

  it("takes the first entry in array order when several tie", () => {
    const first = entry({ unitPriceCents: 111 });
    const second = entry({ unitPriceCents: 222 });
    expect(resolvePrice(part, book([], [first, second]), "utah-north")?.unitPriceCents).toBe(111);
    const d1 = def({ unitPriceCents: 3 });
    const d2 = def({ unitPriceCents: 4 });
    expect(resolvePrice(part, book([d1, d2]), "utah-north")?.unitPriceCents).toBe(3);
  });

  it("returns null when nothing matches", () => {
    expect(resolvePrice(part, book([]), "utah-north")).toBeNull();
  });
});

describe("uniformBookFor", () => {
  it("prices every part of the sample house", () => {
    const parts = partsFor();
    const view = uniformBookFor(parts, "utah-north", 12_345, "2026-02-01");
    for (const p of parts) {
      expect(resolvePrice(p, view, "utah-north")).toEqual({
        unitPriceCents: 12_345,
        source: "default",
        asOf: "2026-02-01",
      });
    }
    expect(view.priceBook).toEqual([]);
  });

  it("creates one verified default per distinct price key, copying the unit", () => {
    const parts: LinePart[] = [
      { code: "framing", variant: "base", tier: null, quantity: 100, unit: "sf" },
      { code: "framing", variant: "base", tier: null, quantity: 50, unit: "sf" },
      { code: "cabinets", variant: "lf", tier: "luxury", quantity: 36, unit: "lf", area: "kitchen" },
      { code: "cabinets", variant: "lf", tier: "upgraded", quantity: 30, unit: "lf", area: "primaryBath" },
    ];
    const view = uniformBookFor(parts, "utah-south", 500, "2026-05-05");
    expect(view.defaults).toEqual([
      {
        code: "framing",
        variant: "base",
        tier: null,
        region: "utah-south",
        unitPriceCents: 500,
        unit: "sf",
        asOf: "2026-05-05",
        verified: true,
        sourceNote: "test",
      },
      {
        code: "cabinets",
        variant: "lf",
        tier: "luxury",
        region: "utah-south",
        unitPriceCents: 500,
        unit: "lf",
        asOf: "2026-05-05",
        verified: true,
        sourceNote: "test",
      },
      {
        code: "cabinets",
        variant: "lf",
        tier: "upgraded",
        region: "utah-south",
        unitPriceCents: 500,
        unit: "lf",
        asOf: "2026-05-05",
        verified: true,
        sourceNote: "test",
      },
    ]);
  });

  it("is empty for no parts", () => {
    expect(uniformBookFor([], "utah-north", 1, "2026-01-01")).toEqual({ defaults: [], priceBook: [] });
  });
});
