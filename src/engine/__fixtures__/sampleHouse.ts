import type { Lot } from "../deal";
import type { HouseModel } from "../house";

/** A 2,200 sf upgraded rambler with a partly finished basement, used across engine tests. */
export const SAMPLE_HOUSE: HouseModel = {
  schemaVersion: 1,
  source: "described",
  style: "rambler",
  levels: {
    main: { finishedSf: 2200, unfinishedSf: 0, ceilingFt: 10 },
    basement: { totalSf: 2200, finishedSf: 1600, walkout: false },
  },
  footprint: { widthFt: 55, depthFt: 40, complexity: "moderate" },
  garage: { bays: 3, tandem: false, rvBay: false },
  roof: { style: "hip", pitchPer12: 6 },
  rooms: { bedrooms: 5, fullBaths: 3, halfBaths: 1, fireplaces: 1 },
  exterior: { stonePct: 25, stuccoPct: 50, boardBattenPct: 25, fiberCementPct: 0 },
  finishes: {
    houseTier: "upgraded",
    overrides: { kitchen: "luxury", basement: "standard" },
  },
  adu: { type: "none" },
  pool: { type: "none", spa: false, heated: false },
  outside: { coveredPatioSf: 400, flatworkSf: 1500, fenceLf: 240, landscapingTier: "upgraded" },
};

/** A third-of-an-acre Kaysville lot bought for cash, with every utility still to be connected. */
export const SAMPLE_LOT: Lot = {
  city: "Kaysville",
  county: "Davis",
  region: "utah-north",
  acres: 0.33,
  priceCents: 29_500_000,
  closingCents: 400_000,
  financing: { kind: "cash" },
  utilities: {
    water: "needsConnection",
    sewer: "needsConnection",
    gas: "needsConnection",
    power: "needsConnection",
    secondaryWater: "unknown",
  },
  hoaMonthlyCents: 0,
  propertyTaxRate: 0.0048,
};
