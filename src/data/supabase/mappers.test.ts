import { testSampleComps } from "../../testing/sampleIds";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES } from "@engine";
import type { Comp, DefaultPrice, PriceBookEntry } from "@engine";
import { sampleDealInputs } from "../sample";
import { DataError } from "../types";
import type { StoredDeal } from "../types";
import {
  companySettingsFromRow,
  compFromRow,
  compToRow,
  dealFromRow,
  dealToRow,
  defaultPriceFromRow,
  marketSettingsFromRow,
  priceBookEntryFromRow,
} from "./mappers";
import type { CompanySettingsRow, DealRow, DefaultPriceRow, MarketSettingsRow, PriceBookEntryRow } from "./mappers";

const CO = "11111111-1111-4111-8111-111111111111";
const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const ROW_ID = "33333333-3333-4333-8333-333333333333";

/** Timestamps as Postgres writes them: microseconds and a `+00:00` offset, never `Z`. */
const CREATED = "2026-10-30T12:00:00.123456+00:00";
const UPDATED = "2026-10-31T09:30:00.5+00:00";

function storedDeal(): StoredDeal {
  return {
    id: DEAL_ID,
    name: "Kaysville lot",
    status: "analyzing",
    inputs: sampleDealInputs(),
    createdAt: CREATED,
    updatedAt: UPDATED,
  };
}

function dealRow(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: DEAL_ID,
    company_id: CO,
    name: "Kaysville lot",
    status: "analyzing",
    schema_version: 1,
    inputs: sampleDealInputs(),
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

/** The record without one key, for a test that needs a field to be missing. */
function omit(record: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/** Catches what a mapper threw, so a test can look at the error's fields. */
function thrown(run: () => unknown): DataError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return error as DataError;
  }
  throw new Error("expected the mapper to throw");
}

describe("dealToRow and dealFromRow", () => {
  it("writes the deal's columns, with the schema version", () => {
    const deal = storedDeal();
    expect(dealToRow(deal, CO)).toEqual({
      id: DEAL_ID,
      company_id: CO,
      name: "Kaysville lot",
      status: "analyzing",
      schema_version: 1,
      inputs: deal.inputs,
      created_at: CREATED,
      updated_at: UPDATED,
    });
  });

  it("passes the timestamps through verbatim, microseconds and offset included", () => {
    const stamp = "2026-11-01T02:17:17.123456+00:00";
    const deal = dealFromRow(dealRow({ created_at: stamp, updated_at: stamp }));
    expect(deal.updatedAt).toBe(stamp);
    expect(deal.createdAt).toBe(stamp);
    expect(dealToRow(deal, CO).updated_at).toBe(stamp);
  });

  it("round-trips a deal", () => {
    const deal = storedDeal();
    expect(dealFromRow(dealToRow(deal, CO))).toEqual(deal);
  });

  it("returns timestamps as Postgres sent them, microseconds and offset included", () => {
    const deal = dealFromRow(dealRow());
    expect(deal.createdAt).toBe(CREATED);
    expect(deal.updatedAt).toBe(UPDATED);
  });

  it("reads a deal whose inputs break a rule the owner can fix", () => {
    const inputs = sampleDealInputs();
    inputs.lot.city = "";
    expect(dealFromRow(dealRow({ inputs })).inputs.lot.city).toBe("");
  });

  it("rejects a deal whose inputs have no lot, naming the deal and the field", () => {
    const error = thrown(() => dealFromRow(dealRow({ inputs: omit(sampleDealInputs(), "lot") })));
    expect(error.recordId).toBe(DEAL_ID);
    expect(error.path).toBe("inputs.lot");
    expect(error.message).toMatch(/^inputs\.lot: /);
  });

  it("rejects a field of the wrong type deep inside the inputs, with its full path", () => {
    const inputs = sampleDealInputs();
    const bad = { ...inputs, lot: { ...inputs.lot, priceCents: "x" } };
    const error = thrown(() => dealFromRow(dealRow({ inputs: bad })));
    expect(error.recordId).toBe(DEAL_ID);
    expect(error.path).toBe("inputs.lot.priceCents");
    expect(error.message).toMatch(/^inputs\.lot\.priceCents: /);
  });

  it("rejects inputs that are not an object", () => {
    expect(thrown(() => dealFromRow(dealRow({ inputs: null }))).path).toBe("inputs");
  });

  it("rejects schema version 2, which this version of the app cannot read", () => {
    const error = thrown(() => dealFromRow(dealRow({ schema_version: 2 })));
    expect(error.recordId).toBe(DEAL_ID);
    expect(error.path).toBe("schema_version");
    expect(error.message).toMatch(/version 2/);
  });

  it("rejects a blank name, an unknown status and a timestamp that is not a date", () => {
    expect(thrown(() => dealFromRow(dealRow({ name: "" }))).path).toBe("name");
    expect(thrown(() => dealFromRow(dealRow({ status: "lost" }))).path).toBe("status");
    expect(thrown(() => dealFromRow(dealRow({ created_at: "yesterday" }))).path).toBe("createdAt");
    expect(thrown(() => dealFromRow(dealRow({ updated_at: "" }))).path).toBe("updatedAt");
  });
});

