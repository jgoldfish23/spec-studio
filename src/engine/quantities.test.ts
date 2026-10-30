import { describe, expect, it } from "vitest";
import { SAMPLE_HOUSE, SAMPLE_LOT } from "./__fixtures__/sampleHouse";
import type { HouseModel } from "./house";
import {
  computeQuantities,
  DEFAULT_QUANTITY_RULES,
  type Q,
  type QuantityRules,
  type Quantities,
} from "./quantities";
import type { Result } from "./result";

/** `Quantities` with every `Q` replaced by its numeric value. */
type Values<T> = T extends Q ? number : { [K in keyof T]: Values<T[K]> };

const isQ = (x: unknown): x is Q => typeof x === "object" && x !== null && "value" in x && "explain" in x;

function values<T extends object>(group: T): Values<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(group)) {
    out[key] = isQ(entry) ? entry.value : values(entry as object);
  }
  return out as Values<T>;
}

function unwrap<T>(r: Result<T>): T {
  if (r.status !== "ok") throw new Error(`expected ok, got incomplete: ${JSON.stringify(r.missing)}`);
  return r.value;
}

const house = (): HouseModel => structuredClone(SAMPLE_HOUSE);
const compute = (h: HouseModel, rules: QuantityRules = DEFAULT_QUANTITY_RULES): Quantities =>
  unwrap(computeQuantities(h, SAMPLE_LOT, rules));

describe("computeQuantities on the sample house", () => {
  it("produces the expected quantity for every rule", () => {
    const q = compute(SAMPLE_HOUSE);
    expect(values(q)).toMatchObject({
      finishedSf: 3800,
      conditionedSf: 4400,
      perimeterLf: 190,
      foundationLf: 214,
      garageSf: 768,
      framingSf: 4568,
      excavationYd3: 880,
      roofSquares: 40,
      exteriorWallNetSf: 2600,
      windowCount: 26,
      insulatedEnvelopeSf: 4272,
      drywallSf: 15370,
      paintSf: 15370,
      plumbingFixtures: 22,
      hvacTons: 5,
      utilityConnections: 4,
      landscapedSf: 9507,
      fenceLf: 240,
      flatworkSf: 1500,
      coveredPatioSf: 400,
      fireplaces: 1,
      cladding: { stone: 650, stucco: 1300, boardBatten: 650, fiberCement: 0 },
      cabinetLf: { kitchen: 36, primaryBath: 5, rest: 19 },
      flooring: { tile: 265, hardAbove: 1161, carpetAbove: 774, hardBasement: 480, carpetBasement: 1120 },
      trimSf: { aboveGrade: 2200, basement: 1600 },
      fixtureSets: { kitchen: 1, primaryBath: 1, otherFullBaths: 2, halfBaths: 1 },
      garageDoors: { double: 1, single: 1, rv: 0 },
    });
    expect(q.foundationLf.explain).toContain("1.125");
  });

  it("does not modify the house or the lot it is given", () => {
    const h = house();
    const before = structuredClone(h);
    compute(h);
    expect(h).toEqual(before);
  });

  it("gives every quantity a non-empty explanation", () => {
    const explains: string[] = [];
    const walk = (node: object): void => {
      for (const entry of Object.values(node)) {
        if (isQ(entry)) explains.push(entry.explain);
        else walk(entry as object);
      }
    };
    walk(compute(SAMPLE_HOUSE));
    expect(explains).toHaveLength(21 + 4 + 3 + 5 + 2 + 4 + 3);
    for (const explain of explains) expect(explain.trim()).not.toBe("");
  });

  it("names its inputs and coefficients in the explanation", () => {
    const q = compute(SAMPLE_HOUSE);
    expect(q.foundationLf.explain).toBe("190 LF perimeter × 1.125 moderate complexity");
    expect(q.cabinetLf.kitchen.explain).toContain("luxury");
    expect(q.utilityConnections.explain).toContain("water");
  });
});

