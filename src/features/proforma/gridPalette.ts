import type { Band } from "@engine";

export interface BandStyle {
  background: string;
  /** The text on that background; at least 4.5 to 1 against it (checked in gridPalette.test.ts). */
  color: string;
  /** The band in the legend. */
  label: string;
}

/** The bands in the order the legend lists them: a loss, then each step of profit up. */
export const BAND_ORDER: readonly Band[] = ["loss", "b0_50", "b50_100", "b100_150", "b150_200", "b200plus"];

/**
 * The color of each profit band in the sale price by days-on-market grid: orange for a loss, then five blues from
 * light to dark as the profit climbs. Taken from the pro forma mockup. Color is never the only signal: every cell
 * also writes its profit, and a loss carries a minus sign.
 */
export const BAND_STYLES: Record<Band, BandStyle> = {
  loss: { background: "#F6C9B0", color: "#6B2A0B", label: "Loss" },
  b0_50: { background: "#F1F4F8", color: "#1A1D1B", label: "$0–50K" },
  b50_100: { background: "#D6E3F4", color: "#1A1D1B", label: "$50–100K" },
  b100_150: { background: "#A9C4E8", color: "#1A1D1B", label: "$100–150K" },
  b150_200: { background: "#6F9BD3", color: "#0B1F3A", label: "$150–200K" },
  b200plus: { background: "#2F6DB5", color: "#FFFFFF", label: "$200K+" },
};
