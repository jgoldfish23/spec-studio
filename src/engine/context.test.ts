import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { GOLDEN_COMPS } from "./__fixtures__/golden";
import {
  CompSchema,
  CostBookViewSchema,
  DefaultPriceSchema,
  EngineContextSchema,
  MarketSettingsSchema,
  PriceBookEntrySchema,
  QuantityRulesSchema,
  validateContext,
} from "./context";
import type { CostBookView, DefaultPrice, PriceBookEntry } from "./costbook";
import type { EngineContext } from "./evaluate";
import { DEFAULT_MARKET_SETTINGS, type Comp, type MarketSettings } from "./market";
import { DEFAULT_QUANTITY_RULES, type QuantityRules } from "./quantities";

const DEFAULT_PRICE: DefaultPrice = {
  code: "framing",
  variant: "base",
  tier: null,
  region: "utah-north",
  unitPriceCents: 650,
  unit: "sf",
  asOf: "2026-01-15",
  verified: true,
  sourceNote: "Starter price",
};

const BOOK_ENTRY: PriceBookEntry = {
  code: "windows",
  variant: "window",
  tier: "upgraded",
  unitPriceCents: 85_000,
  unit: "ea",
  asOf: "2026-03-01",
  vendor: "Wasatch Windows",
  notes: "Quoted twice",
};

/** The golden context, with one regional default so cost-book paths exist. A fresh copy every call. */
const goldenContext = (): EngineContext => ({
  today: "2026-10-30",
  costBook: { defaults: [{ ...DEFAULT_PRICE }], priceBook: [] },
  comps: structuredClone(GOLDEN_COMPS),
  marketSettings: structuredClone(DEFAULT_MARKET_SETTINGS),
  quantityRules: structuredClone(DEFAULT_QUANTITY_RULES),
});

/** A comp with every optional field filled in. */
const fullComp = (): Comp => ({
  ...structuredClone(GOLDEN_COMPS[0]!),
  listDate: "2026-04-15",
  listPriceCents: 136_500_000,
  originalListPriceCents: 140_000_000,
  priceCuts: 1,
  contractDate: "2026-05-20",
  soldDate: "2026-06-15",
  soldPriceCents: 136_500_000,
  notes: "Corner lot",
});

/** A context with every optional field filled in, so every leaf has something to poison. */
const fullContext = (): EngineContext => ({
  ...goldenContext(),
  costBook: { defaults: [{ ...DEFAULT_PRICE }], priceBook: [{ ...BOOK_ENTRY }] },
  comps: [fullComp()],
});

/** Writes `value` at a dotted path inside a context copy, then returns it as the unknown input a caller would hand over. */
function setAt(ctx: EngineContext, path: string, value: unknown): unknown {
  const keys = path.split(".");
  const last = keys.pop()!;
  let node: unknown = ctx;
  for (const key of keys) node = (node as Record<string, unknown>)[key];
  (node as Record<string, unknown>)[last] = value;
  return ctx;
}

const issuePaths = (ctx: unknown): string[] => validateContext(ctx).map((i) => i.path);

/** Every path to a string, number or boolean inside `value`, as dotted paths under `prefix`. */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix === "" ? key : `${prefix}.${key}`));
}

describe("validateContext on a good context", () => {
  it("accepts the golden context (golden comps, default settings and rules, an empty cost book)", () => {
    const ctx: EngineContext = {
      today: "2026-10-30",
      costBook: { defaults: [], priceBook: [] },
      comps: GOLDEN_COMPS,
      marketSettings: DEFAULT_MARKET_SETTINGS,
      quantityRules: DEFAULT_QUANTITY_RULES,
    };
    expect(validateContext(ctx)).toEqual([]);
  });

  it("accepts a context with every optional field filled in and a price book entry", () => {
    expect(validateContext(fullContext())).toEqual([]);
  });

  it("accepts no comps at all, and a context with no price book entries", () => {
    expect(validateContext({ ...goldenContext(), comps: [] })).toEqual([]);
  });

  it("does not change what it is given", () => {
    const ctx = goldenContext();
    validateContext(ctx);
    expect(ctx).toEqual(goldenContext());
  });
});

