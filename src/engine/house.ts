import { z } from "zod";
import type { ValidationIssue } from "./result";

const nonNegative = z.number().min(0, "Must be 0 or more");
const count = z.number().int("Must be a whole number").min(0, "Must be 0 or more");
const percent = z.number().min(0, "Must be 0 or more").max(100, "Must be 100 or less");

export const FinishTierSchema = z.enum(["standard", "upgraded", "luxury"]);
export type FinishTier = z.infer<typeof FinishTierSchema>;

const LevelSchema = z.object({
  finishedSf: nonNegative,
  unfinishedSf: nonNegative,
  ceilingFt: nonNegative,
});

/**
 * Structural shape of a house (spec §5.2): types, ranges, whole-number counts.
 * The cross-field blocking rules are applied by `validateHouse` once this parse succeeds.
 */
export const HouseModelSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(["described", "stockPlan"]),
  stockPlanRef: z.string().optional(),
  style: z.enum(["rambler", "twoStory", "multiLevel"]),
  levels: z.object({
    main: LevelSchema,
    upper: LevelSchema.optional(),
    basement: z
      .object({ totalSf: nonNegative, finishedSf: nonNegative, walkout: z.boolean() })
      .optional(),
  }),
  footprint: z.object({
    widthFt: nonNegative,
    depthFt: nonNegative,
    complexity: z.enum(["simple", "moderate", "complex"]),
  }),
  garage: z.object({ bays: count, tandem: z.boolean(), rvBay: z.boolean() }),
  roof: z.object({ style: z.enum(["gable", "hip", "mixed"]), pitchPer12: nonNegative }),
  rooms: z.object({
    bedrooms: count,
    fullBaths: count,
    halfBaths: count,
    fireplaces: count,
  }),
  exterior: z.object({
    stonePct: percent,
    stuccoPct: percent,
    boardBattenPct: percent,
    fiberCementPct: percent,
  }),
  finishes: z.object({
    houseTier: FinishTierSchema,
    overrides: z.object({
      kitchen: FinishTierSchema.optional(),
      primaryBath: FinishTierSchema.optional(),
      basement: FinishTierSchema.optional(),
    }),
  }),
  adu: z.object({
    type: z.enum(["none", "basement", "detached"]),
    finishedSf: nonNegative.optional(),
  }),
  pool: z.object({
    type: z.enum(["none", "fiberglass", "gunite"]),
    spa: z.boolean(),
    heated: z.boolean(),
  }),
  outside: z.object({
    coveredPatioSf: nonNegative,
    flatworkSf: nonNegative,
    fenceLf: nonNegative,
    landscapingTier: FinishTierSchema,
  }),
});

export type HouseModel = z.infer<typeof HouseModelSchema>;

/** An area of the house that is priced at its own finish tier. */
export type TierArea = "kitchen" | "primaryBath" | "basement" | "house";

/** The finish tier for an area: its override if one is set, otherwise the house tier. */
export function tierFor(h: HouseModel, area: TierArea): FinishTier {
  if (area === "house") return h.finishes.houseTier;
  return h.finishes.overrides[area] ?? h.finishes.houseTier;
}

/** Converts Zod issues to `ValidationIssue`s whose paths are the Zod paths joined with ".". */
export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

const EXTERIOR_SUM_TOLERANCE = 1e-6;
/** The footprint must cover at least this share of the main level. */
const MIN_FOOTPRINT_SHARE = 0.5;

/**
 * The blocking rules of spec §5.2 that a field-by-field parse cannot see.
 * Main and upper finished area can never exceed their totals (a total is finished plus
 * unfinished), and counts are checked by the schema, so only the basement needs a check here.
 */
function blockingRuleIssues(h: HouseModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { basement, main } = h.levels;

  if (basement && basement.finishedSf > basement.totalSf) {
    issues.push({
      path: "levels.basement.finishedSf",
      message: `Finished basement area (${basement.finishedSf} sf) cannot exceed the basement total (${basement.totalSf} sf)`,
    });
  }

  const { stonePct, stuccoPct, boardBattenPct, fiberCementPct } = h.exterior;
  const exteriorTotal = stonePct + stuccoPct + boardBattenPct + fiberCementPct;
  if (Math.abs(exteriorTotal - 100) > EXTERIOR_SUM_TOLERANCE) {
    issues.push({
      path: "exterior",
      message: `Exterior percentages must add up to 100 (they add up to ${exteriorTotal})`,
    });
  }

  const footprintSf = h.footprint.widthFt * h.footprint.depthFt;
  const mainTotalSf = main.finishedSf + main.unfinishedSf;
  if (footprintSf < MIN_FOOTPRINT_SHARE * mainTotalSf) {
    issues.push({
      path: "footprint",
      message: `Footprint (${footprintSf} sf) must be at least half of the main level (${mainTotalSf} sf)`,
    });
  }

  if (h.adu.type === "basement" && !basement) {
    issues.push({ path: "adu.type", message: "A basement ADU requires a basement" });
  }

  return issues;
}

/**
 * Checks a house document. Returns schema issues if the shape is wrong, otherwise the
 * broken blocking rules; an empty array means the house is valid. Paths are dotted, unprefixed.
 */
export function validateHouse(h: unknown): ValidationIssue[] {
  const parsed = HouseModelSchema.safeParse(h);
  if (!parsed.success) return zodIssues(parsed.error);
  return blockingRuleIssues(parsed.data);
}
