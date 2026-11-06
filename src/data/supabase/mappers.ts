import type { z } from "zod";
import { CompSchema, DefaultPriceSchema, MarketSettingsSchema, PriceBookEntrySchema } from "@engine";
import type { Comp, DefaultPrice, MarketSettings, PriceBookEntry } from "@engine";
import { CompanySettingsSchema, firstProblem, readDeal } from "../readBack";
import type { Problem } from "../readBack";
import { DataError } from "../types";
import type { CompanySettings, StoredDeal } from "../types";

/**
 * Rows in, engine values out. A row is whatever Postgres sent, so every mapper checks what it reads with the schema
 * the engine uses, and a row that fails becomes a `DataError` naming the record and the first field that is wrong,
 * never a half-built value. Nothing here talks to the network.
 */

/** The deal layout the app reads and writes. A row saved under any other version is refused, not guessed at. */
export const DEAL_SCHEMA_VERSION = 1;

/** A `deals` row. `inputs` is jsonb: unchecked until `dealFromRow` reads it. */
export interface DealRow {
  id: string;
  company_id: string;
  name: string;
  status: string;
  schema_version: number;
  inputs: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * A `comps` row. The id and region are columns, so the filter by region runs in the database; everything else about
 * the comp is in `data`. The two timestamps belong to the database and are not part of a `Comp`.
 */
export interface CompRow {
  id: string;
  company_id: string;
  region: string;
  data: unknown;
  created_at?: string;
  updated_at?: string;
}

/** A `default_prices` row. `company_id` is null for a global row. A bigint can arrive as a string. */
export interface DefaultPriceRow {
  id: string;
  company_id: string | null;
  region: string;
  code: string;
  variant: string;
  tier: string | null;
  unit: string;
  unit_price_cents: number | string;
  as_of: string;
  verified: boolean;
  source_note: string;
}

/** A `price_book_entries` row. `vendor` and `notes` are null when the owner left them blank. */
export interface PriceBookEntryRow {
  id: string;
  company_id: string;
  code: string;
  variant: string;
  tier: string | null;
  unit: string;
  unit_price_cents: number | string;
  as_of: string;
  vendor: string | null;
  notes: string | null;
}

/** A `company_settings` row. `contingency_pct` is a numeric: a number, or a string when exact digits are kept. */
export interface CompanySettingsRow {
  company_id: string;
  rules: unknown;
  contingency_pct: number | string;
}

/** A `market_settings` row. The region is a column, so `settings` need not repeat it. */
export interface MarketSettingsRow {
  company_id: string;
  region: string;
  settings: unknown;
}

function unreadable(kind: string, id: string, problem: Problem): DataError {
  return new DataError(`${kind} ${id} is unreadable: ${problem.message}`, { recordId: id, path: problem.path });
}

/** Reads `candidate` with `schema`, or throws the record's first problem. */
function read<S extends z.ZodType>(schema: S, candidate: unknown, kind: string, id: string): z.output<S> {
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) throw unreadable(kind, id, firstProblem(parsed.error));
  return parsed.data;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Optional fields are omitted, not null, in the engine's types; a jsonb or nullable column holds null instead. */
function withoutNulls(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null));
}

/**
 * A bigint column arrives as a number, or as a string of digits. Anything that is not a whole number JavaScript can
 * hold exactly (a fraction, a value past 2^53, text, an empty string, null) is refused rather than rounded.
 */
function readCents(value: unknown, kind: string, id: string): number {
  const cents = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isSafeInteger(cents)) {
    throw unreadable(kind, id, { path: "unitPriceCents", message: "unitPriceCents: Must be a whole number of cents" });
  }
  return cents;
}

/** A numeric column arrives as a number, or as a string of digits. Anything else becomes NaN, which the schema refuses. */
const readNumber = (value: unknown): number =>
  typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export function dealToRow(deal: StoredDeal, companyId: string): DealRow {
  return {
    id: deal.id,
    company_id: companyId,
    name: deal.name,
    status: deal.status,
    schema_version: DEAL_SCHEMA_VERSION,
    inputs: deal.inputs,
    created_at: deal.createdAt,
    updated_at: deal.updatedAt,
  };
}

