import { describe, expect, it } from "vitest";
import type { EstimateLine, EstimatePart, LinePart } from "@engine";
import {
  DIVISION_NAMES,
  DIVISION_ORDER,
  formatAsOf,
  formatQuantity,
  groupByDivision,
  quantityText,
  unitCostText,
  variantName,
} from "./lineFormat";
import { evaluated } from "../../testing/engineContext";

const takeoffPart = (over: Partial<LinePart> = {}): LinePart => ({
  code: "flooring",
  variant: "tile",
  tier: "upgraded",
  quantity: 265,
  unit: "sf",
  ...over,
});

const pricedPart = (over: Partial<EstimatePart> = {}): EstimatePart => ({
  ...takeoffPart(),
  unitPriceCents: 1300,
  totalCents: 344500,
  source: "default",
  asOf: "2026-10-30",
  stale: false,
  ...over,
});

const line = (over: Partial<EstimateLine> = {}): EstimateLine => ({
  code: "flooring",
  name: "Flooring",
  division: "interior",
  parts: [pricedPart()],
  takeoff: [takeoffPart()],
  totalCents: 344500,
  source: "default",
  stale: false,
  ...over,
});

describe("formatQuantity", () => {
  it("shows the quantity with its unit, grouped in thousands", () => {
    expect(formatQuantity(2200, "sf")).toBe("2,200 sf");
    expect(formatQuantity(880, "yd3")).toBe("880 yd³");
    expect(formatQuantity(9, "mo")).toBe("9 mo");
  });

  it("keeps up to two decimals and drops trailing zeros", () => {
    expect(formatQuantity(39.75, "sq")).toBe("39.75 sq");
    expect(formatQuantity(12.5, "lf")).toBe("12.5 lf");
    expect(formatQuantity(7.001, "lf")).toBe("7 lf");
  });

  it("shows a dash for a quantity that is not a number", () => {
    expect(formatQuantity(Number.NaN, "sf")).toBe("—");
    expect(formatQuantity(Number.POSITIVE_INFINITY, "sf")).toBe("—");
  });
});

describe("quantityText", () => {
  it("is the quantity and unit of a line with one part", () => {
    expect(quantityText(line())).toBe("265 sf");
  });

  it("counts the parts of a line with several", () => {
    const parts = [pricedPart(), pricedPart({ variant: "hard" }), pricedPart({ variant: "carpet" })];
    expect(quantityText(line({ parts, takeoff: parts }))).toBe("3 parts");
  });

  it("reads a bid line's quantity from its takeoff, since a bid line has no priced parts", () => {
    expect(quantityText(line({ source: "bid", parts: [], takeoff: [takeoffPart({ quantity: 46, unit: "lf" })] }))).toBe("46 lf");
    expect(quantityText(line({ source: "bid", parts: [], takeoff: [takeoffPart(), takeoffPart({ variant: "hard" })] }))).toBe("2 parts");
  });

  it("is a dash when there is no takeoff to show", () => {
    expect(quantityText(line({ source: "bid", parts: [], takeoff: [] }))).toBe("—");
  });
});

describe("unitCostText", () => {
  it("is the unit price, with cents, of a line with one part", () => {
    expect(unitCostText(line())).toBe("$13.00");
    expect(unitCostText(line({ parts: [pricedPart({ unitPriceCents: 2500 })] }))).toBe("$25.00");
  });

  it("is Mixed for a line with several parts", () => {
    expect(unitCostText(line({ parts: [pricedPart(), pricedPart({ variant: "hard" })] }))).toBe("Mixed");
  });

  it("is a dash on a bid line, which has no unit price", () => {
    expect(unitCostText(line({ source: "bid", parts: [] }))).toBe("—");
  });
});

describe("variantName", () => {
  it.each([
    ["boardBatten", "Board batten"],
    ["primaryBath", "Primary bath"],
    ["aboveGrade", "Above grade"],
    ["base", "Base"],
    ["ls", "Lump sum"],
  ])("writes %s as %s", (variant, expected) => {
    expect(variantName(variant)).toBe(expected);
  });

  it("is a dash for an empty variant", () => {
    expect(variantName("")).toBe("—");
  });
});

describe("formatAsOf", () => {
  it("writes a date as a short month, day and year", () => {
    expect(formatAsOf("2026-10-30")).toBe("Oct 30, 2026");
    expect(formatAsOf("2025-01-05")).toBe("Jan 5, 2025");
  });

  it("shows a dash for anything that is not a date", () => {
    expect(formatAsOf("")).toBe("—");
    expect(formatAsOf("2026-13-01")).toBe("—");
    expect(formatAsOf("soon")).toBe("—");
  });
});

describe("divisions", () => {
  it("names every division the engine has, in the order the cost codes first use them", () => {
    expect(DIVISION_ORDER).toEqual(["soft", "site", "structure", "envelope", "mep", "interior", "exteriorFinish", "general"]);
    expect(DIVISION_ORDER.map((division) => DIVISION_NAMES[division])).toEqual([
      "Soft costs",
      "Site",
      "Structure",
      "Envelope",
      "Plumbing, electrical & HVAC",
      "Interior",
      "Exterior finish",
      "General",
    ]);
  });

  it("groups the lines by division, in division order and keeping the lines' own order", async () => {
    const evaluation = await evaluated();
    if (evaluation.estimate.status !== "ok") throw new Error("the sample estimate is incomplete");
    const groups = groupByDivision(evaluation.estimate.value.lines);
    expect(groups.map((group) => group.division)).toEqual(DIVISION_ORDER);
    const interior = groups.find((group) => group.division === "interior");
    expect(interior?.lines.map((l) => l.code)).toEqual([
      "drywall",
      "trim",
      "cabinets",
      "flooring",
      "paint",
      "fixtures",
      "fireplaces",
    ]);
  });

  it("leaves out a division with no lines", () => {
    const groups = groupByDivision([line()]);
    expect(groups.map((group) => group.division)).toEqual(["interior"]);
  });
});
