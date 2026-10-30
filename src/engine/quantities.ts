import type { Lot } from "./deal";
import { tierFor, validateHouse, type FinishTier, type HouseModel } from "./house";
import { roundCents } from "./money";
import { incomplete, ok, type Result } from "./result";

/** A takeoff quantity with a short plain-language account of how it was worked out. */
export type Q = { value: number; explain: string };

export type Quantities = {
  finishedSf: Q;
  conditionedSf: Q;
  perimeterLf: Q;
  foundationLf: Q;
  garageSf: Q;
  framingSf: Q;
  excavationYd3: Q;
  roofSquares: Q;
  exteriorWallNetSf: Q;
  windowCount: Q;
  insulatedEnvelopeSf: Q;
  drywallSf: Q;
  paintSf: Q;
  plumbingFixtures: Q;
  hvacTons: Q;
  utilityConnections: Q;
  landscapedSf: Q;
  fenceLf: Q;
  flatworkSf: Q;
  coveredPatioSf: Q;
  fireplaces: Q;
  cladding: { stone: Q; stucco: Q; boardBatten: Q; fiberCement: Q };
  cabinetLf: { kitchen: Q; primaryBath: Q; rest: Q };
  flooring: { tile: Q; hardAbove: Q; carpetAbove: Q; hardBasement: Q; carpetBasement: Q };
  trimSf: { aboveGrade: Q; basement: Q };
  fixtureSets: { kitchen: Q; primaryBath: Q; otherFullBaths: Q; halfBaths: Q };
  garageDoors: { double: Q; single: Q; rv: Q };
};

type Complexity = HouseModel["footprint"]["complexity"];
type RoofStyle = HouseModel["roof"]["style"];

/** Every coefficient behind the takeoff (spec §5.3). Editable later in Settings. */
export type QuantityRules = {
  /** Foundation length as a multiple of the perimeter. */
  foundationComplexity: Record<Complexity, number>;
  garage: {
    sfPerBay: number;
    rvBaySf: number;
    /** Bays covered by the one double door; each bay past this gets a single door. */
    baysPerDoubleDoor: number;
  };
  excavation: { basementDepthFt: number; slabDepthFt: number; cubicFtPerYd3: number };
  roof: { overhang: number; styleFactor: Record<RoofStyle, number>; sfPerSquare: number };
  exteriorWall: {
    /** Added to each ceiling height to get the wall height. */
    heightAllowanceFt: number;
    /** Garage wall length is `ftPerBay × bays + ftBase`, at `heightFt` high. */
    garageFtPerBay: number;
    garageFtBase: number;
    garageHeightFt: number;
    /** Share of the wall taken up by windows and doors. */
    openingsShare: number;
  };
  windows: { sfPerWindow: number; basementFinishedSfPerWindow: number };
  drywall: { perFinishedSf: number; perGarageSf: number };
  plumbing: {
    perFullBath: number;
    perHalfBath: number;
    kitchen: number;
    laundry: number;
    hoseBibs: number;
    waterHeater: number;
    /** Added when the house has an ADU (basement or detached). */
    adu: number;
  };
  hvac: { sfPerTon: number; tonStep: number };
  cabinets: {
    kitchenLfByTier: Record<FinishTier, number>;
    lfPerFullBathVanity: number;
    lfPerHalfBathVanity: number;
    laundryLf: number;
    aduKitchenLf: number;
  };
  flooring: {
    /** Hard-surface share of above-grade floor outside the tile areas. */
    hardShareByTier: Record<FinishTier, number>;
    basementHardShare: number;
    tileSfPerFullBath: number;
    tileSfPerHalfBath: number;
    tileSfLaundry: number;
  };
  sfPerAcre: number;
};