describe("compToRow and compFromRow", () => {
  const comp = (): Comp => testSampleComps()[0] as Comp;

  it("keeps the id and region in their columns and the rest in data", () => {
    const original = comp();
    const row = compToRow(original, CO);
    expect(row.id).toBe(original.id);
    expect(row.company_id).toBe(CO);
    expect(row.region).toBe(original.region);
    expect(row.data).not.toHaveProperty("id");
    expect(row.data).not.toHaveProperty("region");
    expect(row.data).toHaveProperty("address", original.address);
  });

  it("round-trips a comp", () => {
    const original = comp();
    expect(compFromRow(compToRow(original, CO))).toEqual(original);
  });

  it("round-trips a comp with every optional field set", () => {
    const full: Comp = {
      ...comp(),
      status: "sold",
      listDate: "2026-01-05",
      listPriceCents: 52_000_000,
      originalListPriceCents: 55_000_000,
      priceCuts: 2,
      contractDate: "2026-02-01",
      soldDate: "2026-03-01",
      soldPriceCents: 50_500_000,
      notes: "Corner lot",
    };
    expect(compFromRow(compToRow(full, CO))).toEqual(full);
  });

  it("drops an optional field stored as null instead of passing the null through", () => {
    const row = compToRow(comp(), CO);
    const data = { ...(row.data as object), soldDate: null, listPriceCents: null, notes: null };
    const read = compFromRow({ ...row, data });
    expect(Object.keys(read)).not.toContain("soldDate");
    expect(Object.keys(read)).not.toContain("listPriceCents");
    expect(Object.keys(read)).not.toContain("notes");
  });

  it("trusts the columns over an id or region repeated inside data", () => {
    const original = comp();
    const row = compToRow(original, CO);
    const read = compFromRow({ ...row, data: { ...(row.data as object), id: "other", region: "elsewhere" } });
    expect(read.id).toBe(original.id);
    expect(read.region).toBe(original.region);
  });

  it("rejects data with a field of the wrong type, naming the comp", () => {
    const row = compToRow(comp(), CO);
    const error = thrown(() => compFromRow({ ...row, data: { ...(row.data as object), beds: "many" } }));
    expect(error.recordId).toBe(row.id);
    expect(error.path).toBe("beds");
  });

  it("rejects data that is missing a required field", () => {
    const row = compToRow(comp(), CO);
    const error = thrown(() => compFromRow({ ...row, data: omit(row.data as object, "address") }));
    expect(error.path).toBe("address");
  });

  it.each([["text"], [null], [["a"]], [7]])("rejects data that is not an object (%j)", (data) => {
    const error = thrown(() => compFromRow({ ...compToRow(comp(), CO), data }));
    expect(error.path).toBe("data");
    expect(error.recordId).toBe(comp().id);
  });
});

