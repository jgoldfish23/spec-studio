// The fake's PostgREST (`/rest/v1/<table>`): the part of its query language supabase-js sends for this app —
// `select` (with one embedded table), `eq`/`is`/`in`/`or` filters, `order`, `limit`/`offset` and the `Range` header,
// `Prefer` (`return=representation`, `resolution=merge-duplicates`, `count=exact`) and the single-object `Accept`.
// Every read and write goes through row-level security as the migrations' policies write it.
import { PgError, TABLES, isTable, isUuid, parseTimestamp } from "./db";
import type { Db, Row, TableName, Viewer } from "./db";
import { isPlainObject } from "./http";
import type { Reply } from "./http";

const OBJECT = "application/vnd.pgrst.object+json";
/** Query parameters that are not a column filter. */
const RESERVED: ReadonlySet<string> = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "or"]);
/** The embeddings the schema's foreign keys allow, as `from table → { to table: foreign key column }`. */
const RELATIONS: Partial<Record<TableName, Partial<Record<TableName, string>>>> = {
  memberships: { companies: "company_id" },
};

type Test = (row: Row) => boolean | null;

const rlsViolation = (table: TableName) =>
  new PgError(403, "42501", `new row violates row-level security policy for table "${table}"`);

function columnOf(table: TableName, name: string) {
  const column = TABLES[table].columns[name];
  if (!column) throw new PgError(400, "42703", `column ${table}.${name} does not exist`);
  return column;
}

/** Splits `text` on commas outside parentheses and double quotes. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (quoted && char === "\\") {
      current += char + (text[++i] ?? "");
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "(") depth++;
    else if (!quoted && char === ")") depth--;
    else if (!quoted && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

const unquote = (value: string) => (/^".*"$/s.test(value) ? value.slice(1, -1).replace(/\\(.)/gs, "$1") : value);

// ---------------------------------------------------------------------------
// Values: a filter's text read as the column's type, so comparisons work as Postgres's do
// ---------------------------------------------------------------------------

function fromText(table: TableName, name: string, text: string): unknown {
  const { type } = columnOf(table, name);
  switch (type) {
    case "uuid":
      if (!isUuid(text)) throw new PgError(400, "22P02", `invalid input syntax for type uuid: "${text}"`);
      return text.toLowerCase();
    case "timestamptz": {
      const micros = parseTimestamp(text);
      if (micros === null) throw new PgError(400, "22007", `invalid input syntax for type timestamp with time zone: "${text}"`);
      return micros;
    }
    case "int":
    case "numeric": {
      const number = Number(text);
      if (text.trim() === "" || Number.isNaN(number)) throw new PgError(400, "22P02", `invalid input syntax for type ${type === "int" ? "integer" : "numeric"}: "${text}"`);
      return number;
    }
    case "bool":
      if (text !== "true" && text !== "false") throw new PgError(400, "22P02", `invalid input syntax for type boolean: "${text}"`);
      return text === "true";
    default:
      return text;
  }
}

/** A stored value in the same form `fromText` gives. */
function stored(table: TableName, name: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const { type } = columnOf(table, name);
  if (type === "uuid") return String(value).toLowerCase();
  if (type === "timestamptz") return parseTimestamp(String(value));
  if (type === "jsonb") return JSON.stringify(value);
  return value;
}

/** Postgres's comparison: null when either side is null. */
function compare(a: unknown, b: unknown): number | null {
  if (a === null || b === null) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** The comparison operators, as what a `compare` result must be for each to hold. */
const COMPARISONS: Record<string, (c: number) => boolean> = {
  eq: (c) => c === 0,
  neq: (c) => c !== 0,
  gt: (c) => c > 0,
  gte: (c) => c >= 0,
  lt: (c) => c < 0,
  lte: (c) => c <= 0,
};

/** One `column=op.value` filter (`not.` allowed in front of the operator). */
function condition(table: TableName, name: string, expression: string): Test {
  columnOf(table, name);
  const negated = expression.startsWith("not.");
  const rest = negated ? expression.slice(4) : expression;
  const dot = rest.indexOf(".");
  if (dot < 0) throw new PgError(400, "PGRST100", `"failed to parse filter (${expression})"`);
  const op = rest.slice(0, dot);
  const text = unquote(rest.slice(dot + 1));
  const value = (row: Row) => stored(table, name, row[name]);
  let test: Test;
  switch (op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const wanted = fromText(table, name, text);
      const holds = COMPARISONS[op] as (c: number) => boolean;
      test = (row) => {
        const c = compare(value(row), wanted);
        return c === null ? null : holds(c);
      };
      break;
    }
    case "is": {
      const wanted = text.toLowerCase();
      if (wanted === "null") test = (row) => row[name] === null;
      else if (wanted === "true" || wanted === "false") test = (row) => row[name] === (wanted === "true");
      else throw new PgError(400, "PGRST100", `"failed to parse filter (${expression})"`);
      break;
    }
    case "in": {
      const list = splitTop(text.replace(/^\(|\)$/g, "")).map((item) => fromText(table, name, unquote(item)));
      test = (row) => (row[name] === null ? null : list.some((item) => compare(value(row), item) === 0));
      break;
    }
    default:
      throw new PgError(400, "PGRST100", `"failed to parse filter (${expression})"`);
  }
  if (!negated) return test;
  return (row) => {
    const result = test(row);
    return result === null ? null : !result;
  };
}

