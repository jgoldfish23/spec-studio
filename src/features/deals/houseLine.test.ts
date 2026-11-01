import { describe, expect, it } from "vitest";
import { newDealInputs } from "../../data/newDeal";
import { sampleDealInputs } from "../../data/sample";
import { DEFAULT_RULES } from "@engine";
import { houseLine } from "./houseLine";

const settings = { rules: DEFAULT_RULES, contingencyPct: 0.05 };

describe("houseLine", () => {
  it("describes the sample: finished area, style, basement and garage", () => {
    expect(houseLine(sampleDealInputs().house)).toBe("3,800 sf rambler · finished basement · 3-car");
  });

  it("describes a blank new deal", () => {
    expect(houseLine(newDealInputs("2026-10-31", settings).house)).toBe("2,000 sf rambler · unfinished basement · 3-car");
  });

  it("adds the upper level to the area and names the other styles", () => {
    const house = sampleDealInputs().house;
    house.style = "twoStory";
    house.levels.upper = { finishedSf: 1500, unfinishedSf: 0, ceilingFt: 9 };
    house.levels.basement = { totalSf: 2200, finishedSf: 800, walkout: false };
    house.garage.bays = 2;
    expect(houseLine(house)).toBe("4,500 sf two-story · finished basement · 2-car");
    house.style = "multiLevel";
    expect(houseLine(house)).toBe("4,500 sf multi-level · finished basement · 2-car");
  });

  it("leaves out a missing basement and a garage with no bays, and mentions an ADU", () => {
    const house = sampleDealInputs().house;
    delete house.levels.basement;
    house.garage.bays = 0;
    house.adu = { type: "basement" };
    expect(houseLine(house)).toBe("2,200 sf rambler · basement ADU");
    house.adu = { type: "detached" };
    expect(houseLine(house)).toBe("2,200 sf rambler · detached ADU");
  });

  it("drops each part that is missing, not a number or not a known name", () => {
    const house: Record<string, unknown> = structuredClone(sampleDealInputs().house);
    house.style = "castle";
    expect(houseLine(house)).toBe("3,800 sf · finished basement · 3-car");

    const levels = house.levels as { main: { finishedSf: unknown }; basement: { finishedSf: unknown } };
    levels.main.finishedSf = Number.NaN;
    levels.basement.finishedSf = "lots";
    expect(houseLine(house)).toBe("3-car");
    house.garage = { bays: Number.POSITIVE_INFINITY };
    expect(houseLine(house)).toBe("—");
  });

  it("shows a dash when nothing is usable", () => {
    expect(houseLine(undefined)).toBe("—");
    expect(houseLine(null)).toBe("—");
    expect(houseLine("a house")).toBe("—");
    expect(houseLine({})).toBe("—");
    expect(houseLine({ levels: null, garage: [], style: 7 })).toBe("—");
  });
});
