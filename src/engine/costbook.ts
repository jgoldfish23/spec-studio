import type { ISODate } from "./dates";
import { tierFor, type FinishTier, type HouseModel, type TierArea } from "./house";
import type { Quantities } from "./quantities";

/** The 29 cost codes, in spec §5.4 order. */
export type CostCodeId =
  | "plans"
  | "permits"
  | "surveySoils"
  | "excavation"
  | "utilities"
  | "foundation"
  | "framing"
  | "roofing"
  | "windows"
  | "cladding"
  | "insulation"
  | "plumbing"
  | "electrical"
  | "hvac"
  | "drywall"
  | "trim"
  | "cabinets"
  | "flooring"
  | "paint"
  | "fixtures"
  | "garageDoors"
  | "flatwork"
  | "landscaping"
  | "cleaning"
  | "supervision"
  | "fireplaces"
  | "adu"
  | "pool"
  | "patio";

export type Division =
  | "soft"
  | "site"
  | "structure"
  | "envelope"
  | "mep"
  | "interior"
  | "exteriorFinish"
  | "general";

export type CostCode = { id: CostCodeId; number: number; name: string; division: Division };

/** Codes 26-29 appear in an estimate only when the house uses them. */
export const COST_CODES: readonly CostCode[] = [
  { id: "plans", number: 1, name: "Plans & engineering", division: "soft" },
  { id: "permits", number: 2, name: "Permits & impact fees", division: "soft" },
  { id: "surveySoils", number: 3, name: "Survey & soils report", division: "soft" },
  { id: "excavation", number: 4, name: "Excavation & grading", division: "site" },
  { id: "utilities", number: 5, name: "Utility connections", division: "site" },
  { id: "foundation", number: 6, name: "Foundation & waterproofing", division: "structure" },
  { id: "framing", number: 7, name: "Framing", division: "structure" },
  { id: "roofing", number: 8, name: "Roofing", division: "structure" },
  { id: "windows", number: 9, name: "Windows & exterior doors", division: "envelope" },
  { id: "cladding", number: 10, name: "Exterior cladding", division: "envelope" },
  { id: "insulation", number: 11, name: "Insulation", division: "envelope" },
  { id: "plumbing", number: 12, name: "Plumbing", division: "mep" },
  { id: "electrical", number: 13, name: "Electrical", division: "mep" },
  { id: "hvac", number: 14, name: "HVAC", division: "mep" },
  { id: "drywall", number: 15, name: "Drywall", division: "interior" },
  { id: "trim", number: 16, name: "Interior trim & doors", division: "interior" },
  { id: "cabinets", number: 17, name: "Cabinets & countertops", division: "interior" },
  { id: "flooring", number: 18, name: "Flooring", division: "interior" },
  { id: "paint", number: 19, name: "Paint", division: "interior" },
  { id: "fixtures", number: 20, name: "Fixtures & appliances", division: "interior" },
  { id: "garageDoors", number: 21, name: "Garage doors", division: "exteriorFinish" },
  { id: "flatwork", number: 22, name: "Concrete flatwork", division: "exteriorFinish" },
  { id: "landscaping", number: 23, name: "Landscaping & fencing", division: "exteriorFinish" },
  { id: "cleaning", number: 24, name: "Final cleaning", division: "general" },
  { id: "supervision", number: 25, name: "Supervision & overhead", division: "general" },
  { id: "fireplaces", number: 26, name: "Fireplaces", division: "interior" },
  { id: "adu", number: 27, name: "ADU package", division: "interior" },
  { id: "pool", number: 28, name: "Pool & spa", division: "exteriorFinish" },
  { id: "patio", number: 29, name: "Covered patio / deck", division: "exteriorFinish" },
];

export type Unit = "sf" | "lf" | "yd3" | "sq" | "ea" | "ton" | "mo" | "ls";

/** One priced slice of a cost code: a variant at a finish tier, with the quantity it covers. */
export type LinePart = {
  code: CostCodeId;
  variant: string;
  tier: FinishTier | null;
  quantity: number;
  unit: Unit;
  /** The house area the tier came from; unset when the part has no area (or no tier). */
  area?: TierArea;
};

type Tiering = { tier: FinishTier | null; area?: TierArea };

const UNTIERED: Tiering = { tier: null };

/**
 * Splits the takeoff into priced parts, in cost-code order (and table order within a code).
 * A part with zero quantity is omitted, and a code left with no parts produces nothing.
 */