describe("computeQuantities variants", () => {
  it("with no basement, excavates the footprint slab and drops the basement terms", () => {
    const h = house();
    delete h.levels.basement;
    const q = values(compute(h));
    expect(q.excavationYd3).toBe(244);
    expect(q.windowCount).toBe(22);
    expect(q.flooring.hardBasement).toBe(0);
    expect(q.flooring.carpetBasement).toBe(0);
    expect(q.trimSf).toEqual({ aboveGrade: 2200, basement: 0 });
    expect(q.finishedSf).toBe(2200);
    expect(q.conditionedSf).toBe(2200);
    expect(q.framingSf).toBe(2200 + 768);
  });

  it("with an upper level, adds a storey of wall and conditioned area", () => {
    const h = house();
    h.levels.upper = { finishedSf: 1200, unfinishedSf: 0, ceilingFt: 9 };
    const q = values(compute(h));
    expect(q.exteriorWallNetSf).toBe(4483);
    expect(q.hvacTons).toBe(6.5);
    expect(q.finishedSf).toBe(5000);
    expect(q.trimSf.aboveGrade).toBe(3400);
    expect(q.windowCount).toBe(34 + 4);
    expect(q.framingSf).toBe(2200 + 1200 + 1600 + 768);
  });

  it("with an RV bay, adds the RV bay area and an RV door", () => {
    const h = house();
    h.garage.rvBay = true;
    const q = values(compute(h));
    expect(q.garageSf).toBe(1248);
    expect(q.garageDoors.rv).toBe(1);
    expect(q.garageDoors.double).toBe(1);
    expect(q.garageDoors.single).toBe(1);
  });

  it("does not add the RV bay to the garage wall", () => {
    const h = house();
    h.garage.rvBay = true;
    expect(values(compute(h)).exteriorWallNetSf).toBe(2600);
  });

  it.each([
    [0, { double: 0, single: 0 }],
    [1, { double: 1, single: 0 }],
    [2, { double: 1, single: 0 }],
    [3, { double: 1, single: 1 }],
    [4, { double: 1, single: 2 }],
    [5, { double: 1, single: 3 }],
  ])("with %i garage bays, fits the right doors", (bays, doors) => {
    const h = house();
    h.garage.bays = bays;
    const q = values(compute(h));
    expect(q.garageDoors).toEqual({ ...doors, rv: 0 });
    expect(q.garageSf).toBe(256 * bays);
  });

  it("with no garage, adds no garage wall", () => {
    const h = house();
    h.garage.bays = 0;
    // 214 LF × 11 ft × 0.88 openings
    expect(values(compute(h)).exteriorWallNetSf).toBe(2072);
  });

  it("with an ADU, adds fixtures and a second kitchen's cabinets", () => {
    const h = house();
    h.adu = { type: "detached", finishedSf: 800 };
    const q = values(compute(h));
    expect(q.plumbingFixtures).toBe(28);
    expect(q.cabinetLf.rest).toBe(31);
  });

  it("takes the kitchen cabinet run and the hard-surface share from the tier", () => {
    const h = house();
    h.finishes.houseTier = "standard";
    h.finishes.overrides = {};
    const q = values(compute(h));
    expect(q.cabinetLf.kitchen).toBe(25);
    // 2200 above grade − 265 tile = 1935 × 45%
    expect(q.flooring.hardAbove).toBe(871);
    expect(q.flooring.carpetAbove).toBe(1064);

    h.finishes.houseTier = "luxury";
    const luxury = values(compute(h));
    expect(luxury.cabinetLf.kitchen).toBe(36);
    expect(luxury.flooring.hardAbove).toBe(1355);
    expect(luxury.flooring.carpetAbove).toBe(580);
  });

  it("uses the kitchen override rather than the house tier for the kitchen", () => {
    const h = house();
    h.finishes.houseTier = "luxury";
    h.finishes.overrides = { kitchen: "standard" };
    expect(values(compute(h)).cabinetLf.kitchen).toBe(25);
  });

  it("counts bathrooms into fixtures, vanities and tile", () => {
    const h = house();
    h.rooms.fullBaths = 0;
    h.rooms.halfBaths = 2;
    const q = values(compute(h));
    expect(q.fixtureSets).toEqual({ kitchen: 1, primaryBath: 0, otherFullBaths: 0, halfBaths: 2 });
    expect(q.cabinetLf).toEqual({ kitchen: 36, primaryBath: 0, rest: 6 + 6 });
    expect(q.flooring.tile).toBe(25 * 2 + 60);
    // 4 × 0 + 2 × 2 + 3 + 2 + 2 + 1
    expect(q.plumbingFixtures).toBe(12);
  });

  it("counts only utilities that need a connection", () => {
    const lot = structuredClone(SAMPLE_LOT);
    lot.utilities = {
      water: "available",
      sewer: "needsConnection",
      gas: "unknown",
      power: "available",
      secondaryWater: "needsConnection",
    };
    const q = unwrap(computeQuantities(SAMPLE_HOUSE, lot, DEFAULT_QUANTITY_RULES));
    expect(q.utilityConnections.value).toBe(2);
  });

  it("never lets landscaping go negative on a lot the house fills", () => {
    const lot = structuredClone(SAMPLE_LOT);
    lot.acres = 0.1;
    const q = unwrap(computeQuantities(SAMPLE_HOUSE, lot, DEFAULT_QUANTITY_RULES));
    expect(q.landscapedSf.value).toBe(0);
  });

  it("applies edited rules rather than the defaults", () => {
    const rules = structuredClone(DEFAULT_QUANTITY_RULES);
    rules.foundationComplexity.moderate = 1.5;
    rules.sfPerAcre = 40_000;
    const q = unwrap(computeQuantities(SAMPLE_HOUSE, SAMPLE_LOT, rules));
    expect(q.foundationLf.value).toBe(285);
    expect(q.foundationLf.explain).toContain("1.5");
    expect(q.landscapedSf.value).toBe(13_200 - 2200 - 768 - 1500 - 400);
  });
});

describe("computeQuantities on an invalid house", () => {
  it("is incomplete, with one house-step item per validation issue", () => {
    const h = house();
    h.levels.basement = { totalSf: 2200, finishedSf: 2300, walkout: false };
    h.exterior = { stonePct: 25, stuccoPct: 40, boardBattenPct: 25, fiberCementPct: 0 };
    const r = computeQuantities(h, SAMPLE_LOT, DEFAULT_QUANTITY_RULES);
    expect(r.status).toBe("incomplete");
    if (r.status !== "incomplete") return;
    expect(r.missing).toHaveLength(2);
    for (const item of r.missing) {
      expect(item.code).toBe("invalidHouse");
      expect(item.step).toBe("house");
    }
    expect(r.missing.map((m) => m.message.split(":")[0])).toEqual(["levels.basement.finishedSf", "exterior"]);
    expect(r.missing[1]?.message).toMatch(/^exterior: .*100/);
  });

  it("is incomplete for a house that fails the schema", () => {
    const h = house();
    h.garage.bays = 2.5;
    expect(computeQuantities(h, SAMPLE_LOT, DEFAULT_QUANTITY_RULES).status).toBe("incomplete");
  });
});
