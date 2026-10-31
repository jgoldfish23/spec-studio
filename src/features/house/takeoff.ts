import type { Q, Quantities } from "@engine";

/** One line of the live takeoff: what it is, how much of it, and how the engine worked that out. */
export interface TakeoffRow {
  /** The name of the quantity in the engine's `Quantities`. */
  key: keyof Quantities;
  label: string;
  /** The amount with thousands separators and its unit: `3,800 sf`, `214 LF`. */
  value: string;
  explain: string;
}

const MISSING = "—";
// Built once; building an Intl.NumberFormat on every call is slow.
const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const amount = (value: number): string => (Number.isFinite(value) ? NUMBER.format(value) : MISSING);

/** `3,800 sf`, or just `28` for a count. A figure that is not a number is a dash, never "NaN sf". */
function withUnit(value: number, unit: string): string {
  const text = amount(value);
  return text === MISSING || unit === "" ? text : `${text} ${unit}`;
}

type ScalarKey = {
  [K in keyof Quantities]: Quantities[K] extends Q ? K : never;
}[keyof Quantities];
type GroupKey = Exclude<keyof Quantities, ScalarKey>;

interface Scalar {
  key: ScalarKey;
  label: string;
  unit: string;
}

interface Group {
  key: GroupKey;
  label: string;
  unit: string;
  /** The parts of the group, in the order the explanation lists them. */
  parts: { name: string; q: (quantities: Quantities) => Q }[];
}

type Line = ({ kind: "scalar" } & Scalar) | ({ kind: "group" } & Group);

const scalar = (key: ScalarKey, label: string, unit: string): Line => ({ kind: "scalar", key, label, unit });
const group = (key: GroupKey, label: string, unit: string, parts: Group["parts"]): Line => ({
  kind: "group",
  key,
  label,
  unit,
  parts,
});

/** Every quantity the engine works out, in the order the takeoff lists them: the structure first, the site last. */
const LINES: Line[] = [
  scalar("finishedSf", "Finished area", "sf"),
  scalar("conditionedSf", "Conditioned area", "sf"),
  scalar("garageSf", "Garage", "sf"),
  scalar("framingSf", "Framing area", "sf"),
  scalar("perimeterLf", "Perimeter", "LF"),
  scalar("foundationLf", "Foundation", "LF"),
  scalar("excavationYd3", "Excavation", "yd³"),
  scalar("roofSquares", "Roof", "squares"),
  scalar("exteriorWallNetSf", "Exterior walls (net)", "sf"),
  group("cladding", "Cladding", "sf", [
    { name: "Stone", q: (q) => q.cladding.stone },
    { name: "stucco", q: (q) => q.cladding.stucco },
    { name: "board and batten", q: (q) => q.cladding.boardBatten },
    { name: "fiber cement", q: (q) => q.cladding.fiberCement },
  ]),
  scalar("windowCount", "Windows", ""),
  scalar("insulatedEnvelopeSf", "Insulated envelope", "sf"),
  scalar("drywallSf", "Drywall", "sf"),
  scalar("paintSf", "Paint", "sf"),
  group("flooring", "Flooring", "sf", [
    { name: "Tile", q: (q) => q.flooring.tile },
    { name: "hard surface above grade", q: (q) => q.flooring.hardAbove },
    { name: "carpet above grade", q: (q) => q.flooring.carpetAbove },
    { name: "hard surface in the basement", q: (q) => q.flooring.hardBasement },
    { name: "carpet in the basement", q: (q) => q.flooring.carpetBasement },
  ]),
  group("trimSf", "Trim", "sf", [
    { name: "Above grade", q: (q) => q.trimSf.aboveGrade },
    { name: "basement", q: (q) => q.trimSf.basement },
  ]),
  group("cabinetLf", "Cabinets", "LF", [
    { name: "Kitchen", q: (q) => q.cabinetLf.kitchen },
    { name: "primary bath", q: (q) => q.cabinetLf.primaryBath },
    { name: "everything else", q: (q) => q.cabinetLf.rest },
  ]),
  group("fixtureSets", "Fixture sets", "", [
    { name: "Kitchen", q: (q) => q.fixtureSets.kitchen },
    { name: "primary bath", q: (q) => q.fixtureSets.primaryBath },
    { name: "other full baths", q: (q) => q.fixtureSets.otherFullBaths },
    { name: "half baths", q: (q) => q.fixtureSets.halfBaths },
  ]),
  scalar("plumbingFixtures", "Plumbing fixtures", ""),
  scalar("hvacTons", "HVAC", "tons"),
  group("garageDoors", "Garage doors", "", [
    { name: "Double", q: (q) => q.garageDoors.double },
    { name: "single", q: (q) => q.garageDoors.single },
    { name: "RV", q: (q) => q.garageDoors.rv },
  ]),
  scalar("utilityConnections", "Utility connections", ""),
  scalar("fireplaces", "Fireplaces", ""),
  scalar("landscapedSf", "Landscaped area", "sf"),
  scalar("flatworkSf", "Flatwork", "sf"),
  scalar("coveredPatioSf", "Covered patio", "sf"),
  scalar("fenceLf", "Fencing", "LF"),
];

/**
 * The takeoff as a list of lines: every single quantity of the engine's result, and the total of each group of them
 * (cladding, flooring, cabinets and so on), each with the engine's own account of how it was worked out.
 */
export function takeoffRows(quantities: Quantities): TakeoffRow[] {
  return LINES.map((line): TakeoffRow => {
    if (line.kind === "scalar") {
      const q = quantities[line.key];
      return { key: line.key, label: line.label, value: withUnit(q.value, line.unit), explain: q.explain };
    }
    const parts = line.parts.map(({ name, q }) => ({ name, value: q(quantities).value }));
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    return {
      key: line.key,
      label: line.label,
      value: withUnit(total, line.unit),
      explain: parts.map((part) => `${part.name} ${withUnit(part.value, line.unit)}`).join(" + "),
    };
  });
}
