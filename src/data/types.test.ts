import { describe, expect, expectTypeOf, it } from "vitest";
import { DataError, StoredDealSchema, structuralInputIssues, type StoredDeal } from "./types";
import { newDealInputs } from "./newDeal";
import { DEFAULT_RULES, type DealInputs } from "@engine";

const inputs = newDealInputs("2026-10-30", { rules: DEFAULT_RULES, contingencyPct: 0.05 });
inputs.lot.city = "Kaysville";
const stored = {
  id: "deal-1",
  name: "Kaysville lot",
  status: "analyzing",
  inputs,
  createdAt: "2026-10-30T12:00:00.000Z",
  updatedAt: "2026-10-30T12:30:00.000Z",
};

describe("StoredDealSchema", () => {
  it("accepts a well-formed stored deal", () => {
    expect(StoredDealSchema.safeParse(stored).success).toBe(true);
  });

  it.each(["analyzing", "bought", "building", "listed", "sold", "dropped"])("accepts status %s", (status) => {
    expect(StoredDealSchema.safeParse({ ...stored, status }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(StoredDealSchema.safeParse({ ...stored, status: "pending" }).success).toBe(false);
  });

  it("rejects an empty name or id", () => {
    expect(StoredDealSchema.safeParse({ ...stored, name: "" }).success).toBe(false);
    expect(StoredDealSchema.safeParse({ ...stored, id: "" }).success).toBe(false);
  });

  it("rejects timestamps that are not ISO date-times", () => {
    expect(StoredDealSchema.safeParse({ ...stored, createdAt: "yesterday" }).success).toBe(false);
    expect(StoredDealSchema.safeParse({ ...stored, updatedAt: "2026-10-30" }).success).toBe(false);
  });

  it("accepts a timestamp with a UTC offset, as Postgres writes it", () => {
    expect(StoredDealSchema.safeParse({ ...stored, updatedAt: "2026-10-30T06:30:00.123+00:00" }).success).toBe(true);
  });

  it("rejects a record with a missing field", () => {
    const rest: Partial<typeof stored> = { ...stored };
    delete rest.createdAt;
    expect(StoredDealSchema.safeParse(rest).success).toBe(false);
  });
});

// Tests reach into a deal to break it on purpose, so they work on it as loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

// A deal is saved while the owner is still filling it in, so a stored record may break a rule the owner can still
// fix. Only a record whose shape is wrong is unreadable.
const withInputs = (change: (d: Doc) => void, base: DealInputs = inputs): unknown => {
  const copy = structuredClone(base) as Doc;
  change(copy);
  return { ...stored, inputs: copy };
};

const fixable: [string, (d: Doc) => void][] = [
  ["an empty city", (d) => { d.lot.city = ""; }],
  ["a finished basement larger than the basement", (d) => { d.house.levels.basement.finishedSf = 3000; }],
  ["exterior percentages that add up to 90", (d) => { d.house.exterior.stuccoPct = 50; }],
  ["a fractional number of build months", (d) => { d.timeline.buildMonths = 2.5; }],
  ["a fractional number of cents", (d) => { d.loan.drawFeeCents = 20_000.5; }],
  ["a loan-to-cost above the limit", (d) => { d.loan.ltc = 2; }],
  ["a negative lot size", (d) => { d.lot.acres = -1; }],
  ["listing earlier than the build is long", (d) => { d.timeline.listEarlyMonths = 20; }],
  ["a month that is not a real month", (d) => { d.timeline.landClose = "2026-13"; }],
  ["a bid dated with a non-date", (d) => { d.bids = [{ code: "plans", amountCents: 1, vendor: "v", receivedOn: "soon" }]; }],
];

const structural: [string, (d: Doc) => void, string][] = [
  ["a price typed as text", (d) => { d.lot.priceCents = "x"; }, "lot.priceCents"],
  ["a missing lot", (d) => { delete d.lot; }, "lot"],
  ["a NaN number", (d) => { d.house.levels.main.ceilingFt = NaN; }, "house.levels.main.ceilingFt"],
  ["an infinite number", (d) => { d.lot.acres = Infinity; }, "lot.acres"],
  ["a house style that is not one of the styles", (d) => { d.house.style = "castle"; }, "house.style"],
  ["a financing kind that is neither cash nor loan", (d) => { d.lot.financing = { kind: "barter" }; }, "lot.financing.kind"],
  ["a missing utility", (d) => { delete d.lot.utilities.gas; }, "lot.utilities.gas"],
  ["bids that are not a list", (d) => { d.bids = {}; }, "bids"],
  ["a house schema version from the future", (d) => { d.house.schemaVersion = 2; }, "house.schemaVersion"],
  ["a comp selection that is not true or false", (d) => { d.compSelections = { "comp-1": "yes" }; }, "compSelections.comp-1"],
  ["a bid with no vendor", (d) => { d.bids = [{ code: "plans", amountCents: 1, receivedOn: "2026-10-30" }]; }, "bids.0.vendor"],
];

describe("StoredDealSchema reads inputs structurally", () => {
  const fresh = newDealInputs("2026-10-30", { rules: DEFAULT_RULES, contingencyPct: 0.05 });

  it("reads a brand-new deal, whose city is still empty", () => {
    expect(fresh.lot.city).toBe("");
    const result = StoredDealSchema.safeParse({ ...stored, inputs: fresh });
    expect(result.success).toBe(true);
  });

  it("types the parsed inputs as DealInputs", () => {
    expectTypeOf<StoredDeal["inputs"]>().toEqualTypeOf<DealInputs>();
  });

  it("hands back the inputs it was given, not a stripped copy", () => {
    const withExtra = { ...structuredClone(fresh), futureField: { keep: "me" } };
    const result = StoredDealSchema.safeParse({ ...stored, inputs: withExtra });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inputs).toBe(withExtra);
      expect(result.data.inputs).toHaveProperty("futureField");
    }
  });

  it.each(fixable)("reads a deal with %s, which the owner can still fix", (_name, change) => {
    expect(StoredDealSchema.safeParse(withInputs(change)).success).toBe(true);
  });

  it.each(structural)("rejects a deal with %s, naming the field", (_name, change, path) => {
    const result = StoredDealSchema.safeParse(withInputs(change));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain(`inputs.${path}`);
    }
  });

  it.each([null, undefined, "deal", 42, []])("rejects inputs that are %j", (bad) => {
    const result = StoredDealSchema.safeParse({ ...stored, inputs: bad });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join("."))).toContain("inputs");
  });

  it("rejects a record that has both a fixable and a structural problem", () => {
    const result = StoredDealSchema.safeParse(
      withInputs((d) => {
        d.lot.city = "";
        d.lot.priceCents = "x";
      }, fresh),
    );
    expect(result.success).toBe(false);
  });
});

