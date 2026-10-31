import type { CostCodeId, DefaultPrice, FinishTier, Unit } from "@engine";

const REGION = "utah-north";
const AS_OF = "2026-10-30";
const SOURCE_NOTE = "Starter estimate — unverified";
const TIERS: readonly FinishTier[] = ["standard", "upgraded", "luxury"];

/** code, variant, unit, dollars per unit. These carry no tier: one price serves every finish tier. */
type Untiered = readonly [code: CostCodeId, variant: string, unit: Unit, dollars: number];
/** code, variant, unit, dollars per unit at standard, upgraded and luxury. */
type Tiered = readonly [code: CostCodeId, variant: string, unit: Unit, dollars: readonly [number, number, number]];

const UNTIERED: readonly Untiered[] = [
  ["plans", "ls", "ls", 9_000],
  ["permits", "ls", "ls", 27_000],
  ["surveySoils", "ls", "ls", 3_200],
  ["excavation", "base", "yd3", 25],
  ["utilities", "connection", "ea", 3_900],
  ["foundation", "base", "lf", 290],
  ["framing", "base", "sf", 23.50],
  ["roofing", "base", "sq", 600],
  ["cladding", "stone", "sf", 32],
  ["cladding", "stucco", "sf", 11],
  ["cladding", "boardBatten", "sf", 12],
  ["cladding", "fiberCement", "sf", 9],
  ["insulation", "base", "sf", 2.40],
  ["plumbing", "fixture", "ea", 1_500],
  ["hvac", "ton", "ton", 5_300],
  ["drywall", "base", "sf", 2.00],
  ["paint", "base", "sf", 1.20],
  ["garageDoors", "double", "ea", 2_600],
  ["garageDoors", "single", "ea", 1_500],
  ["garageDoors", "rv", "ea", 4_500],
  ["flatwork", "base", "sf", 11],
  ["landscaping", "fence", "lf", 38],
  ["cleaning", "base", "sf", 1.10],
  ["supervision", "month", "mo", 3_700],
  ["adu", "basement", "ls", 45_000],
  ["adu", "detached", "ls", 165_000],
  ["pool", "fiberglass", "ls", 55_000],
  ["pool", "gunite", "ls", 85_000],
  ["pool", "spa", "ls", 12_000],
  ["pool", "heater", "ls", 6_500],
  ["pool", "safety", "ls", 7_500],
  ["patio", "base", "sf", 28],
];

const TIERED: readonly Tiered[] = [
  ["windows", "window", "ea", [950, 1_150, 1_600]],
  ["electrical", "base", "sf", [6.00, 6.75, 8.50]],
  ["trim", "aboveGrade", "sf", [5.00, 6.50, 9.00]],
  ["trim", "basement", "sf", [4.00, 5.00, 7.00]],
  ["cabinets", "lf", "lf", [550, 750, 1_100]],
  ["flooring", "tile", "sf", [10, 13, 18]],
  ["flooring", "hard", "sf", [6.50, 9.00, 14.00]],
  ["flooring", "carpet", "sf", [3.50, 4.50, 6.50]],
  ["fixtures", "kitchen", "ea", [8_000, 12_000, 22_000]],
  ["fixtures", "primaryBath", "ea", [3_500, 5_000, 9_000]],
  ["fixtures", "fullBath", "ea", [2_000, 2_800, 4_500]],
  ["fixtures", "halfBath", "ea", [900, 1_300, 2_200]],
  ["landscaping", "allowance", "sf", [1.25, 2.00, 3.50]],
  ["fireplaces", "unit", "ea", [3_500, 5_500, 9_000]],
];

/** Dollars to whole cents. Prices are positive, so `Math.round` is half away from zero here. */
const toCents = (dollars: number): number => Math.round(dollars * 100);

function entry(code: CostCodeId, variant: string, unit: Unit, tier: FinishTier | null, dollars: number): DefaultPrice {
  return {
    code,
    variant,
    tier,
    region: REGION,
    unitPriceCents: toCents(dollars),
    unit,
    asOf: AS_OF,
    verified: false,
    sourceNote: SOURCE_NOTE,
  };
}

/**
 * The regional starter prices for Northern Utah: 32 untiered entries and 14 tiered rows of three, 74 in all. They are
 * estimates, never verified; an owner's price book or a bid replaces them line by line.
 */
export const STARTER_COST_BOOK: DefaultPrice[] = [
  ...UNTIERED.map(([code, variant, unit, dollars]) => entry(code, variant, unit, null, dollars)),
  ...TIERED.flatMap(([code, variant, unit, dollars]) =>
    TIERS.map((tier, i) => entry(code, variant, unit, tier, dollars[i] as number)),
  ),
];