/** `or=(a.eq.1,b.is.null)`. */
function orGroup(table: TableName, text: string): Test {
  const inner = /^\((.*)\)$/s.exec(text)?.[1];
  if (inner === undefined) throw new PgError(400, "PGRST100", `"failed to parse logic tree (${text})"`);
  const tests = splitTop(inner).map((part) => {
    const dot = part.indexOf(".");
    return condition(table, part.slice(0, dot), part.slice(dot + 1));
  });
  return (row) => tests.some((test) => test(row) === true);
}

/** Every filter in the query string; a row is kept only when all of them are true (not null). */
function whereOf(table: TableName, params: URLSearchParams): (row: Row) => boolean {
  const tests: Test[] = [];
  for (const [key, value] of params) {
    if (key === "or") tests.push(orGroup(table, value));
    else if (!RESERVED.has(key)) tests.push(condition(table, key, value));
  }
  return (row) => tests.every((test) => test(row) === true);
}

// ---------------------------------------------------------------------------
// Shaping the answer: select, order, range
// ---------------------------------------------------------------------------

/** `select=*`, `select=a,b`, or `select=company_id,companies(id,name)`: a function from a row to what is sent. */
function projection(db: Db, table: TableName, viewer: Viewer, select: string): (row: Row) => Row {
  const parts: ((row: Row, out: Row) => void)[] = [];
  for (const item of splitTop(select)) {
    const embed = /^(\w+)\((.*)\)$/s.exec(item);
    if (embed) {
      const [, target = "", inner = ""] = embed;
      const key = isTable(target) ? RELATIONS[table]?.[target] : undefined;
      if (!isTable(target) || key === undefined) {
        throw new PgError(400, "PGRST200", `Could not find a relationship between '${table}' and '${target}' in the schema cache`);
      }
      const project = projection(db, target, viewer, inner);
      parts.push((row, out) => {
        // The embedded table's own row-level security applies: an invisible row embeds as null.
        const found = db.rows[target].find((other) => other.id === row[key] && TABLES[target].using(other, viewer));
        out[target] = found ? project(found) : null;
      });
    } else if (item === "*") {
      parts.push((row, out) => Object.assign(out, structuredClone(row)));
    } else {
      columnOf(table, item);
      parts.push((row, out) => void (out[item] = structuredClone(row[item])));
    }
  }
  return (row) => {
    const out: Row = {};
    for (const part of parts) part(row, out);
    return out;
  };
}

/** `order=a.asc,b.desc.nullslast`. Postgres's default puts nulls last ascending and first descending. */
function sorted(table: TableName, rows: Row[], order: string | null): Row[] {
  if (order === null) return rows;
  const terms = order.split(",").map((term) => {
    const [name = "", ...modifiers] = term.trim().split(".");
    columnOf(table, name);
    const descending = modifiers.includes("desc");
    const nullsFirst = modifiers.includes("nullsfirst") || (descending && !modifiers.includes("nullslast"));
    return { name, descending, nullsFirst };
  });
  return [...rows].sort((a, b) => {
    for (const { name, descending, nullsFirst } of terms) {
      const left = stored(table, name, a[name]);
      const right = stored(table, name, b[name]);
      if (left === null || right === null) {
        if (left === right) continue;
        return (left === null) === nullsFirst ? -1 : 1;
      }
      const c = compare(left, right) ?? 0;
      if (c !== 0) return descending ? -c : c;
    }
    return 0;
  });
}