describe("structuralInputIssues", () => {
  const fresh = newDealInputs("2026-10-30", { rules: DEFAULT_RULES, contingencyPct: 0.05 });
  const inputsOf = (change: (d: Doc) => void): unknown => (withInputs(change, fresh) as { inputs: unknown }).inputs;

  it("finds nothing in a valid deal or in a brand-new one", () => {
    expect(structuralInputIssues(inputs)).toEqual([]);
    expect(structuralInputIssues(fresh)).toEqual([]);
  });

  it.each(fixable)("finds nothing in a deal with %s", (_name, change) => {
    expect(structuralInputIssues(inputsOf(change))).toEqual([]);
  });

  it.each(structural)("reports the path of %s", (_name, change, path) => {
    const issues = structuralInputIssues(inputsOf(change));
    expect(issues.map((i) => i.path)).toEqual([path]);
    expect(issues[0]?.message).toEqual(expect.any(String));
    expect(issues[0]?.message).not.toBe("");
  });

  it("reports only the structural problems when a deal has both kinds", () => {
    const issues = structuralInputIssues(
      inputsOf((d) => {
        d.lot.city = "";
        d.lot.priceCents = "x";
        d.timeline.buildMonths = 2.5;
        d.house.style = "castle";
      }),
    );
    expect(issues.map((i) => i.path).sort()).toEqual(["house.style", "lot.priceCents"]);
  });

  it("reports a value that is not an object at the root", () => {
    expect(structuralInputIssues(null).map((i) => i.path)).toEqual([""]);
    expect(structuralInputIssues("deal").map((i) => i.path)).toEqual([""]);
  });
});

describe("DataError", () => {
  it("is a real Error that instanceof can tell apart", () => {
    const error = new DataError("Deal d1 is unreadable", { recordId: "d1", path: "inputs.loan.ltc" });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DataError);
    expect(error.name).toBe("DataError");
    expect(error.message).toBe("Deal d1 is unreadable");
    expect(error.recordId).toBe("d1");
    expect(error.path).toBe("inputs.loan.ltc");
  });

  it("works with only a message, and keeps a cause", () => {
    const cause = new SyntaxError("Unexpected token");
    const plain = new DataError("The deal store is not valid JSON", { cause });
    expect(plain.recordId).toBeUndefined();
    expect(plain.path).toBeUndefined();
    expect(plain.cause).toBe(cause);
    expect(new DataError("bare").recordId).toBeUndefined();
    expect(new Error("other")).not.toBeInstanceOf(DataError);
  });
});