describe("validateContext reports one issue at the field's path", () => {
  const cases: [name: string, path: string, value: unknown][] = [
    ["a US-style sold date", "comps.0.soldDate", "6/15/2026"],
    ["a sold date that is not on the calendar", "comps.0.soldDate", "2026-02-30"],
    ["an empty today", "today", ""],
    ["a regional default dated with slashes", "costBook.defaults.0.asOf", "01/01/2026"],
    ["a NaN unit price", "costBook.defaults.0.unitPriceCents", NaN],
    ["a null unit price", "costBook.defaults.0.unitPriceCents", null],
    ["an 11-month seasonal curve", "marketSettings.seasonalFactors", DEFAULT_MARKET_SETTINGS.seasonalFactors.slice(0, 11)],
    ["a NaN sold price", "comps.0.soldPriceCents", NaN],
  ];

  it.each(cases)("%s", (_name, path, value) => {
    const issues = validateContext(setAt(goldenContext(), path, value));
    expect(issues.map((i) => i.path)).toEqual([path]);
    expect(issues[0]?.message).not.toBe("");
  });

  it("reports similarity weights that add up to 105 once, on the weights object", () => {
    const settings = structuredClone(DEFAULT_MARKET_SETTINGS);
    settings.similarityWeights.size = 30;
    const issues = validateContext({ ...goldenContext(), marketSettings: settings });
    expect(issues.map((i) => i.path)).toEqual(["marketSettings.similarityWeights"]);
    expect(issues[0]?.message).toContain("100");
    expect(issues[0]?.message).toContain("105");
  });

  it("numbers comps and cost-book entries by position", () => {
    const ctx = goldenContext();
    ctx.comps = [...ctx.comps, ...structuredClone(ctx.comps)];
    ctx.costBook.defaults = Array.from({ length: 13 }, () => ({ ...DEFAULT_PRICE }));
    expect(issuePaths(setAt(ctx, "comps.3.soldDate", "tomorrow"))).toEqual(["comps.3.soldDate"]);
    // Issues come in the context's key order: today, costBook, comps, marketSettings, quantityRules.
    expect(issuePaths(setAt(ctx, "costBook.defaults.12.unitPriceCents", -1))).toEqual([
      "costBook.defaults.12.unitPriceCents",
      "comps.3.soldDate",
    ]);
  });

  it("reports every bad field, across keys, in one pass", () => {
    const ctx = goldenContext();
    setAt(ctx, "today", "soon");
    setAt(ctx, "comps.1.beds", -2);
    setAt(ctx, "marketSettings.assumedClosingDays", 400);
    setAt(ctx, "quantityRules.sfPerAcre", NaN);
    expect(issuePaths(ctx).sort()).toEqual(
      ["comps.1.beds", "marketSettings.assumedClosingDays", "quantityRules.sfPerAcre", "today"].sort(),
    );
  });
});

describe("validateContext on input that is not a context", () => {
  it.each([null, undefined, 42, "ctx", []])("reports %j at \"context\" instead of throwing", (input) => {
    expect(issuePaths(input)).toEqual(["context"]);
  });

  it("reports each missing key by name", () => {
    expect(issuePaths({}).sort()).toEqual(["comps", "costBook", "marketSettings", "quantityRules", "today"].sort());
  });

  it("reports a cost-book entry that is not an object once", () => {
    const ctx = { ...goldenContext(), costBook: { defaults: [7], priceBook: [null] } };
    expect(issuePaths(ctx)).toEqual(["costBook.defaults.0", "costBook.priceBook.0"]);
  });

  it("reports a missing cost-book list and a comp that is not an object", () => {
    const ctx = { ...goldenContext(), costBook: { defaults: [] }, comps: [7] };
    expect(issuePaths(ctx).sort()).toEqual(["comps.0", "costBook.priceBook"].sort());
  });
});

