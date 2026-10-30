import { z } from "zod";
import { COST_CODES } from "./costbook";
import { DateIn1900To2100Schema } from "./deal";
import { FinishTierSchema, zodIssues } from "./house";
import type { MarketSettings } from "./market";
import type { ValidationIssue } from "./result";

/**
 * Schemas for everything an evaluation reads besides the deal (spec §5): the comps, the cost book,
 * the market settings and the quantity rules, plus `today`. `evaluateDeal` checks them first, so a
 * bad date, a NaN or a short seasonal curve is reported instead of throwing or reaching a result.
 * Each schema infers exactly the engine type it guards; `context.test.ts` checks that.
 */

const date = DateIn1900To2100Schema;

const nonNegative = z.number().min(0, "Must be 0 or more");
const aboveZero = z.number().gt(0, "Must be above 0");
const wholeCents = z.number().int("Must be a whole number of cents");
const cents = wholeCents.min(0, "Must be 0 or more");
const positiveCents = wholeCents.gt(0, "Must be above 0");
const wholeNumber = (min: number, max?: number) => {
  const schema = z.number().int("Must be a whole number").min(min, `Must be ${min} or more`);
  return max === undefined ? schema : schema.max(max, `Must be ${max} or less`);
};

export const CompSchema = z.object({
  id: z.string(),
  address: z.string(),
  city: z.string(),
  county: z.string(),
  region: z.string(),
  status: z.enum(["sold", "active", "pending"]),
  listDate: date.optional(),
  listPriceCents: positiveCents.optional(),
  originalListPriceCents: positiveCents.optional(),
  priceCuts: wholeNumber(0).optional(),
  contractDate: date.optional(),
  soldDate: date.optional(),
  soldPriceCents: positiveCents.optional(),
  aboveGradeFinishedSf: nonNegative,
  basementFinishedSf: nonNegative,
  unfinishedSf: nonNegative,
  beds: nonNegative,
  baths: nonNegative,
  yearBuilt: wholeNumber(1800, 2100),
  newConstruction: z.boolean(),
  lotAcres: nonNegative,
  garageBays: wholeNumber(0, 10),
  basementFinish: z.enum(["none", "unfinished", "partial", "finished"]),
  walkout: z.boolean(),
  adu: z.boolean(),
  pool: z.boolean(),
  source: z.enum(["manual", "csv", "claudeFile", "ownSale"]),
  verified: z.boolean(),
  notes: z.string().optional(),
});

const WEIGHTS_TOTAL = 100;
const WEIGHTS_TOLERANCE = 1e-9;

type Weights = MarketSettings["similarityWeights"];
const weightsTotal = (w: Weights): number => w.location + w.size + w.age + w.recency + w.features;
const isWeight = (x: unknown): boolean => typeof x === "number" && x >= 0;

const SimilarityWeightsSchema = z
  .object({
    location: nonNegative,
    size: nonNegative,
    age: nonNegative,
    recency: nonNegative,
    features: nonNegative,
  })
  // Skipped while a weight is itself invalid, so one bad value does not raise a second issue.
  .refine((w) => !Object.values(w).every(isWeight) || Math.abs(weightsTotal(w) - WEIGHTS_TOTAL) <= WEIGHTS_TOLERANCE, {
    error: (issue) =>
      `Similarity weights must add up to ${WEIGHTS_TOTAL} (they add up to ${weightsTotal(issue.input as Weights)})`,
  });

export const MarketSettingsSchema = z.object({
  region: z.string(),
  basementFactor: z.number().min(0, "Must be 0 or more").max(1, "Must be 1 or less"),
  featureValues: z.object({
    garageBayCents: cents,
    walkoutCents: cents,
    lotPerAcreCents: cents,
    aduCents: cents,
    poolCents: cents,
  }),
  similarityWeights: SimilarityWeightsSchema,
  includeThreshold: z.number().min(0, "Must be 0 or more").max(100, "Must be 100 or less"),
  // One factor per list month, January first; the days-on-market step reads the month it lists in.
  // A refine, not `.length()`: that check also runs on a string, which would add a second issue.
  seasonalFactors: z.array(aboveZero).refine((factors) => factors.length === 12, "Needs 12 monthly factors, January first"),
  elasticity: nonNegative,
  marketCondition: z.enum(["hot", "normal", "slow"]),
  conditionFactors: z.object({ hot: aboveZero, normal: aboveZero, slow: aboveZero }),
  assumedClosingDays: wholeNumber(0, 180),
  defaultTaxRate: z.number().min(0, "Must be 0 or more").max(0.1, "Must be 0.1 or less (use a decimal, e.g. 0.0048)"),
});

