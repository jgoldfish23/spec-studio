import { z } from "zod";
import { DealInputsSchema } from "@engine";
import type { Comp, CostBookView, DealInputs, MarketSettings, Rules, ValidationIssue } from "@engine";

export const DEAL_STATUSES = ["analyzing", "bought", "building", "listed", "sold", "dropped"] as const;
export const DealStatusSchema = z.enum(DEAL_STATUSES);
/** Where a deal stands in its life, from first look to a sale or a pass. */
export type DealStatus = z.infer<typeof DealStatusSchema>;

// Zod issue codes that mean the stored shape is wrong: a missing or mistyped field, a value outside an enum, a
// bad union tag or record entry. Every other code (too small, too big, a bad format, a failed `refine`) is a
// value the owner can still correct, and the engine's `validateDeal` reports it as "Needs info".
const STRUCTURAL_CODES: ReadonlySet<string> = new Set([
  "invalid_type",
  "invalid_union",
  "invalid_value",
  "invalid_key",
  "invalid_element",
]);

function isStructural(issue: z.core.$ZodIssue): boolean {
  // Zod 4 reports a non-integer in an `.int()` field as `invalid_type` with `expected: "int"`. That is a fixable
  // value (the owner typed 2.5 months), not a wrong shape.
  if (issue.code === "invalid_type") return (issue.expected as string) !== "int";
  return STRUCTURAL_CODES.has(issue.code);
}

function structuralZodIssues(inputs: unknown): z.core.$ZodIssue[] {
  const parsed = DealInputsSchema.safeParse(inputs);
  return parsed.success ? [] : parsed.error.issues.filter(isStructural);
}

/**
 * The problems that make stored deal inputs unreadable: a field missing, of the wrong type (NaN and Infinity
 * count), or outside its enum. A value that merely breaks a rule (an empty city, a loan-to-cost over the limit,
 * a finished basement bigger than the basement, 2.5 build months) is not listed, because the owner can fix it
 * in the app. Paths are dotted from the inputs' root, like `validateDeal`'s; the root itself is `""`.
 */
export function structuralInputIssues(inputs: unknown): ValidationIssue[] {
  return structuralZodIssues(inputs).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/**
 * A deal as stored: the engine's inputs plus a name, a status and timestamps. The timestamps are ISO date-times;
 * an offset (`+00:00`) is accepted as well as `Z`, because Postgres writes one.
 *
 * `inputs` is checked for shape only (`structuralInputIssues`). A deal is saved while the owner is still filling it
 * in, and a brand-new one has an empty city, so a record that breaks a fixable rule must still load; the engine's
 * `validateDeal` then says what is missing. The parsed `inputs` is the stored object itself, not Zod's copy, so a
 * field this version does not know about is kept rather than stripped.
 */
export const StoredDealSchema = z.object({
  id: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  status: DealStatusSchema,
  inputs: z.custom<DealInputs>().superRefine((value, ctx) => {
    for (const issue of structuralZodIssues(value)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  }),
  createdAt: z.iso.datetime({ offset: true, error: "Must be an ISO date-time" }),
  updatedAt: z.iso.datetime({ offset: true, error: "Must be an ISO date-time" }),
});
export type StoredDeal = z.infer<typeof StoredDealSchema>;

/** Company-wide settings every new deal starts from. */
export interface CompanySettings {
  rules: Rules;
  contingencyPct: number;
}

/** The deals that could be read, and one problem entry for each stored deal that could not. */
export interface DealListResult {
  deals: StoredDeal[];
  problems: { id: string; message: string }[];
}

/** A stored record that cannot be read: not valid JSON, or valid JSON that fails its schema. */
export class DataError extends Error {
  recordId?: string;
  path?: string;

  constructor(message: string, options: { recordId?: string; path?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DataError";
    this.recordId = options.recordId;
    this.path = options.path;
  }
}

/** Everything the screens read and write. The demo build keeps it in localStorage; the hosted build keeps it in Supabase. */
export interface Repository {
  listDeals(): Promise<DealListResult>;
  /** Null when there is no such deal; a `DataError` when one is stored but its shape is unreadable. */
  getDeal(id: string): Promise<StoredDeal | null>;
  createDeal(input: { name: string; inputs: DealInputs }): Promise<StoredDeal>;
  /** Returns the deal with a fresh `updatedAt`. */
  saveDeal(deal: StoredDeal): Promise<StoredDeal>;
  deleteDeal(id: string): Promise<void>;
  /** Removes every deal: the way out of a store that cannot be read. */
  resetDeals(): Promise<void>;
  listComps(region: string): Promise<Comp[]>;
  /** Inserts the comp, or replaces the one with the same id. */
  saveComp(comp: Comp): Promise<Comp>;
  deleteComp(id: string): Promise<void>;
  getCostBook(region: string): Promise<CostBookView>;
  getMarketSettings(region: string): Promise<MarketSettings>;
  getCompanySettings(): Promise<CompanySettings>;
}