describe("dates", () => {
  const bad = ["", "2026-6-15", "2026-06-15T00:00:00Z", "26-06-15", "2026-13-01", "2026-04-31", "2025-02-29", "0026-10-12", "1899-12-31", "2101-01-01"];

  it.each(bad)("rejects %j in today and in comp dates with one issue each", (date) => {
    expect(issuePaths(setAt(goldenContext(), "today", date)), "today").toEqual(["today"]);
    for (const field of ["listDate", "contractDate", "soldDate"]) {
      const path = `comps.0.${field}`;
      expect(issuePaths(setAt(goldenContext(), path, date)), path).toEqual([path]);
    }
    expect(issuePaths(setAt(goldenContext(), "costBook.defaults.0.asOf", date))).toEqual(["costBook.defaults.0.asOf"]);
  });

  it("accepts the first and last day of the range, and a leap day", () => {
    for (const date of ["1900-01-01", "2100-12-31", "2028-02-29"]) {
      expect(validateContext(setAt(goldenContext(), "today", date)), date).toEqual([]);
    }
  });

  it("says which end of the range was missed", () => {
    expect(validateContext(setAt(goldenContext(), "today", "1899-12-31"))[0]?.message).toContain("1900");
    expect(validateContext(setAt(goldenContext(), "today", "2101-01-01"))[0]?.message).toContain("2100");
  });
});

describe("comps", () => {
  const priceFields = ["soldPriceCents", "listPriceCents", "originalListPriceCents"];

  it.each(priceFields)("requires %s to be a whole number of cents above zero", (field) => {
    const path = `comps.0.${field}`;
    for (const value of [0, -1, 1.5, NaN, Infinity, "100", null]) {
      expect(issuePaths(setAt(fullContext(), path, value)), `${path}=${String(value)}`).toContain(path);
    }
    expect(validateContext(setAt(fullContext(), path, 1))).toEqual([]);
  });

  it.each(["aboveGradeFinishedSf", "basementFinishedSf", "unfinishedSf", "beds", "baths", "lotAcres"])(
    "requires %s to be finite and 0 or more",
    (field) => {
      const path = `comps.0.${field}`;
      for (const value of [-0.01, NaN, Infinity, -Infinity, "3", null, undefined]) {
        expect(issuePaths(setAt(fullContext(), path, value)), `${path}=${String(value)}`).toEqual([path]);
      }
      expect(validateContext(setAt(fullContext(), path, 0))).toEqual([]);
      expect(validateContext(setAt(fullContext(), path, 2.5))).toEqual([]);
    },
  );

  it("limits garage bays to whole numbers from 0 to 10", () => {
    const path = "comps.0.garageBays";
    for (const value of [-1, 11, 2.5, NaN]) expect(issuePaths(setAt(fullContext(), path, value)), String(value)).toEqual([path]);
    for (const value of [0, 10]) expect(validateContext(setAt(fullContext(), path, value)), String(value)).toEqual([]);
  });

  it("limits year built to whole numbers from 1800 to 2100", () => {
    const path = "comps.0.yearBuilt";
    for (const value of [1799, 2101, 2000.5, NaN]) expect(issuePaths(setAt(fullContext(), path, value)), String(value)).toEqual([path]);
    for (const value of [1800, 2100]) expect(validateContext(setAt(fullContext(), path, value)), String(value)).toEqual([]);
  });

  it("requires price cuts to be a whole number, 0 or more", () => {
    const path = "comps.0.priceCuts";
    for (const value of [-1, 1.5, NaN]) expect(issuePaths(setAt(fullContext(), path, value)), String(value)).toEqual([path]);
    expect(validateContext(setAt(fullContext(), path, 0))).toEqual([]);
  });

  it.each([
    ["status", "closed"],
    ["basementFinish", "full"],
    ["source", "zillow"],
  ])("rejects an unknown %s", (field, value) => {
    expect(issuePaths(setAt(fullContext(), `comps.0.${field}`, value))).toEqual([`comps.0.${field}`]);
  });

  it("accepts every status, basement finish and source in the unions", () => {
    for (const status of ["sold", "active", "pending"]) {
      expect(validateContext(setAt(fullContext(), "comps.0.status", status)), status).toEqual([]);
    }
    for (const finish of ["none", "unfinished", "partial", "finished"]) {
      expect(validateContext(setAt(fullContext(), "comps.0.basementFinish", finish)), finish).toEqual([]);
    }
    for (const source of ["manual", "csv", "claudeFile", "ownSale", "sample"]) {
      expect(validateContext(setAt(fullContext(), "comps.0.source", source)), source).toEqual([]);
    }
  });

  it("requires the text and flag fields to have the right type", () => {
    for (const field of ["id", "address", "city", "county", "region", "newConstruction", "walkout", "adu", "pool", "verified"]) {
      expect(issuePaths(setAt(fullContext(), `comps.0.${field}`, 7)), field).toEqual([`comps.0.${field}`]);
    }
  });
});

