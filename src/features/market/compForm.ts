import { CompSchema } from "@engine";
import type { BasementFinish, Cents, Comp, ValidationIssue } from "@engine";
import { formatMoneyInput, formatNumberInput, parseDollars, parseNumber } from "../../lib/format";

/**
 * What the comp form holds: the text of each box as it was typed, plus the toggles and the basement finish. Nothing
 * here has been understood yet; `compFromForm` does that when Save is chosen.
 */
export interface CompFormValues {
  address: string;
  city: string;
  county: string;
  listDate: string;
  contractDate: string;
  soldDate: string;
  soldPrice: string;
  listPrice: string;
  aboveGradeSf: string;
  basementSf: string;
  unfinishedSf: string;
  beds: string;
  baths: string;
  yearBuilt: string;
  lotAcres: string;
  garageBays: string;
  basementFinish: BasementFinish;
  walkout: boolean;
  adu: boolean;
  pool: boolean;
}

/** The form's boxes that hold text, in the order the form shows them (and so the order issues are listed in). */
export type CompFormField =
  | "address"
  | "city"
  | "county"
  | "listDate"
  | "contractDate"
  | "soldDate"
  | "soldPrice"
  | "listPrice"
  | "aboveGradeSf"
  | "basementSf"
  | "unfinishedSf"
  | "beds"
  | "baths"
  | "yearBuilt"
  | "lotAcres"
  | "garageBays";

const FIELD_ORDER: readonly CompFormField[] = [
  "address",
  "city",
  "county",
  "listDate",
  "contractDate",
  "soldDate",
  "soldPrice",
  "listPrice",
  "aboveGradeSf",
  "basementSf",
  "unfinishedSf",
  "beds",
  "baths",
  "yearBuilt",
  "lotAcres",
  "garageBays",
];

/** A new comp's form: the county of the deal it is added from, and everything else empty. */
export function emptyCompForm(county: string): CompFormValues {
  return {
    address: "",
    city: "",
    county,
    listDate: "",
    contractDate: "",
    soldDate: "",
    soldPrice: "",
    listPrice: "",
    aboveGradeSf: "",
    basementSf: "",
    unfinishedSf: "",
    beds: "",
    baths: "",
    yearBuilt: "",
    lotAcres: "",
    garageBays: "",
    basementFinish: "none",
    walkout: false,
    adu: false,
    pool: false,
  };
}

/** Dollars as the form shows them: whole dollars, with cents only for an amount that has them. */
const moneyText = (cents: Cents): string => formatMoneyInput(cents, cents % 100 !== 0);

/** A comp's facts as the text of each box, for editing it. */
export function formFromComp(comp: Comp): CompFormValues {
  return {
    address: comp.address,
    city: comp.city,
    county: comp.county,
    listDate: comp.listDate ?? "",
    contractDate: comp.contractDate ?? "",
    soldDate: comp.soldDate ?? "",
    soldPrice: comp.soldPriceCents === undefined ? "" : moneyText(comp.soldPriceCents),
    listPrice: comp.listPriceCents === undefined ? "" : moneyText(comp.listPriceCents),
    aboveGradeSf: formatNumberInput(comp.aboveGradeFinishedSf),
    basementSf: formatNumberInput(comp.basementFinishedSf),
    unfinishedSf: formatNumberInput(comp.unfinishedSf),
    beds: formatNumberInput(comp.beds),
    baths: formatNumberInput(comp.baths),
    // A year with a thousands comma would not be a year.
    yearBuilt: String(comp.yearBuilt),
    lotAcres: formatNumberInput(comp.lotAcres),
    garageBays: formatNumberInput(comp.garageBays),
    basementFinish: comp.basementFinish,
    walkout: comp.walkout,
    adu: comp.adu,
    pool: comp.pool,
  };
}

/** Facts a comp can carry that the form has no box for, so an edit must not drop them. */
export function keepUnshownFields(edited: Comp, original: Comp): Comp {
  const kept = { ...edited };
  if (original.originalListPriceCents !== undefined) kept.originalListPriceCents = original.originalListPriceCents;
  if (original.priceCuts !== undefined) kept.priceCuts = original.priceCuts;
  if (original.notes !== undefined) kept.notes = original.notes;
  return kept;
}

/** The form field each comp field is typed in, where the two names differ. */
const FORM_FIELD: Record<string, CompFormField> = {
  soldPriceCents: "soldPrice",
  listPriceCents: "listPrice",
  aboveGradeFinishedSf: "aboveGradeSf",
  basementFinishedSf: "basementSf",
  unfinishedSf: "unfinishedSf",
  garageBays: "garageBays",
};

interface NumberBox {
  field: CompFormField;
  key: string;
  integer: boolean;
  /** What a blank box means: it is asked for, or it counts as zero. */
  blank: "required" | 0;
}