describe("defaultPriceFromRow", () => {
  const row = (overrides: Partial<DefaultPriceRow> = {}): DefaultPriceRow => ({
    id: ROW_ID,
    company_id: null,
    region: "utah-north",
    code: "framing",
    variant: "base",
    tier: "standard",
    unit: "sf",
    unit_price_cents: 2_350,
    as_of: "2026-10-30",
    verified: false,
    source_note: "Starter estimate",
    ...overrides,
  });

  it("maps the columns to the engine's default price", () => {
    const expected: DefaultPrice = {
      code: "framing",
      variant: "base",
      tier: "standard",
      region: "utah-north",
      unitPriceCents: 2_350,
      unit: "sf",
      asOf: "2026-10-30",
      verified: false,
      sourceNote: "Starter estimate",
    };
    expect(defaultPriceFromRow(row())).toEqual(expected);
  });

  it("maps a null tier to tier: null, not to a missing tier", () => {
    const price = defaultPriceFromRow(row({ tier: null }));
    expect(price.tier).toBeNull();
    expect(price).toHaveProperty("tier", null);
  });

  it("reads a bigint that arrives as a string", () => {
    expect(defaultPriceFromRow(row({ unit_price_cents: "1500" })).unitPriceCents).toBe(1500);
  });

  it.each([
    ["a fraction", "12.5"],
    ["a number with a fraction", 12.5],
    ["a bigint beyond 2^53", "9007199254740993"],
    ["an empty string", ""],
    ["text", "cheap"],
    ["null", null],
    ["a boolean", true],
  ])("rejects a price that is %s", (_name, value) => {
    const error = thrown(() => defaultPriceFromRow(row({ unit_price_cents: value as number })));
    expect(error.recordId).toBe(ROW_ID);
    expect(error.path).toBe("unitPriceCents");
  });

  it("rejects a negative price, an unknown cost code and an unknown unit", () => {
    expect(thrown(() => defaultPriceFromRow(row({ unit_price_cents: -1 }))).path).toBe("unitPriceCents");
    expect(thrown(() => defaultPriceFromRow(row({ code: "unobtainium" }))).path).toBe("code");
    expect(thrown(() => defaultPriceFromRow(row({ unit: "furlong" }))).path).toBe("unit");
  });

  it("rejects a date that is not a date", () => {
    const error = thrown(() => defaultPriceFromRow(row({ as_of: "soon" })));
    expect(error.recordId).toBe(ROW_ID);
    expect(error.path).toBe("asOf");
  });
});

describe("priceBookEntryFromRow", () => {
  const row = (overrides: Partial<PriceBookEntryRow> = {}): PriceBookEntryRow => ({
    id: ROW_ID,
    company_id: CO,
    code: "framing",
    variant: "base",
    tier: null,
    unit: "sf",
    unit_price_cents: "2400",
    as_of: "2026-09-01",
    vendor: null,
    notes: null,
    ...overrides,
  });

  it("drops a null vendor and notes instead of passing the nulls through", () => {
    const entry = priceBookEntryFromRow(row());
    const expected: PriceBookEntry = {
      code: "framing",
      variant: "base",
      tier: null,
      unitPriceCents: 2_400,
      unit: "sf",
      asOf: "2026-09-01",
    };
    expect(entry).toEqual(expected);
    expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
  });

  it("keeps a vendor and notes that are set, and a tier", () => {
    const entry = priceBookEntryFromRow(row({ tier: "upgraded", vendor: "Wasatch Lumber", notes: "Quote #4" }));
    expect(entry).toMatchObject({ tier: "upgraded", vendor: "Wasatch Lumber", notes: "Quote #4" });
  });

  it("keeps an empty-string vendor, which is a value and not a missing one", () => {
    expect(priceBookEntryFromRow(row({ vendor: "" }))).toHaveProperty("vendor", "");
  });

  it("rejects a price that is not a whole number of cents, naming the entry", () => {
    const error = thrown(() => priceBookEntryFromRow(row({ unit_price_cents: "24.5" })));
    expect(error.recordId).toBe(ROW_ID);
    expect(error.path).toBe("unitPriceCents");
  });

  it("rejects an unknown cost code", () => {
    expect(thrown(() => priceBookEntryFromRow(row({ code: "unobtainium" }))).path).toBe("code");
  });
});