describe("cost book", () => {
  it("requires a unit price to be a whole number of cents, 0 or more, in both lists", () => {
    for (const path of ["costBook.defaults.0.unitPriceCents", "costBook.priceBook.0.unitPriceCents"]) {
      for (const value of [-1, 0.5, NaN, Infinity, "650", null]) {
        expect(issuePaths(setAt(fullContext(), path, value)), `${path}=${String(value)}`).toContain(path);
      }
      expect(validateContext(setAt(fullContext(), path, 0)), path).toEqual([]);
    }
  });

  it("requires the code to be one of the 29 cost codes", () => {
    for (const path of ["costBook.defaults.0.code", "costBook.priceBook.0.code"]) {
      expect(issuePaths(setAt(fullContext(), path, "carpentry")), path).toEqual([path]);
    }
    for (const code of ["plans", "supervision", "patio"]) {
      expect(validateContext(setAt(fullContext(), "costBook.defaults.0.code", code)), code).toEqual([]);
    }
  });

  it("requires the unit to be one of the units", () => {
    for (const path of ["costBook.defaults.0.unit", "costBook.priceBook.0.unit"]) {
      expect(issuePaths(setAt(fullContext(), path, "gal")), path).toEqual([path]);
    }
    for (const unit of ["sf", "lf", "yd3", "sq", "ea", "ton", "mo", "ls"]) {
      expect(validateContext(setAt(fullContext(), "costBook.defaults.0.unit", unit)), unit).toEqual([]);
    }
  });

  it("requires the tier to be a finish tier or null", () => {
    for (const path of ["costBook.defaults.0.tier", "costBook.priceBook.0.tier"]) {
      expect(issuePaths(setAt(fullContext(), path, "premium")), path).toEqual([path]);
      expect(issuePaths(setAt(fullContext(), path, undefined)), path).toEqual([path]);
      for (const tier of [null, "standard", "upgraded", "luxury"]) {
        expect(validateContext(setAt(fullContext(), path, tier)), `${path}=${String(tier)}`).toEqual([]);
      }
    }
  });

  it("leaves the price book's vendor and notes optional", () => {
    const ctx = fullContext();
    delete ctx.costBook.priceBook[0]!.vendor;
    delete ctx.costBook.priceBook[0]!.notes;
    expect(validateContext(ctx)).toEqual([]);
  });

  it("requires a default's region, source note and verified flag", () => {
    for (const field of ["region", "sourceNote", "verified", "variant"]) {
      expect(issuePaths(setAt(fullContext(), `costBook.defaults.0.${field}`, 7)), field).toEqual([`costBook.defaults.0.${field}`]);
    }
  });
});

