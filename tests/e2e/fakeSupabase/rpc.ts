// The fake's functions (`/rest/v1/rpc/<name>`): `create_company` as migration 0002 writes it.
import { PgError } from "./db";
import type { Db, Viewer } from "./db";
import { isPlainObject } from "./http";
import type { Reply } from "./http";

const CREATE_COMPANY_ARGS = ["p_contingency_pct", "p_name", "p_rules"];

/**
 * `create_company(p_name, p_rules, p_contingency_pct)`: for a caller with no company yet, makes the company, their
 * owner membership and the company's settings, and returns the new id. SS003 for a bad name, SS002 for a caller who
 * already has a company (the app sends no anon-key data requests, so SS001 cannot happen here). No market settings row:
 * the function does not make one.
 */
function createCompany(db: Db, viewer: Viewer, args: Record<string, unknown>): Reply {
  const name = (typeof args.p_name === "string" ? args.p_name : "").replace(/^\s+|\s+$/g, "");
  if (name === "" || [...name].length > 120) throw new PgError(400, "SS003", "company name must be 1 to 120 characters");
  if (db.rows.memberships.some((m) => m.user_id === viewer.userId)) {
    throw new PgError(400, "SS002", "already a member of a company");
  }
  return db.transaction(() => {
    const company = db.newRow("companies", { name });
    db.rows.companies.push(company);
    db.rows.memberships.push(db.newRow("memberships", { user_id: viewer.userId, company_id: company.id, role: "owner" }));
    db.rows.company_settings.push(
      db.newRow("company_settings", { company_id: company.id, rules: args.p_rules, contingency_pct: args.p_contingency_pct }),
    );
    // A function returning uuid: PostgREST sends the bare value as JSON.
    return { status: 200, body: company.id };
  });
}

/** Answers a call to `name` with `args`. Throws `PgError` as PostgREST would answer. */
export function handleRpc(db: Db, viewer: Viewer, name: string, args: unknown): Reply {
  const given = isPlainObject(args) ? Object.keys(args).sort() : [];
  if (name !== "create_company" || !isPlainObject(args) || given.join() !== CREATE_COMPANY_ARGS.join()) {
    throw new PgError(404, "PGRST202", `Could not find the function public.${name}(${given.join(", ")}) in the schema cache`);
  }
  return createCompany(db, viewer, args);
}
