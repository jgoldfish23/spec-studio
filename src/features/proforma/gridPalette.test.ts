import { describe, expect, it } from "vitest";
import type { Band } from "@engine";
import { BAND_ORDER, BAND_STYLES } from "./gridPalette";

// The WCAG 2.x contrast ratio: (L1 + 0.05) / (L2 + 0.05), L from the relative luminance of each sRGB channel.
function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`not a #rrggbb color: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => channel(parseInt(part ?? "0", 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const ALL_BANDS: Band[] = ["loss", "b0_50", "b50_100", "b100_150", "b150_200", "b200plus"];

describe("contrast helper", () => {
  it("gives 21 for black on white and 1 for a color on itself", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrast("#4f5a55", "#4f5a55")).toBeCloseTo(1, 6);
  });
});

describe("the grid palette", () => {
  it("has a style for every band the engine reports, in order from loss up", () => {
    expect([...BAND_ORDER]).toEqual(ALL_BANDS);
    expect(Object.keys(BAND_STYLES).sort()).toEqual([...ALL_BANDS].sort());
  });

  it.each(ALL_BANDS)("keeps the text of the %s band readable: at least 4.5 to 1 on its background", (band) => {
    const { background, color } = BAND_STYLES[band];
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives every band its own background", () => {
    const backgrounds = ALL_BANDS.map((band) => BAND_STYLES[band].background.toLowerCase());
    expect(new Set(backgrounds).size).toBe(ALL_BANDS.length);
  });

  it("runs the profit bands from light to dark blue", () => {
    const blues = ALL_BANDS.filter((band) => band !== "loss").map((band) => luminance(BAND_STYLES[band].background));
    expect([...blues].sort((x, y) => y - x)).toEqual(blues);
    for (const band of ALL_BANDS.filter((b) => b !== "loss")) {
      const hex = BAND_STYLES[band].background;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(b ?? 0).toBeGreaterThan(r ?? 255);
      expect(b ?? 0).toBeGreaterThanOrEqual(g ?? 255);
    }
  });

  it("draws a loss in orange, not blue", () => {
    const hex = BAND_STYLES.loss.background;
    const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(r ?? 0).toBeGreaterThan(b ?? 255);
  });

  it("labels every band for the legend", () => {
    expect(ALL_BANDS.map((band) => BAND_STYLES[band].label)).toEqual([
      "Loss",
      "$0–50K",
      "$50–100K",
      "$100–150K",
      "$150–200K",
      "$200K+",
    ]);
  });

  it("is not the heat-map card's muted green-grey: no band uses #4f5a55", () => {
    for (const band of ALL_BANDS) {
      expect(BAND_STYLES[band].background.toLowerCase()).not.toBe("#4f5a55");
    }
  });
});
