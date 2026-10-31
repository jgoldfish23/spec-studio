import { describe, expect, it } from "vitest";
import { SAMPLE_HOUSE } from "./__fixtures__/sampleHouse";
import { HouseModelSchema, tierFor, validateHouse, type HouseModel } from "./house";

const clone = (): HouseModel => structuredClone(SAMPLE_HOUSE);
const paths = (h: unknown): string[] => validateHouse(h).map((i) => i.path);

describe("validateHouse", () => {
  it("accepts the sample house", () => {
    expect(validateHouse(SAMPLE_HOUSE)).toEqual([]);
  });

  it("accepts a house with an upper level, a basement ADU and a pool", () => {
    const h = clone();
    h.style = "twoStory";
    h.levels.upper = { finishedSf: 1200, unfinishedSf: 200, ceilingFt: 9 };
    h.adu = { type: "basement", finishedSf: 800 };
    h.pool = { type: "gunite", spa: true, heated: true };
    h.stockPlanRef = "Drafter plan 14B";
    expect(validateHouse(h)).toEqual([]);
  });

  it("rejects a basement whose finished area exceeds its total", () => {
    const bad = clone();
    bad.levels.basement!.finishedSf = 2300;
    expect(paths(bad)).toContain("levels.basement.finishedSf");
  });

  it("accepts a basement that is entirely finished", () => {
    const h = clone();
    h.levels.basement!.finishedSf = 2200;
    expect(validateHouse(h)).toEqual([]);
  });

  it("rejects exterior percentages that do not sum to 100", () => {
    const bad = clone();
    bad.exterior = { stonePct: 25, stuccoPct: 40, boardBattenPct: 25, fiberCementPct: 0 };
    expect(paths(bad)).toEqual(["exterior"]);
  });

  it("tolerates floating-point noise when exterior percentages sum to 100", () => {
    const h = clone();
    h.exterior = { stonePct: 33.3, stuccoPct: 33.3, boardBattenPct: 33.4, fiberCementPct: 0 };
    expect(validateHouse(h)).toEqual([]);
  });

  it("rejects a footprint under half of the main level", () => {
    const bad = clone();
    bad.footprint = { widthFt: 30, depthFt: 30, complexity: "simple" };
    expect(paths(bad)).toEqual(["footprint"]);
  });

  it("counts unfinished main-level area toward the footprint rule", () => {
    const h = clone();
    h.levels.main = { finishedSf: 1000, unfinishedSf: 1000, ceilingFt: 10 };
    h.footprint = { widthFt: 40, depthFt: 25, complexity: "simple" };
    expect(validateHouse(h)).toEqual([]);
    h.footprint = { widthFt: 40, depthFt: 24, complexity: "simple" };
    expect(paths(h)).toEqual(["footprint"]);
  });

  it("rejects a basement ADU when there is no basement", () => {
    const bad = clone();
    delete bad.levels.basement;
    bad.adu = { type: "basement", finishedSf: 700 };
    expect(paths(bad)).toEqual(["adu.type"]);
  });

  it("allows a detached ADU without a basement", () => {
    const h = clone();
    delete h.levels.basement;
    h.adu = { type: "detached", finishedSf: 700 };
    expect(validateHouse(h)).toEqual([]);
  });

  it("rejects a negative count", () => {
    const bad = clone();
    bad.rooms.bedrooms = -1;
    expect(paths(bad)).toContain("rooms.bedrooms");
  });

  it("rejects fractional counts", () => {
    const bad = clone();
    bad.garage.bays = 2.5;
    expect(paths(bad)).toContain("garage.bays");
  });

  it("rejects negative areas and dimensions", () => {
    const bad = clone();
    bad.levels.main.unfinishedSf = -1;
    bad.footprint.widthFt = -55;
    bad.outside.fenceLf = -10;
    expect(paths(bad)).toEqual(
      expect.arrayContaining(["levels.main.unfinishedSf", "footprint.widthFt", "outside.fenceLf"]),
    );
  });

  it("rejects an exterior percentage above 100 or below 0", () => {
    const bad = clone();
    bad.exterior = { stonePct: 150, stuccoPct: -50, boardBattenPct: 0, fiberCementPct: 0 };
    expect(paths(bad)).toEqual(expect.arrayContaining(["exterior.stonePct", "exterior.stuccoPct"]));
  });

  it("rejects a wrong schema version, unknown enum values and a missing section", () => {
    const bad: Record<string, unknown> = structuredClone(SAMPLE_HOUSE);
    bad.schemaVersion = 2;
    bad.style = "castle";
    delete bad.roof;
    expect(paths(bad)).toEqual(expect.arrayContaining(["schemaVersion", "style", "roof"]));
  });

  it("returns only schema issues when the schema check fails", () => {
    const bad = clone();
    bad.rooms.bedrooms = -1;
    bad.levels.basement!.finishedSf = 2300;
    expect(paths(bad)).toEqual(["rooms.bedrooms"]);
  });

  it("reports every blocking rule that is broken, in a stable order", () => {
    const bad = clone();
    bad.levels.basement!.finishedSf = 2300;
    bad.exterior.stonePct = 0;
    bad.footprint = { widthFt: 30, depthFt: 30, complexity: "simple" };
    expect(paths(bad)).toEqual(["levels.basement.finishedSf", "exterior", "footprint"]);
  });

  it("gives each issue a human-readable message", () => {
    const bad = clone();
    bad.levels.basement!.finishedSf = 2300;
    const [issue] = validateHouse(bad);
    expect(issue?.message).toMatch(/basement/i);
  });

  it.each([null, undefined, 42, "house", []])("rejects non-object input %j", (input) => {
    expect(validateHouse(input)).not.toEqual([]);
  });
});