const COST_CODE_IDS = COST_CODES.map((c) => c.id);
const PriceKeySchema = z.object({
  code: z.enum(COST_CODE_IDS, "Must be one of the cost codes"),
  variant: z.string(),
  tier: FinishTierSchema.nullable(),
});
const UnitSchema = z.enum(["sf", "lf", "yd3", "sq", "ea", "ton", "mo", "ls"]);

// `DefaultPrice` and `PriceBookEntry` are `PriceKey & {...}`, and only an intersection infers to that exactly.
export const DefaultPriceSchema = z.intersection(
  PriceKeySchema,
  z.object({
    region: z.string(),
    unitPriceCents: cents,
    unit: UnitSchema,
    asOf: date,
    verified: z.boolean(),
    sourceNote: z.string(),
  }),
);

export const PriceBookEntrySchema = z.intersection(
  PriceKeySchema,
  z.object({
    unitPriceCents: cents,
    unit: UnitSchema,
    asOf: date,
    vendor: z.string().optional(),
    notes: z.string().optional(),
  }),
);

export const CostBookViewSchema = z.object({
  defaults: z.array(DefaultPriceSchema),
  priceBook: z.array(PriceBookEntrySchema),
});

// A rule the takeoff divides by must be above zero, or a quantity comes out infinite or NaN.
const divisor = z.number().gt(0, "Must be above 0 (the takeoff divides by it)");

export const QuantityRulesSchema = z.object({
  foundationComplexity: z.object({ simple: nonNegative, moderate: nonNegative, complex: nonNegative }),
  garage: z.object({ sfPerBay: nonNegative, rvBaySf: nonNegative, baysPerDoubleDoor: nonNegative }),
  excavation: z.object({ basementDepthFt: nonNegative, slabDepthFt: nonNegative, cubicFtPerYd3: divisor }),
  roof: z.object({
    overhang: nonNegative,
    styleFactor: z.object({ gable: nonNegative, hip: nonNegative, mixed: nonNegative }),
    sfPerSquare: divisor,
  }),
  exteriorWall: z.object({
    heightAllowanceFt: nonNegative,
    garageFtPerBay: nonNegative,
    garageFtBase: nonNegative,
    garageHeightFt: nonNegative,
    openingsShare: nonNegative,
  }),
  windows: z.object({ sfPerWindow: divisor, basementFinishedSfPerWindow: divisor }),
  drywall: z.object({ perFinishedSf: nonNegative, perGarageSf: nonNegative }),
  plumbing: z.object({
    perFullBath: nonNegative,
    perHalfBath: nonNegative,
    kitchen: nonNegative,
    laundry: nonNegative,
    hoseBibs: nonNegative,
    waterHeater: nonNegative,
    adu: nonNegative,
  }),
  hvac: z.object({ sfPerTon: divisor, tonStep: divisor }),
  cabinets: z.object({
    kitchenLfByTier: z.object({ standard: nonNegative, upgraded: nonNegative, luxury: nonNegative }),
    lfPerFullBathVanity: nonNegative,
    lfPerHalfBathVanity: nonNegative,
    laundryLf: nonNegative,
    aduKitchenLf: nonNegative,
  }),
  flooring: z.object({
    hardShareByTier: z.object({ standard: nonNegative, upgraded: nonNegative, luxury: nonNegative }),
    basementHardShare: nonNegative,
    tileSfPerFullBath: nonNegative,
    tileSfPerHalfBath: nonNegative,
    tileSfLaundry: nonNegative,
  }),
  sfPerAcre: nonNegative,
});

export const EngineContextSchema = z.object({
  today: date,
  costBook: CostBookViewSchema,
  comps: z.array(CompSchema),
  marketSettings: MarketSettingsSchema,
  quantityRules: QuantityRulesSchema,
});

/**
 * Checks everything an evaluation reads besides the deal. An empty array means the context is
 * usable. Paths are dotted and start with the context key (`comps.3.soldDate`,
 * `costBook.defaults.12.unitPriceCents`, `marketSettings.similarityWeights`, `today`); a context
 * that is not an object at all is reported at `context`. A rule that spans fields, such as the
 * similarity weights adding up to 100, raises one issue at the object that holds them.
 */
export function validateContext(ctx: unknown): ValidationIssue[] {
  const parsed = EngineContextSchema.safeParse(ctx);
  if (parsed.success) return [];
  // An intersection checks the same value on both sides, so a cost-book entry that is not an object is reported twice.
  const seen = new Set<string>();
  return zodIssues(parsed.error)
    .map((issue) => (issue.path === "" ? { ...issue, path: "context" } : issue))
    .filter((issue) => {
      const key = `${issue.path}\u0000${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