export function linePartsFor(q: Quantities, h: HouseModel, buildMonths: number): LinePart[] {
  const parts: LinePart[] = [];

  const add = (code: CostCodeId, variant: string, quantity: number, unit: Unit, tiering: Tiering = UNTIERED) => {
    if (quantity === 0) return;
    const part: LinePart = { code, variant, tier: tiering.tier, quantity, unit };
    if (tiering.area !== undefined) part.area = tiering.area;
    parts.push(part);
  };
  const inArea = (area: TierArea): Tiering => ({ tier: tierFor(h, area), area });
  const house = inArea("house");
  const kitchen = inArea("kitchen");
  const primaryBath = inArea("primaryBath");
  const basement = inArea("basement");

  add("plans", "ls", 1, "ls");
  add("permits", "ls", 1, "ls");
  add("surveySoils", "ls", 1, "ls");
  add("excavation", "base", q.excavationYd3.value, "yd3");
  add("utilities", "connection", q.utilityConnections.value, "ea");
  add("foundation", "base", q.foundationLf.value, "lf");
  add("framing", "base", q.framingSf.value, "sf");
  add("roofing", "base", q.roofSquares.value, "sq");
  add("windows", "window", q.windowCount.value, "ea", house);
  add("cladding", "stone", q.cladding.stone.value, "sf");
  add("cladding", "stucco", q.cladding.stucco.value, "sf");
  add("cladding", "boardBatten", q.cladding.boardBatten.value, "sf");
  add("cladding", "fiberCement", q.cladding.fiberCement.value, "sf");
  add("insulation", "base", q.insulatedEnvelopeSf.value, "sf");
  add("plumbing", "fixture", q.plumbingFixtures.value, "ea");
  add("electrical", "base", q.conditionedSf.value, "sf", house);
  add("hvac", "ton", q.hvacTons.value, "ton");
  add("drywall", "base", q.drywallSf.value, "sf");
  add("trim", "aboveGrade", q.trimSf.aboveGrade.value, "sf", house);
  add("trim", "basement", q.trimSf.basement.value, "sf", basement);
  add("cabinets", "lf", q.cabinetLf.kitchen.value, "lf", kitchen);
  add("cabinets", "lf", q.cabinetLf.primaryBath.value, "lf", primaryBath);
  add("cabinets", "lf", q.cabinetLf.rest.value, "lf", house);
  add("flooring", "tile", q.flooring.tile.value, "sf", house);
  add("flooring", "hard", q.flooring.hardAbove.value, "sf", house);
  add("flooring", "carpet", q.flooring.carpetAbove.value, "sf", house);
  add("flooring", "hard", q.flooring.hardBasement.value, "sf", basement);
  add("flooring", "carpet", q.flooring.carpetBasement.value, "sf", basement);
  add("paint", "base", q.paintSf.value, "sf");
  add("fixtures", "kitchen", q.fixtureSets.kitchen.value, "ea", kitchen);
  add("fixtures", "primaryBath", q.fixtureSets.primaryBath.value, "ea", primaryBath);
  add("fixtures", "fullBath", q.fixtureSets.otherFullBaths.value, "ea", house);
  add("fixtures", "halfBath", q.fixtureSets.halfBaths.value, "ea", house);
  add("garageDoors", "double", q.garageDoors.double.value, "ea");
  add("garageDoors", "single", q.garageDoors.single.value, "ea");
  add("garageDoors", "rv", q.garageDoors.rv.value, "ea");
  add("flatwork", "base", q.flatworkSf.value, "sf");
  add("landscaping", "allowance", q.landscapedSf.value, "sf", { tier: h.outside.landscapingTier });
  add("landscaping", "fence", q.fenceLf.value, "lf");
  add("cleaning", "base", q.finishedSf.value, "sf");
  add("supervision", "month", buildMonths, "mo");
  add("fireplaces", "unit", q.fireplaces.value, "ea", house);
  if (h.adu.type !== "none") add("adu", h.adu.type, 1, "ls");
  if (h.pool.type !== "none") {
    add("pool", h.pool.type, 1, "ls");
    if (h.pool.spa) add("pool", "spa", 1, "ls");
    if (h.pool.heated) add("pool", "heater", 1, "ls");
    add("pool", "safety", 1, "ls");
  }
  add("patio", "base", q.coveredPatioSf.value, "sf");

  return parts;
}

/** What a price is looked up by. A `null` tier matches any tier when no exact tier price exists. */
export type PriceKey = { code: CostCodeId; variant: string; tier: FinishTier | null };

/** A regional starter price (spec §5.4, source 3). */
export type DefaultPrice = PriceKey & {
  region: string;
  unitPriceCents: number;
  unit: Unit;
  asOf: ISODate;
  verified: boolean;
  sourceNote: string;
};

/** A price from the owner's own price book (spec §5.4, source 2). Not tied to a region. */
export type PriceBookEntry = PriceKey & {
  unitPriceCents: number;
  unit: Unit;
  asOf: ISODate;
  vendor?: string;
  notes?: string;
};

export type CostBookView = { defaults: DefaultPrice[]; priceBook: PriceBookEntry[] };

export type ResolvedPrice = {
  unitPriceCents: number;
  source: "priceBook" | "default";
  asOf: ISODate;
};

/**
 * The first entry for the part's code and variant: one at its exact tier if there is one,
 * otherwise one with no tier. Ties go to the earliest entry in array order.
 */
function bestMatch<T extends PriceKey>(
  entries: readonly T[],
  p: LinePart,
  eligible: (entry: T) => boolean = () => true,
): T | undefined {
  let tierless: T | undefined;
  for (const entry of entries) {
    if (entry.code !== p.code || entry.variant !== p.variant || !eligible(entry)) continue;
    if (entry.tier === p.tier) return entry;
    if (entry.tier === null && tierless === undefined) tierless = entry;
  }
  return tierless;
}

/**
 * The unit price for a part. The owner's price book beats a regional default; within a source an
 * exact tier match beats a no-tier entry; defaults must be for `region`. Null when nothing matches.
 */
export function resolvePrice(p: LinePart, book: CostBookView, region: string): ResolvedPrice | null {
  const fromBook = bestMatch(book.priceBook, p);
  if (fromBook) return { unitPriceCents: fromBook.unitPriceCents, source: "priceBook", asOf: fromBook.asOf };
  const fromDefaults = bestMatch(book.defaults, p, (d) => d.region === region);
  if (fromDefaults) {
    return { unitPriceCents: fromDefaults.unitPriceCents, source: "default", asOf: fromDefaults.asOf };
  }
  return null;
}