/** One numeric house field with an upper limit; `set` writes a value into a house. */
type HouseBound = { path: string; max: number; set: (h: HouseModel, v: number) => void };

const UPPER = { finishedSf: 1200, unfinishedSf: 200, ceilingFt: 9 };

const AREA_BOUNDS: HouseBound[] = [
  { path: "levels.main.finishedSf", max: 50_000, set: (h, v) => void (h.levels.main.finishedSf = v) },
  { path: "levels.main.unfinishedSf", max: 50_000, set: (h, v) => void (h.levels.main.unfinishedSf = v) },
  { path: "levels.upper.finishedSf", max: 50_000, set: (h, v) => void (h.levels.upper = { ...UPPER, finishedSf: v }) },
  {
    path: "levels.upper.unfinishedSf",
    max: 50_000,
    set: (h, v) => void (h.levels.upper = { ...UPPER, unfinishedSf: v }),
  },
  { path: "levels.basement.totalSf", max: 50_000, set: (h, v) => void (h.levels.basement!.totalSf = v) },
  { path: "levels.basement.finishedSf", max: 50_000, set: (h, v) => void (h.levels.basement!.finishedSf = v) },
  { path: "adu.finishedSf", max: 50_000, set: (h, v) => void (h.adu = { type: "detached", finishedSf: v }) },
  { path: "outside.coveredPatioSf", max: 50_000, set: (h, v) => void (h.outside.coveredPatioSf = v) },
  { path: "outside.flatworkSf", max: 50_000, set: (h, v) => void (h.outside.flatworkSf = v) },
  { path: "outside.fenceLf", max: 10_000, set: (h, v) => void (h.outside.fenceLf = v) },
  { path: "footprint.widthFt", max: 50_000, set: (h, v) => void (h.footprint.widthFt = v) },
  { path: "footprint.depthFt", max: 50_000, set: (h, v) => void (h.footprint.depthFt = v) },
  { path: "levels.main.ceilingFt", max: 30, set: (h, v) => void (h.levels.main.ceilingFt = v) },
  { path: "levels.upper.ceilingFt", max: 30, set: (h, v) => void (h.levels.upper = { ...UPPER, ceilingFt: v }) },
  { path: "roof.pitchPer12", max: 24, set: (h, v) => void (h.roof.pitchPer12 = v) },
];

