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
