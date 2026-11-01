import { COST_CODES } from "@engine";
import type { Division, EstimateLine, ISODate, LinePart, Unit } from "@engine";
import { formatMoney } from "../../lib/format";

const MISSING = "—";

/** The divisions in the order the cost codes first use them (the order of the estimate's table). */
export const DIVISION_ORDER: readonly Division[] = [...new Set(COST_CODES.map((code) => code.division))];

export const DIVISION_NAMES: Record<Division, string> = {
  soft: "Soft costs",
  site: "Site",
  structure: "Structure",
  envelope: "Envelope",
  mep: "Plumbing, electrical & HVAC",
  interior: "Interior",
  exteriorFinish: "Exterior finish",
  general: "General",
};

const UNIT_LABELS: Record<Unit, string> = {
  sf: "sf",
  lf: "lf",
  yd3: "yd³",
  sq: "sq",
  ea: "ea",
  ton: "ton",
  mo: "mo",
  ls: "ls",
};

// Quantities come out of the takeoff with many decimals at times; two are plenty to read.
const QUANTITY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** `2,200 sf`, or `39.75 sq`. A dash when the quantity is not a number. */
export function formatQuantity(quantity: number, unit: Unit): string {
  if (!Number.isFinite(quantity)) return MISSING;
  return `${QUANTITY.format(quantity)} ${UNIT_LABELS[unit]}`;
}

/** The takeoff variant written for reading: `boardBatten` is "Board batten", `ls` is "Lump sum". */
export function variantName(variant: string): string {
  if (variant === "") return MISSING;
  if (variant === "ls") return "Lump sum";
  const words = variant.replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `Oct 30, 2026` from `2026-10-30`; a dash for anything that is not a date. Read from the text, so no time zone moves it. */
export function formatAsOf(date: ISODate): string {
  const match = DATE.exec(date);
  if (match === null) return MISSING;
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (month === undefined || day < 1 || day > 31) return MISSING;
  return `${month} ${day}, ${Number(match[1])}`;
}

/** The parts a line's quantity is read from: a bid line has no priced parts, so its takeoff stands in. */
export function quantityParts(line: EstimateLine): readonly LinePart[] {
  return line.source === "bid" ? line.takeoff : line.parts;
}

/** `2,200 sf` for a line with one part, `3 parts` for several, a dash for none. */
export function quantityText(line: EstimateLine): string {
  const parts = quantityParts(line);
  const [only] = parts;
  if (only === undefined) return MISSING;
  return parts.length === 1 ? formatQuantity(only.quantity, only.unit) : `${parts.length} parts`;
}

/** The unit price of a line with one priced part, "Mixed" for several, a dash on a bid line (a bid has no unit price). */
export function unitCostText(line: EstimateLine): string {
  if (line.source === "bid") return MISSING;
  const [only] = line.parts;
  if (only === undefined) return MISSING;
  return line.parts.length === 1 ? formatMoney(only.unitPriceCents, { cents: true }) : "Mixed";
}

export interface DivisionGroup {
  division: Division;
  lines: EstimateLine[];
}

/** The lines grouped by division, in division order, each group in the lines' own order. A division with no lines is left out. */
export function groupByDivision(lines: readonly EstimateLine[]): DivisionGroup[] {
  return DIVISION_ORDER.map((division) => ({ division, lines: lines.filter((line) => line.division === division) })).filter(
    (group) => group.lines.length > 0,
  );
}