const COUNT_BOUNDS: HouseBound[] = [
  { path: "garage.bays", max: 10, set: (h, v) => void (h.garage.bays = v) },
  { path: "rooms.bedrooms", max: 20, set: (h, v) => void (h.rooms.bedrooms = v) },
  { path: "rooms.fullBaths", max: 20, set: (h, v) => void (h.rooms.fullBaths = v) },
  { path: "rooms.halfBaths", max: 20, set: (h, v) => void (h.rooms.halfBaths = v) },
  { path: "rooms.fireplaces", max: 20, set: (h, v) => void (h.rooms.fireplaces = v) },
];

/**
 * A house in which a field at its limit breaks no blocking rule: a footprint big enough for any main level
 * and a basement big enough for any finished area.
 */
function roomyHouse(): HouseModel {
  const h = clone();
  h.footprint = { widthFt: 50_000, depthFt: 50_000, complexity: "simple" };
  h.levels.basement = { totalSf: 50_000, finishedSf: 1_600, walkout: false };
  return h;
}

describe("house upper bounds", () => {
  it.each([...AREA_BOUNDS, ...COUNT_BOUNDS])("accepts $path at $max", ({ max, set }) => {
    const h = roomyHouse();
    set(h, max);
    expect(validateHouse(h)).toEqual([]);
  });

  it.each([...AREA_BOUNDS, ...COUNT_BOUNDS])(
    "rejects $path just over $max with exactly one issue at that path",
    ({ path, max, set }) => {
      const h = roomyHouse();
      set(h, max + 1);
      expect(paths(h)).toEqual([path]);
    },
  );

  it.each([...AREA_BOUNDS, ...COUNT_BOUNDS])(
    "rejects $path far over $max with exactly one issue at that path",
    ({ path, max, set }) => {
      const h = roomyHouse();
      set(h, max * 1_000);
      expect(paths(h)).toEqual([path]);
    },
  );

  it.each(COUNT_BOUNDS)(
    "rejects a fractional $path that is also over the limit with exactly one issue",
    ({ path, max, set }) => {
      const h = roomyHouse();
      set(h, max + 0.5);
      expect(paths(h)).toEqual([path]);
    },
  );

  it("gives an over-limit value a message that names the limit", () => {
    const h = roomyHouse();
    h.rooms.bedrooms = 21;
    h.footprint.widthFt = 50_001;
    expect(validateHouse(h)).toEqual([
      { path: "footprint.widthFt", message: "Must be 50,000 or less" },
      { path: "rooms.bedrooms", message: "Must be 20 or less" },
    ]);
  });

  it("caps ceiling height at 30 ft and roof pitch at 24/12, so a typing slip is a message, not a house", () => {
    const h = clone();
    h.levels.main.ceilingFt = 60;
    h.roof.pitchPer12 = 30;
    expect(validateHouse(h)).toEqual([
      { path: "levels.main.ceilingFt", message: "Must be 30 or less" },
      { path: "roof.pitchPer12", message: "Must be 24 or less" },
    ]);
  });
});

describe("HouseModelSchema", () => {
  it("parses the sample house to an equal value", () => {
    expect(HouseModelSchema.parse(SAMPLE_HOUSE)).toEqual(SAMPLE_HOUSE);
  });
});

describe("tierFor", () => {
  it("uses an area override when present", () => {
    expect(tierFor(SAMPLE_HOUSE, "kitchen")).toBe("luxury");
    expect(tierFor(SAMPLE_HOUSE, "basement")).toBe("standard");
  });

  it("falls back to the house tier when an area has no override", () => {
    expect(tierFor(SAMPLE_HOUSE, "primaryBath")).toBe("upgraded");
  });

  it("returns the house tier for the house itself", () => {
    expect(tierFor(SAMPLE_HOUSE, "house")).toBe("upgraded");
  });
});