describe("market settings", () => {
  const at = (field: string) => `marketSettings.${field}`;

  it("limits the basement factor to 0 through 1", () => {
    for (const value of [-0.1, 1.1, NaN]) expect(issuePaths(setAt(goldenContext(), at("basementFactor"), value))).toEqual([at("basementFactor")]);
    for (const value of [0, 1]) expect(validateContext(setAt(goldenContext(), at("basementFactor"), value))).toEqual([]);
  });

  it("requires each feature value to be a whole number of cents, 0 or more", () => {
    for (const key of ["garageBayCents", "walkoutCents", "lotPerAcreCents", "aduCents", "poolCents"]) {
      const path = at(`featureValues.${key}`);
      for (const value of [-1, 1.5, NaN, Infinity, null]) expect(issuePaths(setAt(goldenContext(), path, value)), `${path}=${String(value)}`).toEqual([path]);
      expect(validateContext(setAt(goldenContext(), path, 0))).toEqual([]);
    }
  });

  it("requires each similarity weight to be 0 or more, reporting a negative weight once and not as a bad total", () => {
    const path = at("similarityWeights.size");
    // 125 − 25 − 10 keeps the total at 100, so only the sign is wrong.
    const settings = structuredClone(DEFAULT_MARKET_SETTINGS);
    settings.similarityWeights = { location: 25, size: -10, age: 15, recency: 20, features: 50 };
    expect(issuePaths({ ...goldenContext(), marketSettings: settings })).toEqual([path]);
    expect(issuePaths(setAt(goldenContext(), path, NaN))).toEqual([path]);
  });

  it("accepts weights that add up to 100 within 1e-9, and nothing further off", () => {
    const withSize = (size: number): unknown => setAt(goldenContext(), at("similarityWeights.size"), size);
    expect(validateContext(withSize(25 + 5e-10))).toEqual([]);
    expect(validateContext(withSize(25 - 5e-10))).toEqual([]);
    expect(issuePaths(withSize(25 + 1e-6))).toEqual([at("similarityWeights")]);
    expect(issuePaths(withSize(0))).toEqual([at("similarityWeights")]);
  });

  it("accepts weights written as decimals that add up to 100", () => {
    const settings = structuredClone(DEFAULT_MARKET_SETTINGS);
    settings.similarityWeights = { location: 33.3, size: 33.3, age: 11.1, recency: 11.1, features: 11.2 };
    expect(validateContext({ ...goldenContext(), marketSettings: settings })).toEqual([]);
  });

  it("limits the include threshold to 0 through 100", () => {
    for (const value of [-1, 100.5, NaN]) expect(issuePaths(setAt(goldenContext(), at("includeThreshold"), value))).toEqual([at("includeThreshold")]);
    for (const value of [0, 100]) expect(validateContext(setAt(goldenContext(), at("includeThreshold"), value))).toEqual([]);
  });

  it("needs exactly 12 seasonal factors, each above zero", () => {
    const factors = DEFAULT_MARKET_SETTINGS.seasonalFactors;
    const path = at("seasonalFactors");
    expect(issuePaths(setAt(goldenContext(), path, [...factors, 1]))).toEqual([path]);
    expect(issuePaths(setAt(goldenContext(), path, []))).toEqual([path]);
    expect(issuePaths(setAt(goldenContext(), path, "1.1"))).toEqual([path]);
    for (const value of [0, -1, NaN, Infinity]) {
      expect(issuePaths(setAt(goldenContext(), `${path}.3`, value)), String(value)).toEqual([`${path}.3`]);
    }
  });

  it("requires elasticity to be 0 or more", () => {
    for (const value of [-0.5, NaN, Infinity]) expect(issuePaths(setAt(goldenContext(), at("elasticity"), value))).toEqual([at("elasticity")]);
    expect(validateContext(setAt(goldenContext(), at("elasticity"), 0))).toEqual([]);
  });

  it("requires each condition factor to be above zero", () => {
    for (const key of ["hot", "normal", "slow"]) {
      const path = at(`conditionFactors.${key}`);
      for (const value of [0, -1, NaN]) expect(issuePaths(setAt(goldenContext(), path, value)), `${path}=${String(value)}`).toEqual([path]);
    }
  });

  it("limits assumed closing days to whole numbers from 0 to 180", () => {
    for (const value of [-1, 181, 35.5, NaN]) expect(issuePaths(setAt(goldenContext(), at("assumedClosingDays"), value)), String(value)).toEqual([at("assumedClosingDays")]);
    for (const value of [0, 180]) expect(validateContext(setAt(goldenContext(), at("assumedClosingDays"), value)), String(value)).toEqual([]);
  });

  it("limits the default tax rate to 0 through 0.1", () => {
    for (const value of [-0.001, 0.11, 4.8, NaN]) expect(issuePaths(setAt(goldenContext(), at("defaultTaxRate"), value)), String(value)).toEqual([at("defaultTaxRate")]);
    for (const value of [0, 0.1]) expect(validateContext(setAt(goldenContext(), at("defaultTaxRate"), value)), String(value)).toEqual([]);
  });

  it("requires a market condition the condition factors can look up, and a region", () => {
    expect(issuePaths(setAt(goldenContext(), at("marketCondition"), "booming"))).toEqual([at("marketCondition")]);
    for (const condition of ["hot", "normal", "slow"]) {
      expect(validateContext(setAt(goldenContext(), at("marketCondition"), condition)), condition).toEqual([]);
    }
    expect(issuePaths(setAt(goldenContext(), at("region"), null))).toEqual([at("region")]);
  });
});