export const DEFAULT_QUANTITY_RULES: QuantityRules = {
  foundationComplexity: { simple: 1, moderate: 1.125, complex: 1.25 },
  garage: { sfPerBay: 256, rvBaySf: 480, baysPerDoubleDoor: 2 },
  excavation: { basementDepthFt: 10.8, slabDepthFt: 3, cubicFtPerYd3: 27 },
  roof: { overhang: 1.12, styleFactor: { gable: 1, hip: 1.08, mixed: 1.12 }, sfPerSquare: 100 },
  exteriorWall: {
    heightAllowanceFt: 1,
    garageFtPerBay: 12,
    garageFtBase: 24,
    garageHeightFt: 10,
    openingsShare: 0.12,
  },
  windows: { sfPerWindow: 100, basementFinishedSfPerWindow: 400 },
  drywall: { perFinishedSf: 3.6, perGarageSf: 2.2 },
  plumbing: {
    perFullBath: 4,
    perHalfBath: 2,
    kitchen: 3,
    laundry: 2,
    hoseBibs: 2,
    waterHeater: 1,
    adu: 6,
  },
  hvac: { sfPerTon: 900, tonStep: 0.5 },
  cabinets: {
    kitchenLfByTier: { standard: 25, upgraded: 30, luxury: 36 },
    lfPerFullBathVanity: 5,
    lfPerHalfBathVanity: 3,
    laundryLf: 6,
    aduKitchenLf: 12,
  },
  flooring: {
    hardShareByTier: { standard: 0.45, upgraded: 0.6, luxury: 0.7 },
    basementHardShare: 0.3,
    tileSfPerFullBath: 60,
    tileSfPerHalfBath: 25,
    tileSfLaundry: 60,
  },
  sfPerAcre: 43_560,
};

/** Nearest whole number, halves away from zero (the same convention as `roundCents`). */
const round = (x: number): number => roundCents(x);

/** Formats a number for an explanation: at most three decimals, no trailing zeros. */
const n = (x: number): string => String(Math.round(x * 1000) / 1000);

const q = (value: number, explain: string): Q => ({ value, explain });

/**
 * Estimates what it takes to build the house from its description (spec §5.3).
 * Returns `incomplete` with one item per problem if the house fails validation.
 */
