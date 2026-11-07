// The fake's in-memory database: the tables of migrations 0001–0003, their defaults and keys, row-level security as
// the policies write it, and Postgres-style timestamps. Nothing here knows about HTTP.
import { STARTER_COST_BOOK } from "../../../src/data/starterCostBook";

export type Row = Record<string, unknown>;

export type TableName =
  | "companies"
  | "memberships"
  | "deals"
  | "comps"
  | "default_prices"
  | "price_book_entries"
  | "market_settings"
  | "company_settings";

type ColumnType = "uuid" | "text" | "int" | "numeric" | "bool" | "jsonb" | "timestamptz" | "date";

interface Column {
  type: ColumnType;
  nullable?: boolean;
  /** The column's `default`, applied when an insert leaves it out. */
  initial?: (db: Db) => unknown;
}

/** The signed-in user a request runs as (`auth.uid()`), and the companies their memberships give them. */
export interface Viewer {
  userId: string;
  companies: ReadonlySet<string>;
}

interface TableSpec {
  columns: Record<string, Column>;
  primaryKey: string[];
  /** Other unique keys, nulls not distinct. */
  unique?: string[][];
  /** The select/update/delete policy (`using`). */
  using: (row: Row, viewer: Viewer) => boolean;
  /** The insert/update policy (`with check`). A table without one takes no writes from users. */
  check?: (row: Row, viewer: Viewer) => boolean;
}