const NUMBER_BOXES: readonly NumberBox[] = [
  { field: "aboveGradeSf", key: "aboveGradeFinishedSf", integer: false, blank: "required" },
  { field: "basementSf", key: "basementFinishedSf", integer: false, blank: 0 },
  { field: "unfinishedSf", key: "unfinishedSf", integer: false, blank: 0 },
  { field: "beds", key: "beds", integer: false, blank: 0 },
  { field: "baths", key: "baths", integer: false, blank: 0 },
  { field: "yearBuilt", key: "yearBuilt", integer: true, blank: "required" },
  { field: "lotAcres", key: "lotAcres", integer: false, blank: 0 },
  { field: "garageBays", key: "garageBays", integer: true, blank: 0 },
];

/** A comp is new construction when it sold within this many years of being built (the same cut-off the scoring uses). */
const NEW_CONSTRUCTION_YEARS = 3;

/**
 * Turns the form into a comp: a sold, hand-entered, verified comp in `region` with the given id. Required boxes are
 * checked first, then everything else against `CompSchema`; each problem is reported once, at the form field it
 * belongs to, in the order the form shows its fields. There is no comp while there is any problem.
 *
 * A blank list price means the sold price. A blank contract date is left out, never stored as null. A blank area,
 * bed, bath, lot or garage box counts as zero.
 */
export function compFromForm(
  values: CompFormValues,
  region: string,
  id: string,
): { comp?: Comp; issues: ValidationIssue[] } {
  const found: ValidationIssue[] = [];
  /** Only the first problem with a field is kept: the box shows one message. */
  const report = (path: string, message: string) => {
    if (!found.some((issue) => issue.path === path)) found.push({ path, message });
  };
  const hasIssue = (path: string) => found.some((issue) => issue.path === path);

  const candidate: Record<string, unknown> = {
    id,
    region,
    status: "sold",
    county: values.county.trim(),
    basementFinish: values.basementFinish,
    walkout: values.walkout,
    adu: values.adu,
    pool: values.pool,
    source: "manual",
    verified: true,
  };

  for (const field of ["address", "city"] as const) {
    const text = values[field].trim();
    if (text === "") report(field, "Required");
    else candidate[field] = text;
  }

  for (const field of ["listDate", "soldDate"] as const) {
    const text = values[field].trim();
    if (text === "") report(field, "Required");
    else candidate[field] = text;
  }
  if (values.contractDate.trim() !== "") candidate.contractDate = values.contractDate.trim();

  const soldText = values.soldPrice.trim();
  if (soldText === "") {
    report("soldPrice", "Enter the sold price");
  } else {
    const cents = parseDollars(soldText, { allowCents: true });
    if (cents === null) report("soldPrice", "Enter a dollar amount");
    else candidate.soldPriceCents = cents;
  }

  const listText = values.listPrice.trim();
  if (listText === "") {
    // Only a price that is itself fine is copied, so a bad sold price is not reported a second time at the list price.
    const sold = candidate.soldPriceCents;
    if (typeof sold === "number" && sold > 0) candidate.listPriceCents = sold;
  } else {
    const cents = parseDollars(listText, { allowCents: true });
    if (cents === null) report("listPrice", "Enter a dollar amount");
    else candidate.listPriceCents = cents;
  }

  for (const { field, key, integer, blank } of NUMBER_BOXES) {
    const text = values[field].trim();
    if (text === "") {
      if (blank === "required") report(field, "Required");
      else candidate[key] = blank;
      continue;
    }
    const n = parseNumber(text, { integer });
    if (n === null) report(field, integer ? "Enter a whole number" : "Enter a number");
    else candidate[key] = n;
  }

  const soldDate = candidate.soldDate;
  const yearBuilt = candidate.yearBuilt;
  const soldYear = typeof soldDate === "string" && /^\d{4}-/.test(soldDate) ? Number(soldDate.slice(0, 4)) : Number.NaN;
  candidate.newConstruction = typeof yearBuilt === "number" && soldYear - yearBuilt <= NEW_CONSTRUCTION_YEARS;

  const parsed = CompSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      report(FORM_FIELD[key] ?? key, issue.message);
    }
  }

  // Dates in this form compare in order as text. A date that already has a message is not compared.
  const usable = (path: CompFormField, value: unknown): value is string => typeof value === "string" && !hasIssue(path);
  const listDate = candidate.listDate;
  const contractDate = candidate.contractDate;
  if (usable("listDate", listDate) && usable("soldDate", soldDate) && soldDate < listDate) {
    report("soldDate", "Sold date is before the list date");
  }
  if (usable("contractDate", contractDate)) {
    if (usable("listDate", listDate) && contractDate < listDate) report("contractDate", "Contract date is before the list date");
    if (usable("soldDate", soldDate) && contractDate > soldDate) report("contractDate", "Contract date is after the sold date");
  }

  const rank = (path: string) => {
    const index = FIELD_ORDER.indexOf(path as CompFormField);
    return index === -1 ? FIELD_ORDER.length : index;
  };
  const issues = [...found].sort((a, b) => rank(a.path) - rank(b.path));

  if (issues.length === 0 && parsed.success) return { comp: parsed.data, issues };
  return { issues };
}