describe("companySettingsFromRow", () => {
  const row = (overrides: Partial<CompanySettingsRow> = {}): CompanySettingsRow => ({
    company_id: CO,
    rules: { minMarginOnSale: 0.12, minAnnualizedReturn: 0.3, minDownsideProfitCents: 500_000 },
    contingency_pct: 0.05,
    ...overrides,
  });

  it("maps the rules and the contingency", () => {
    expect(companySettingsFromRow(row())).toEqual({
      rules: { minMarginOnSale: 0.12, minAnnualizedReturn: 0.3, minDownsideProfitCents: 500_000 },
      contingencyPct: 0.05,
    });
  });

  it("reads a numeric that arrives as a string", () => {
    expect(companySettingsFromRow(row({ contingency_pct: "0.0750" })).contingencyPct).toBe(0.075);
  });

  it("reads the default rules back unchanged", () => {
    expect(companySettingsFromRow(row({ rules: DEFAULT_RULES })).rules).toEqual(DEFAULT_RULES);
  });

  it("rejects rules that are missing a field, naming the company", () => {
    const error = thrown(() => companySettingsFromRow(row({ rules: { minMarginOnSale: 0.1 } })));
    expect(error.recordId).toBe(CO);
    expect(error.path).toBe("rules.minAnnualizedReturn");
  });

  it("rejects a contingency that is not a percentage as a decimal, or not a number", () => {
    expect(thrown(() => companySettingsFromRow(row({ contingency_pct: 5 }))).path).toBe("contingencyPct");
    expect(thrown(() => companySettingsFromRow(row({ contingency_pct: "five" }))).path).toBe("contingencyPct");
    expect(thrown(() => companySettingsFromRow(row({ contingency_pct: "" }))).path).toBe("contingencyPct");
  });
});

describe("marketSettingsFromRow", () => {
  const settings = omit(DEFAULT_MARKET_SETTINGS, "region");
  const row = (overrides: Partial<MarketSettingsRow> = {}): MarketSettingsRow => ({
    company_id: CO,
    region: "utah-north",
    settings,
    ...overrides,
  });

  it("maps the settings, with the region from the column", () => {
    expect(marketSettingsFromRow(row())).toEqual(DEFAULT_MARKET_SETTINGS);
  });

  it("trusts the region column over a region repeated inside the settings", () => {
    const read = marketSettingsFromRow(row({ region: "utah-south", settings: { ...settings, region: "utah-north" } }));
    expect(read.region).toBe("utah-south");
  });

  it("rejects settings that break a rule, naming the region", () => {
    const bad = { ...settings, similarityWeights: { location: 10, size: 10, age: 10, recency: 10, features: 10 } };
    const error = thrown(() => marketSettingsFromRow(row({ settings: bad })));
    expect(error.recordId).toBe("utah-north");
    expect(error.path).toBe("similarityWeights");
  });

  it("rejects settings that are missing a field", () => {
    expect(thrown(() => marketSettingsFromRow(row({ settings: omit(settings, "elasticity") }))).path).toBe("elasticity");
  });

  it.each([[{}], ["text"], [null], [[1]]])("rejects settings that are not a full object (%j)", (value) => {
    expect(thrown(() => marketSettingsFromRow(row({ settings: value }))).recordId).toBe("utah-north");
  });
});