/**
 * Timestamps are returned as Postgres sent them (microseconds and a `+00:00` offset), because the stored-deal
 * schema accepts both. The message of the error is the bare problem (`inputs.lot.priceCents: ...`), which is what
 * the deals list shows beside the deal's id.
 */
export function dealFromRow(row: DealRow): StoredDeal {
  if (row.schema_version !== DEAL_SCHEMA_VERSION) {
    throw new DataError(
      `schema_version: saved as version ${String(row.schema_version)}, but this app reads version ${DEAL_SCHEMA_VERSION}`,
      { recordId: row.id, path: "schema_version" },
    );
  }
  const read = readDeal({
    id: row.id,
    name: row.name,
    status: row.status,
    inputs: row.inputs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!read.ok) throw new DataError(read.message, { recordId: row.id, path: read.path });
  return read.deal;
}

// ---------------------------------------------------------------------------
// Comps
// ---------------------------------------------------------------------------

export function compToRow(comp: Comp, companyId: string): CompRow {
  const { id, region, ...data } = comp;
  return { id, company_id: companyId, region, data };
}

export function compFromRow(row: CompRow): Comp {
  if (!isRecord(row.data)) {
    throw unreadable("Comp", row.id, { path: "data", message: "data: expected an object" });
  }
  // The columns decide the id and region, whatever `data` says.
  return read(CompSchema, { ...withoutNulls(row.data), id: row.id, region: row.region }, "Comp", row.id);
}

// ---------------------------------------------------------------------------
// Cost book
// ---------------------------------------------------------------------------

export function defaultPriceFromRow(row: DefaultPriceRow): DefaultPrice {
  const kind = "Default price";
  return read(
    DefaultPriceSchema,
    {
      code: row.code,
      variant: row.variant,
      tier: row.tier ?? null,
      region: row.region,
      unitPriceCents: readCents(row.unit_price_cents, kind, row.id),
      unit: row.unit,
      asOf: row.as_of,
      verified: row.verified,
      sourceNote: row.source_note,
    },
    kind,
    row.id,
  );
}

export function priceBookEntryFromRow(row: PriceBookEntryRow): PriceBookEntry {
  const kind = "Price book entry";
  return read(
    PriceBookEntrySchema,
    {
      code: row.code,
      variant: row.variant,
      tier: row.tier ?? null,
      unitPriceCents: readCents(row.unit_price_cents, kind, row.id),
      unit: row.unit,
      asOf: row.as_of,
      ...withoutNulls({ vendor: row.vendor, notes: row.notes }),
    },
    kind,
    row.id,
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function companySettingsFromRow(row: CompanySettingsRow): CompanySettings {
  return read(
    CompanySettingsSchema,
    { rules: row.rules, contingencyPct: readNumber(row.contingency_pct) },
    "Company settings",
    row.company_id,
  );
}

export function marketSettingsFromRow(row: MarketSettingsRow): MarketSettings {
  if (!isRecord(row.settings)) {
    throw unreadable("Market settings", row.region, { path: "settings", message: "settings: expected an object" });
  }
  // The column decides the region, whatever `settings` says.
  return read(MarketSettingsSchema, { ...row.settings, region: row.region }, "Market settings", row.region);
}

/** The columns of a `company_settings` row the owner can change; the database keeps the timestamps. */
export function companySettingsToRow(settings: CompanySettings, companyId: string): CompanySettingsRow {
  return { company_id: companyId, rules: settings.rules, contingency_pct: settings.contingencyPct };
}

/** The columns of a `market_settings` row the owner can change. The region is a column, so `settings` leaves it out. */
export function marketSettingsToRow(settings: MarketSettings, companyId: string): MarketSettingsRow {
  const { region, ...rest } = settings;
  return { company_id: companyId, region, settings: rest };
}