/** An error as PostgREST reports it: the HTTP status and Postgres's (or PostgREST's) code and message. */
export class PgError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string | null = null,
  ) {
    super(message);
  }

  get body() {
    return { code: this.code, details: this.details, hint: null, message: this.message };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const member = (companyId: unknown, viewer: Viewer) => typeof companyId === "string" && viewer.companies.has(companyId);
const ofCompany = { using: (row: Row, v: Viewer) => member(row.company_id, v), check: (row: Row, v: Viewer) => member(row.company_id, v) };

const id: Column = { type: "uuid", initial: () => crypto.randomUUID() };
const stamps: Record<string, Column> = {
  created_at: { type: "timestamptz", initial: (db) => db.now() },
  updated_at: { type: "timestamptz", initial: (db) => db.now() },
};

export const TABLES: Record<TableName, TableSpec> = {
  companies: {
    columns: { id, name: { type: "text" }, default_region: { type: "text", initial: () => "utah-north" }, ...stamps },
    primaryKey: ["id"],
    // Read-only for users: created by `create_company`.
    using: (row, v) => member(row.id, v),
  },
  memberships: {
    columns: { user_id: { type: "uuid" }, company_id: { type: "uuid" }, role: { type: "text", initial: () => "owner" }, ...stamps },
    primaryKey: ["user_id", "company_id"],
    using: (row, v) => row.user_id === v.userId,
  },
  deals: {
    columns: {
      id,
      company_id: { type: "uuid" },
      name: { type: "text" },
      status: { type: "text", initial: () => "analyzing" },
      schema_version: { type: "int", initial: () => 1 },
      inputs: { type: "jsonb" },
      ...stamps,
    },
    primaryKey: ["id"],
    ...ofCompany,
  },
  comps: {
    columns: { id, company_id: { type: "uuid" }, region: { type: "text" }, data: { type: "jsonb" }, ...stamps },
    primaryKey: ["id"],
    ...ofCompany,
  },
  default_prices: {
    columns: {
      id,
      company_id: { type: "uuid", nullable: true },
      region: { type: "text" },
      code: { type: "text" },
      variant: { type: "text" },
      tier: { type: "text", nullable: true },
      unit: { type: "text" },
      unit_price_cents: { type: "int" },
      as_of: { type: "date" },
      verified: { type: "bool", initial: () => false },
      source_note: { type: "text", initial: () => "" },
      ...stamps,
    },
    primaryKey: ["id"],
    unique: [["company_id", "region", "code", "variant", "tier"]],
    // Everyone signed in reads the global rows; only a company's own rows can be written.
    using: (row, v) => row.company_id === null || member(row.company_id, v),
    check: (row, v) => row.company_id !== null && member(row.company_id, v),
  },
  price_book_entries: {
    columns: {
      id,
      company_id: { type: "uuid" },
      code: { type: "text" },
      variant: { type: "text" },
      tier: { type: "text", nullable: true },
      unit: { type: "text" },
      unit_price_cents: { type: "int" },
      as_of: { type: "date" },
      vendor: { type: "text", nullable: true },
      notes: { type: "text", nullable: true },
      ...stamps,
    },
    primaryKey: ["id"],
    ...ofCompany,
  },
  market_settings: {
    columns: { company_id: { type: "uuid" }, region: { type: "text" }, settings: { type: "jsonb" }, ...stamps },
    primaryKey: ["company_id", "region"],
    ...ofCompany,
  },
  company_settings: {
    columns: { company_id: { type: "uuid" }, rules: { type: "jsonb" }, contingency_pct: { type: "numeric" }, ...stamps },
    primaryKey: ["company_id"],
    ...ofCompany,
  },
};

export const isTable = (name: string): name is TableName => Object.hasOwn(TABLES, name);

// ---------------------------------------------------------------------------
// Timestamps, as Postgres writes a timestamptz in JSON: microseconds with trailing zeros dropped, and `+00:00`.
// ---------------------------------------------------------------------------

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Microseconds since the epoch, or null for text Postgres would not read as a timestamptz. */
export function parseTimestamp(text: string): number | null {
  const match = TIMESTAMP.exec(text);
  if (!match) return null;
  const [, date, time, fraction = "", zone = "Z"] = match;
  const ms = Date.parse(`${date}T${time}Z`);
  if (Number.isNaN(ms)) return null;
  // `Z`, `+HH`, `+HH:MM` or `+HHMM`.
  const digits = zone === "Z" ? "0000" : zone.slice(1).replace(":", "").padEnd(4, "0");
  const offsetMinutes = (zone.startsWith("-") ? -1 : 1) * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
  return (ms - offsetMinutes * 60_000) * 1000 + Number(fraction.padEnd(6, "0"));
}

function formatTimestamp(micros: number): string {
  const seconds = new Date(Math.floor(micros / 1000)).toISOString().slice(0, 19);
  const fraction = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return `${seconds}${fraction === "" ? "" : `.${fraction}`}+00:00`;
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

export class Db {
  readonly rows: Record<TableName, Row[]> = {
    companies: [],
    memberships: [],
    deals: [],
    comps: [],
    default_prices: [],
    price_book_entries: [],
    market_settings: [],
    company_settings: [],
  };
  private lastMicros = 0;
  /** Inside a statement, `now()` is the statement's start, as in a Postgres transaction. */
  private statementStart: string | null = null;

  constructor() {
    // Migration 0003: the starter cost book as global rows, so the sample deal is priced as in demo mode.
    this.transaction(() => {
      for (const price of STARTER_COST_BOOK) {
        this.rows.default_prices.push(
          this.newRow("default_prices", {
            company_id: null,
            region: price.region,
            code: price.code,
            variant: price.variant,
            tier: price.tier,
            unit: price.unit,
            unit_price_cents: price.unitPriceCents,
            as_of: price.asOf,
            verified: price.verified,
            source_note: price.sourceNote,
          }),
        );
      }
    });
  }

  /**
   * `now()`. Each statement gets a later one than the last, so every write moves `updated_at` on. Postgres keeps
   * microseconds, which `Date` does not have: they are made up, so stamps carry six digits as real ones mostly do.
   */
  now(): string {
    if (this.statementStart !== null) return this.statementStart;
    const micros = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    this.lastMicros = Math.max(micros, this.lastMicros + 1);
    return formatTimestamp(this.lastMicros);
  }

  /**
   * Runs `statement` as one transaction: `now()` stays the same throughout, and if it throws, every table is put back
   * as it was. Writes replace row objects rather than change them, so keeping each table's array is enough.
   */
  transaction<T>(statement: () => T): T {
    // Already inside one: it is part of that statement, which puts everything back if it fails.
    if (this.statementStart !== null) return statement();
    const before = Object.entries(this.rows).map(([table, rows]) => [table, [...rows]] as const);
    this.statementStart = this.now();
    try {
      return statement();
    } catch (error) {
      for (const [table, rows] of before) this.rows[table as TableName].splice(0, Infinity, ...rows);
      throw error;
    } finally {
      this.statementStart = null;
    }
  }

  /** The companies `userId` belongs to, as `is_member` sees them. */
  viewer(userId: string): Viewer {
    return {
      userId,
      companies: new Set(this.rows.memberships.filter((m) => m.user_id === userId).map((m) => String(m.company_id))),
    };
  }

  /** A row for `table` from `values`, with the column defaults filled in. Throws what Postgres would. */
  newRow(table: TableName, values: Row): Row {
    const { columns } = TABLES[table];
    this.checkColumns(table, values);
    const row: Row = {};
    for (const [name, column] of Object.entries(columns)) {
      const value = Object.hasOwn(values, name) ? values[name] : column.initial ? column.initial(this) : null;
      row[name] = value;
    }
    this.checkValues(table, row);
    return row;
  }

  /** PostgREST refuses a payload naming a column the table does not have. */
  checkColumns(table: TableName, values: Row): void {
    for (const name of Object.keys(values)) {
      if (!Object.hasOwn(TABLES[table].columns, name)) {
        throw new PgError(400, "PGRST204", `Could not find the '${name}' column of '${table}' in the schema cache`);
      }
    }
  }

  /** Not-null and uuid checks, as Postgres makes them on a row about to be written. */
  checkValues(table: TableName, row: Row): void {
    for (const [name, column] of Object.entries(TABLES[table].columns)) {
      const value = row[name];
      if (value === null || value === undefined) {
        if (!column.nullable) {
          throw new PgError(400, "23502", `null value in column "${name}" of relation "${table}" violates not-null constraint`);
        }
        continue;
      }
      if (column.type === "uuid" && !isUuid(value)) {
        throw new PgError(400, "22P02", `invalid input syntax for type uuid: "${String(value)}"`);
      }
    }
  }

  /** Throws 23505 when `row` repeats a key another row of `table` (other than `self`) already holds. */
  checkUnique(table: TableName, row: Row, self?: Row): void {
    const spec = TABLES[table];
    for (const key of [spec.primaryKey, ...(spec.unique ?? [])]) {
      const clash = this.rows[table].find((other) => other !== self && key.every((column) => other[column] === row[column]));
      if (clash) {
        throw new PgError(409, "23505", `duplicate key value violates unique constraint "${table}_${key.join("_")}_key"`);
      }
    }
  }

  /** Copies of every row, for assertions: a caller cannot change the tables through them. */
  snapshot(table: TableName): Row[] {
    return structuredClone(this.rows[table]);
  }
}