describe("quantity rules", () => {
  const at = (field: string) => `quantityRules.${field}`;

  it("accepts every number in the default rules, and rejects NaN, infinity and negatives in each one", () => {
    const paths = leafPaths(DEFAULT_QUANTITY_RULES);
    expect(paths.length).toBeGreaterThan(40);
    for (const path of paths) {
      for (const value of [NaN, Infinity, -Infinity, -1, "3", null]) {
        expect(issuePaths(setAt(goldenContext(), at(path), value)), `${path}=${String(value)}`).toEqual([at(path)]);
      }
    }
  });

  it("accepts zero for a multiplier or an allowance", () => {
    for (const path of ["sfPerAcre", "garage.sfPerBay", "drywall.perGarageSf", "plumbing.adu", "flooring.basementHardShare", "roof.styleFactor.hip"]) {
      expect(validateContext(setAt(goldenContext(), at(path), 0)), path).toEqual([]);
    }
  });

  it("rejects zero where the rules divide by it, which would put an infinite quantity in the estimate", () => {
    const divisors = [
      "excavation.cubicFtPerYd3",
      "roof.sfPerSquare",
      "windows.sfPerWindow",
      "windows.basementFinishedSfPerWindow",
      "hvac.sfPerTon",
      "hvac.tonStep",
    ];
    for (const path of divisors) {
      expect(issuePaths(setAt(goldenContext(), at(path), 0)), path).toEqual([at(path)]);
      expect(validateContext(setAt(goldenContext(), at(path), 0.5)), path).toEqual([]);
    }
  });

  it("reports a missing key in a keyed table at that key", () => {
    const ctx = goldenContext();
    delete (ctx.quantityRules.roof.styleFactor as Partial<QuantityRules["roof"]["styleFactor"]>).hip;
    expect(issuePaths(ctx)).toEqual([at("roof.styleFactor.hip")]);
  });
});

describe("every field of the context is checked", () => {
  it("reports a NaN placed in any leaf of a fully filled context, at that leaf's path", () => {
    const ctx = fullContext();
    const paths = leafPaths(ctx);
    // Guards against a field dropping out of a schema: today + 5 settings groups + comps + cost book.
    expect(paths.length).toBeGreaterThan(110);
    for (const path of paths) {
      expect(issuePaths(setAt(fullContext(), path, NaN)), path).toContain(path);
    }
  });

  it("reports a null placed in any leaf, too", () => {
    const paths = leafPaths(fullContext()).filter((p) => !p.endsWith(".tier"));
    for (const path of paths) {
      expect(issuePaths(setAt(fullContext(), path, null)), path).toContain(path);
    }
  });
});

describe("schema types", () => {
  it("infer the engine's existing types exactly", () => {
    expectTypeOf<z.infer<typeof CompSchema>>().toEqualTypeOf<Comp>();
    expectTypeOf<z.infer<typeof MarketSettingsSchema>>().toEqualTypeOf<MarketSettings>();
    expectTypeOf<z.infer<typeof DefaultPriceSchema>>().toEqualTypeOf<DefaultPrice>();
    expectTypeOf<z.infer<typeof PriceBookEntrySchema>>().toEqualTypeOf<PriceBookEntry>();
    expectTypeOf<z.infer<typeof CostBookViewSchema>>().toEqualTypeOf<CostBookView>();
    expectTypeOf<z.infer<typeof QuantityRulesSchema>>().toEqualTypeOf<QuantityRules>();
    expectTypeOf<z.infer<typeof EngineContextSchema>>().toEqualTypeOf<EngineContext>();
  });

  it("parse a good context to the same data", () => {
    expect(EngineContextSchema.parse(goldenContext())).toEqual(goldenContext());
  });
});