export function computeQuantities(
  h: HouseModel,
  lot: Lot,
  rules: QuantityRules,
): Result<Quantities> {
  const issues = validateHouse(h);
  if (issues.length > 0) {
    return incomplete(
      issues.map((issue) => ({
        code: "invalidHouse",
        message: `${issue.path}: ${issue.message}`,
        step: "house" as const,
      })),
    );
  }

  const { main, upper, basement } = h.levels;
  const { widthFt, depthFt, complexity } = h.footprint;
  const { bays, rvBay } = h.garage;
  const { fullBaths, halfBaths } = h.rooms;

  const mainFin = main.finishedSf;
  const mainTotal = main.finishedSf + main.unfinishedSf;
  const upperFin = upper?.finishedSf ?? 0;
  const upperTotal = upper ? upper.finishedSf + upper.unfinishedSf : 0;
  const basementFin = basement?.finishedSf ?? 0;
  const basementTotal = basement?.totalSf ?? 0;
  const aboveGradeFin = mainFin + upperFin;
  const footprintSf = widthFt * depthFt;
  const hasAdu = h.adu.type !== "none";

  const finishedSf = mainFin + upperFin + basementFin;
  const conditionedSf = mainTotal + upperTotal + basementTotal;

  const perimeterLf = 2 * (widthFt + depthFt);
  const complexityFactor = rules.foundationComplexity[complexity];
  const foundationLf = round(perimeterLf * complexityFactor);

  const garageSf = rules.garage.sfPerBay * bays + (rvBay ? rules.garage.rvBaySf : 0);
  const framingSf = mainTotal + upperTotal + basementFin + garageSf;

  const excavationYd3 = basement
    ? round((basement.totalSf * rules.excavation.basementDepthFt) / rules.excavation.cubicFtPerYd3)
    : round((footprintSf * rules.excavation.slabDepthFt) / rules.excavation.cubicFtPerYd3);

  const pitchFactor = Math.sqrt(1 + (h.roof.pitchPer12 / 12) ** 2);
  const roofStyleFactor = rules.roof.styleFactor[h.roof.style];
  const roofSquares = round(
    ((footprintSf + garageSf) * rules.roof.overhang * pitchFactor * roofStyleFactor) /
      rules.roof.sfPerSquare,
  );

  // Walls use the rounded foundation length. The garage wall is skipped when there is no
  // garage, so the base length does not add a phantom wall. The RV bay adds no wall.
  const wall = rules.exteriorWall;
  const wallGrossNoGarageSf =
    foundationLf * (main.ceilingFt + wall.heightAllowanceFt) +
    (upper ? foundationLf * (upper.ceilingFt + wall.heightAllowanceFt) : 0);
  const garageWallLf = bays > 0 ? wall.garageFtPerBay * bays + wall.garageFtBase : 0;
  const garageWallSf = garageWallLf * wall.garageHeightFt;
  const netShare = 1 - wall.openingsShare;
  const exteriorWallNetSf = round((wallGrossNoGarageSf + garageWallSf) * netShare);

  const cladding = (pct: number, label: string): Q =>
    q(
      round((exteriorWallNetSf * pct) / 100),
      `${n(pct)}% ${label} × ${exteriorWallNetSf} sf net exterior wall`,
    );

  const windowCount = round(
    (mainTotal + upperTotal) / rules.windows.sfPerWindow +
      Math.ceil(basementFin / rules.windows.basementFinishedSfPerWindow),
  );

  const insulatedEnvelopeSf = round(wallGrossNoGarageSf * netShare + footprintSf);

  const drywallSf = round(
    finishedSf * rules.drywall.perFinishedSf + garageSf * rules.drywall.perGarageSf,
  );

  const p = rules.plumbing;
  const plumbingFixtures =
    p.perFullBath * fullBaths +
    p.perHalfBath * halfBaths +
    p.kitchen +
    p.laundry +
    p.hoseBibs +
    p.waterHeater +
    (hasAdu ? p.adu : 0);

  const hvacTons =
    Math.ceil(conditionedSf / (rules.hvac.sfPerTon * rules.hvac.tonStep)) * rules.hvac.tonStep;

  const connectionNames = Object.entries(lot.utilities)
    .filter(([, status]) => status === "needsConnection")
    .map(([name]) => name);
  const utilityConnections = connectionNames.length;

  const lotSf = round(lot.acres * rules.sfPerAcre);
  const landscapedSf = round(
    Math.max(0, lotSf - footprintSf - garageSf - h.outside.flatworkSf - h.outside.coveredPatioSf),
  );

  const c = rules.cabinets;
  const kitchenTier = tierFor(h, "kitchen");
  const kitchenLf = c.kitchenLfByTier[kitchenTier];
  const primaryBathLf = fullBaths >= 1 ? c.lfPerFullBathVanity : 0;
  const otherFullBaths = Math.max(0, fullBaths - 1);
  const restLf =
    c.lfPerFullBathVanity * otherFullBaths +
    c.lfPerHalfBathVanity * halfBaths +
    c.laundryLf +
    (hasAdu ? c.aduKitchenLf : 0);

  const f = rules.flooring;
  const houseTier = tierFor(h, "house");
  const tileSf =
    f.tileSfPerFullBath * fullBaths + f.tileSfPerHalfBath * halfBaths + f.tileSfLaundry;
  const aboveGradeRestSf = Math.max(0, aboveGradeFin - tileSf);
  const hardShare = f.hardShareByTier[houseTier];
  const hardAboveSf = round(aboveGradeRestSf * hardShare);
  const hardBasementSf = round(basementFin * f.basementHardShare);

  const doubleDoors = bays > 0 ? 1 : 0;
  const singleDoors = Math.max(0, bays - rules.garage.baysPerDoubleDoor);
  const rvDoors = rvBay ? 1 : 0;

  const quantities: Quantities = {
    finishedSf: q(
      finishedSf,
      `${mainFin} main + ${upperFin} upper + ${basementFin} basement finished sf`,
    ),
    conditionedSf: q(
      conditionedSf,
      `${mainTotal} main + ${upperTotal} upper + ${basementTotal} basement total sf (garage excluded)`,
    ),
    perimeterLf: q(perimeterLf, `2 × (${widthFt} + ${depthFt}) ft footprint`),
    foundationLf: q(
      foundationLf,
      `${n(perimeterLf)} LF perimeter × ${n(complexityFactor)} ${complexity} complexity`,
    ),
    garageSf: q(
      garageSf,
      `${rules.garage.sfPerBay} sf × ${bays} bays` +
        (rvBay ? ` + ${rules.garage.rvBaySf} sf RV bay` : ""),
    ),
    framingSf: q(
      framingSf,
      `${mainTotal} main + ${upperTotal} upper + ${basementFin} basement finished + ${garageSf} garage sf`,
    ),
    excavationYd3: q(
      excavationYd3,
      basement
        ? `${basement.totalSf} sf basement × ${n(rules.excavation.basementDepthFt)} ft deep / ${rules.excavation.cubicFtPerYd3} cf per yd³`
        : `${widthFt} × ${depthFt} ft footprint × ${n(rules.excavation.slabDepthFt)} ft deep / ${rules.excavation.cubicFtPerYd3} cf per yd³`,
    ),
    roofSquares: q(
      roofSquares,
      `(${n(footprintSf)} sf footprint + ${garageSf} sf garage) × ${n(rules.roof.overhang)} overhang × ${n(pitchFactor)} for ${h.roof.pitchPer12}/12 pitch × ${n(roofStyleFactor)} ${h.roof.style} roof / ${rules.roof.sfPerSquare} sf per square`,
    ),
    exteriorWallNetSf: q(
      exteriorWallNetSf,
      `[${foundationLf} LF foundation × (${main.ceilingFt} + ${wall.heightAllowanceFt}) ft main` +
        (upper
          ? ` + ${foundationLf} LF × (${upper.ceilingFt} + ${wall.heightAllowanceFt}) ft upper`
          : "") +
        ` + ${garageWallLf} LF garage × ${wall.garageHeightFt} ft] × (1 − ${n(wall.openingsShare)} openings)`,
    ),
    windowCount: q(
      windowCount,
      `(${mainTotal} main + ${upperTotal} upper sf) / ${rules.windows.sfPerWindow} + ceil(${basementFin} sf basement finished / ${rules.windows.basementFinishedSfPerWindow})`,
    ),
    insulatedEnvelopeSf: q(
      insulatedEnvelopeSf,
      `${foundationLf} LF foundation walls (no garage) × (1 − ${n(wall.openingsShare)} openings) + ${n(footprintSf)} sf top-floor footprint`,
    ),
    drywallSf: q(
      drywallSf,
      `${finishedSf} sf finished × ${n(rules.drywall.perFinishedSf)} + ${garageSf} sf garage × ${n(rules.drywall.perGarageSf)}`,
    ),
    paintSf: q(drywallSf, `Same as drywall: ${drywallSf} sf`),
    plumbingFixtures: q(
      plumbingFixtures,
      `${p.perFullBath} × ${fullBaths} full baths + ${p.perHalfBath} × ${halfBaths} half baths + ${p.kitchen} kitchen + ${p.laundry} laundry + ${p.hoseBibs} hose bibs + ${p.waterHeater} water heater` +
        (hasAdu ? ` + ${p.adu} ${h.adu.type} ADU` : ""),
    ),
    hvacTons: q(
      hvacTons,
      `${conditionedSf} sf conditioned / ${rules.hvac.sfPerTon} sf per ton, rounded up to ${n(rules.hvac.tonStep)} ton`,
    ),
    utilityConnections: q(
      utilityConnections,
      utilityConnections === 0
        ? "No lot utilities need a connection"
        : `${utilityConnections} of ${Object.keys(lot.utilities).length} lot utilities need a connection: ${connectionNames.join(", ")}`,
    ),
    landscapedSf: q(
      landscapedSf,
      `${lotSf} sf lot (${n(lot.acres)} ac) − ${n(footprintSf)} sf footprint − ${garageSf} garage − ${h.outside.flatworkSf} flatwork − ${h.outside.coveredPatioSf} covered patio`,
    ),
    fenceLf: q(h.outside.fenceLf, "Fence length from the house description"),
    flatworkSf: q(h.outside.flatworkSf, "Flatwork area from the house description"),
    coveredPatioSf: q(h.outside.coveredPatioSf, "Covered patio area from the house description"),
    fireplaces: q(h.rooms.fireplaces, "Fireplace count from the house description"),
    cladding: {
      stone: cladding(h.exterior.stonePct, "stone"),
      stucco: cladding(h.exterior.stuccoPct, "stucco"),
      boardBatten: cladding(h.exterior.boardBattenPct, "board and batten"),
      fiberCement: cladding(h.exterior.fiberCementPct, "fiber cement"),
    },
    cabinetLf: {
      kitchen: q(kitchenLf, `${kitchenLf} LF for a ${kitchenTier} kitchen`),
      primaryBath: q(
        primaryBathLf,
        fullBaths >= 1
          ? `${c.lfPerFullBathVanity} LF primary bath vanity`
          : "No full bath, so no primary bath vanity",
      ),
      rest: q(
        restLf,
        `${c.lfPerFullBathVanity} × ${otherFullBaths} other full baths + ${c.lfPerHalfBathVanity} × ${halfBaths} half baths + ${c.laundryLf} laundry` +
          (hasAdu ? ` + ${c.aduKitchenLf} ADU kitchen` : ""),
      ),
    },
    flooring: {
      tile: q(
        tileSf,
        `${f.tileSfPerFullBath} × ${fullBaths} full baths + ${f.tileSfPerHalfBath} × ${halfBaths} half baths + ${f.tileSfLaundry} laundry`,
      ),
      hardAbove: q(
        hardAboveSf,
        `(${aboveGradeFin} sf above grade − ${tileSf} tile) × ${n(hardShare * 100)}% hard surface at ${houseTier} tier`,
      ),
      carpetAbove: q(
        aboveGradeRestSf - hardAboveSf,
        `${aboveGradeRestSf} sf above grade outside tile − ${hardAboveSf} hard surface`,
      ),
      hardBasement: q(
        hardBasementSf,
        `${basementFin} sf basement finished × ${n(f.basementHardShare * 100)}% hard surface`,
      ),
      carpetBasement: q(
        basementFin - hardBasementSf,
        `${basementFin} sf basement finished − ${hardBasementSf} hard surface`,
      ),
    },
    trimSf: {
      aboveGrade: q(aboveGradeFin, `${mainFin} main + ${upperFin} upper finished sf`),
      basement: q(basementFin, `${basementFin} sf basement finished`),
    },
    fixtureSets: {
      kitchen: q(1, "One kitchen"),
      primaryBath: q(Math.min(1, fullBaths), "One primary bath when there is a full bath"),
      otherFullBaths: q(otherFullBaths, `${fullBaths} full baths − 1 primary`),
      halfBaths: q(halfBaths, "Half bath count from the house description"),
    },
    garageDoors: {
      double: q(
        doubleDoors,
        bays > 0
          ? `One double door for the first ${rules.garage.baysPerDoubleDoor} of ${bays} bays`
          : "No garage bays, so no garage doors",
      ),
      single: q(
        singleDoors,
        `One single door per bay past ${rules.garage.baysPerDoubleDoor} (${bays} bays)`,
      ),
      rv: q(rvDoors, rvBay ? "One RV door" : "No RV bay"),
    },
  };

  return ok(quantities);
}
