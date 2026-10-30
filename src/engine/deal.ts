import { z } from "zod";
import { addMonths, type YearMonth } from "./dates";
import { HouseModelSchema, validateHouse, zodIssues } from "./house";
import type { ValidationIssue } from "./result";

const cents = z.number().int("Must be a whole number of cents").min(0, "Must be 0 or more");
const months = z.number().int("Must be a whole number of months").min(0, "Must be 0 or more");
const rate = z
  .number()
  .min(0, "Must be 0 or more")
  .max(1, "Must be 1 or less (use a decimal, e.g. 0.09 for 9%)");
const nonNegative = z.number().min(0, "Must be 0 or more");
const days = z.number().int("Must be a whole number of days").min(0, "Must be 0 or more");
// Fields with a tighter range get their own schema: chaining onto `months` or `rate` would
// run both ranges and report two issues for one bad value.
const buildMonths = z.number().int("Must be a whole number of months").min(1, "Must be at least 1");
const loanToCost = z.number().min(0, "Must be 0 or more").max(0.95, "Must be 0.95 or less");

const UTILITIES = ["water", "sewer", "gas", "power", "secondaryWater"] as const;
export const UtilitySchema = z.enum(UTILITIES);
export type Utility = z.infer<typeof UtilitySchema>;

export const UtilityStatusSchema = z.enum(["available", "needsConnection", "unknown"]);
export type UtilityStatus = z.infer<typeof UtilityStatusSchema>;

export const LotSchema = z.object({
  city: z.string().min(1, "Required"),
  county: z.string().min(1, "Required"),
  region: z.string().min(1, "Required"),
  acres: nonNegative,
  frontageFt: nonNegative.optional(),
  priceCents: cents,
  closingCents: cents,
  financing: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cash") }),
    z.object({ kind: z.literal("loan"), ltv: rate, rate, points: rate }),
  ]),
  utilities: z.record(UtilitySchema, UtilityStatusSchema),
  hoaMonthlyCents: cents,
  propertyTaxRate: rate,
});
export type Lot = z.infer<typeof LotSchema>;

export const TimelineSchema = z
  .object({
    landClose: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be a month as YYYY-MM"),
    preConMonths: months,
    buildMonths,
    listEarlyMonths: months,
    closingDays: days,
  })
  // Skipped while `buildMonths` is itself invalid, so one bad value does not raise a second issue.
  .refine((t) => t.buildMonths < 1 || t.listEarlyMonths <= t.buildMonths, {
    path: ["listEarlyMonths"],
    message: "Cannot list earlier than the build is long",
  });
export type Timeline = z.infer<typeof TimelineSchema>;

export const ConstructionLoanSchema = z.object({
  ltc: loanToCost,
  rate,
  points: rate,
  drawFeeCents: cents,
  termMonths: months,
  extensionPct: rate,
  extensionMonths: months,
  interestMode: z.enum(["paid", "capitalized"]),
});
export type ConstructionLoan = z.infer<typeof ConstructionLoanSchema>;

export const CarrySchema = z.object({
  insuranceRate: rate,
  utilitiesBuildMonthlyCents: cents,
  utilitiesAfterMonthlyCents: cents,
  stagingMonthlyCents: cents,
  upkeepMonthlyCents: cents,
});
export type Carry = z.infer<typeof CarrySchema>;

export const SellingSchema = z.object({
  listingPct: rate,
  buyerPct: rate,
  closingPct: rate,
  concessionsCents: cents,
});
export type Selling = z.infer<typeof SellingSchema>;

export const RulesSchema = z.object({
  minMarginOnSale: rate,
  minAnnualizedReturn: rate,
  minDownsideProfitCents: cents,
});
export type Rules = z.infer<typeof RulesSchema>;

export const ScenarioDefSchema = z.object({
  priceSource: z.enum(["low", "mid", "high"]),
  domSource: z.enum(["low", "typical", "high"]),
  overrunPct: rate,
});
export type ScenarioDef = z.infer<typeof ScenarioDefSchema>;

export const ScenarioDefsSchema = z.object({
  downside: ScenarioDefSchema,
  base: ScenarioDefSchema,
  upside: ScenarioDefSchema,
});
export type ScenarioDefs = z.infer<typeof ScenarioDefsSchema>;

export const BidSchema = z.object({
  code: z.string().min(1, "Required"),
  amountCents: cents,
  vendor: z.string().min(1, "Required"),
  receivedOn: z.iso.date("Must be a real date as YYYY-MM-DD"),
  notes: z.string().optional(),
});
export type Bid = z.infer<typeof BidSchema>;

export const DealInputsSchema = z.object({
  lot: LotSchema,
  house: HouseModelSchema,
  timeline: TimelineSchema,
  loan: ConstructionLoanSchema,
  carry: CarrySchema,
  selling: SellingSchema,
  rules: RulesSchema,
  scenarioDefs: ScenarioDefsSchema,
  contingencyPct: rate,
  overrides: z.object({
    basePriceCents: cents.optional(),
    baseDomDays: days.optional(),
  }),
  plannedListPriceCents: cents.optional(),
  bids: z.array(BidSchema),
  compSelections: z.record(z.string(), z.boolean()),
});
export type DealInputs = z.infer<typeof DealInputsSchema>;

export const DEFAULT_RULES: Rules = {
  minMarginOnSale: 0.15,
  minAnnualizedReturn: 0.25,
  minDownsideProfitCents: 0,
};

export const DEFAULT_SCENARIO_DEFS: ScenarioDefs = {
  downside: { priceSource: "low", domSource: "high", overrunPct: 0.05 },
  base: { priceSource: "mid", domSource: "typical", overrunPct: 0 },
  upside: { priceSource: "high", domSource: "low", overrunPct: 0 },
};

/** The month the house goes on the market: land close plus pre-construction plus build, less any early listing. */
export function listYearMonth(t: Timeline): YearMonth {
  return addMonths(t.landClose, t.preConMonths + t.buildMonths - t.listEarlyMonths);
}

/**
 * Checks a whole deal: schema issues for every section, plus the house's blocking rules
 * (prefixed `house.`). An empty array means the deal is valid. Paths are dotted.
 */
export function validateDeal(d: unknown): ValidationIssue[] {
  const parsed = DealInputsSchema.safeParse(d);
  const issues = parsed.success ? [] : zodIssues(parsed.error);
  if (typeof d !== "object" || d === null || !("house" in d) || d.house === undefined) return issues;

  // When the house shape is wrong the deal parse already reported it under `house.`; skip repeats.
  const seen = new Set(issues.map((i) => `${i.path}\u0000${i.message}`));
  for (const issue of validateHouse(d.house)) {
    const path = issue.path === "" ? "house" : `house.${issue.path}`;
    if (!seen.has(`${path}\u0000${issue.message}`)) issues.push({ path, message: issue.message });
  }
  return issues;
}