/** The rows asked for: the `Range: from-to` header and `offset`/`limit`, each narrowing the other. */
function requestedRange(params: URLSearchParams, headers: Record<string, string>): { from: number; to: number } {
  let from = 0;
  let to = Infinity;
  const range = /^(\d+)-(\d*)$/.exec(headers["range"] ?? "");
  if (range && (headers["range-unit"] ?? "items") === "items") {
    from = Number(range[1]);
    if (range[2] !== "") to = Number(range[2]);
  }
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  const limit = params.has("limit") ? Number(params.get("limit")) : Infinity;
  if (!Number.isInteger(offset) || offset < 0 || !(limit === Infinity || (Number.isInteger(limit) && limit >= 0))) {
    throw new PgError(400, "PGRST103", "Requested range not satisfiable");
  }
  return { from: Math.max(from, offset), to: Math.min(to, offset + limit - 1) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Replaces `old` with `next` where it stands, so a rolled-back statement can put the old array back. */
function replace(db: Db, table: TableName, old: Row, next: Row): void {
  const rows = db.rows[table];
  rows[rows.indexOf(old)] = next;
}

/** INSERT, or with `resolution=merge-duplicates` INSERT … ON CONFLICT (on_conflict) DO UPDATE of the sent columns. */
function insert(db: Db, table: TableName, viewer: Viewer, params: URLSearchParams, prefer: Set<string>, payload: unknown): Row[] {
  const spec = TABLES[table];
  const list = Array.isArray(payload) ? payload : [payload];
  if (!list.every(isPlainObject)) throw new PgError(400, "PGRST102", "Empty or invalid json");
  const conflict = params.get("on_conflict")?.split(",").map((name) => name.trim()) ?? spec.primaryKey;
  conflict.forEach((name) => columnOf(table, name));
  const merge = prefer.has("resolution=merge-duplicates");
  const ignore = prefer.has("resolution=ignore-duplicates");
  const written: Row[] = [];
  for (const values of list) {
    const row = db.newRow(table, values);
    const existing = merge || ignore ? db.rows[table].find((other) => conflict.every((name) => other[name] === row[name])) : undefined;
    if (existing && ignore) continue;
    if (existing) {
      // The old row must be one the user may update, and the new one must pass the policy's check.
      if (!spec.check?.(existing, viewer) || !spec.using(existing, viewer)) throw rlsViolation(table);
      const sent = Object.fromEntries(Object.keys(values).map((name) => [name, row[name]]));
      const updated = { ...existing, ...sent, updated_at: db.now() };
      if (!spec.check(updated, viewer)) throw rlsViolation(table);
      db.checkValues(table, updated);
      db.checkUnique(table, updated, existing);
      replace(db, table, existing, updated);
      written.push(updated);
      continue;
    }
    if (!spec.check?.(row, viewer)) throw rlsViolation(table);
    db.checkUnique(table, row);
    db.rows[table].push(row);
    written.push(row);
  }
  return written;
}

/** UPDATE … WHERE: only rows the user may update; the `updated_at` trigger stamps each. */
function update(db: Db, table: TableName, viewer: Viewer, where: (row: Row) => boolean, patch: unknown): Row[] {
  const spec = TABLES[table];
  if (!isPlainObject(patch)) throw new PgError(400, "PGRST102", "Empty or invalid json");
  db.checkColumns(table, patch);
  const written: Row[] = [];
  for (const row of db.rows[table].filter((r) => spec.using(r, viewer) && spec.check?.(r, viewer) && where(r))) {
    const updated = { ...row, ...structuredClone(patch), updated_at: db.now() };
    if (!spec.check?.(updated, viewer)) throw rlsViolation(table);
    db.checkValues(table, updated);
    db.checkUnique(table, updated, row);
    replace(db, table, row, updated);
    written.push(updated);
  }
  return written;
}

/** DELETE … WHERE: only rows the user may delete. */
function remove(db: Db, table: TableName, viewer: Viewer, where: (row: Row) => boolean): Row[] {
  const spec = TABLES[table];
  const gone = db.rows[table].filter((r) => spec.using(r, viewer) && spec.check?.(r, viewer) && where(r));
  db.rows[table].splice(0, Infinity, ...db.rows[table].filter((r) => !gone.includes(r)));
  return gone;
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

/** Answers one `/rest/v1/<table>` request for `viewer`, or null for a method the fake does not model. Throws `PgError`. */
export function handleRest(
  db: Db,
  viewer: Viewer,
  method: string,
  url: URL,
  headers: Record<string, string>,
  payload: unknown,
): Reply | null {
  const name = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
  if (!isTable(name)) throw new PgError(404, "PGRST205", `Could not find the table 'public.${name}' in the schema cache`);
  const table = name;
  const params = url.searchParams;
  const prefer = new Set((headers["prefer"] ?? "").split(",").map((p) => p.trim()).filter((p) => p !== ""));
  const single = (headers["accept"] ?? "").split(";")[0]?.trim() === OBJECT;
  const where = whereOf(table, params);
  const project = projection(db, table, viewer, params.get("select") ?? "*");

  /** The rows as sent: one object for the single-object `Accept` (exactly one row, or 406), else an array. */
  const shaped = (rows: Row[]): unknown => {
    if (!single) return rows.map(project);
    if (rows.length !== 1) {
      throw new PgError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`);
    }
    return project(rows[0] as Row);
  };
  const written = (rows: Row[], status: number): Reply =>
    prefer.has("return=representation") ? { status, body: shaped(rows) } : { status: method === "POST" ? 201 : 204 };

  // One statement: a write that fails part-way (or a 406 on its answer) leaves the tables as they were.
  return db.transaction((): Reply | null => {
    switch (method) {
      case "GET": {
        const rows = sorted(table, db.rows[table].filter((row) => TABLES[table].using(row, viewer) && where(row)), params.get("order"));
        const { from, to } = requestedRange(params, headers);
        const page = rows.slice(from, to + 1);
        const total = prefer.has("count=exact") ? String(rows.length) : "*";
        const range = page.length === 0 ? `*/${total}` : `${from}-${from + page.length - 1}/${total}`;
        return { status: 200, body: shaped(page), headers: { "content-range": range } };
      }
      case "POST":
        return written(insert(db, table, viewer, params, prefer, payload), 201);
      case "PATCH":
        return written(update(db, table, viewer, where, payload), 200);
      case "DELETE":
        return written(remove(db, table, viewer, where), 200);
      default:
        return null;
    }
  });
}
