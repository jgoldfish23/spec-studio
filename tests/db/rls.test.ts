import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOLDEN_DEAL } from "../../src/engine/__fixtures__/golden";
import { asUser, freshDatabase, type TestDatabase } from "./helpers";

/**
 * Row-level security, proven on a real Postgres. Two companies (A, B), one owner each.
 * Everything in `beforeAll` runs as the superuser; every case afterwards runs through `asUser`,
 * which rolls back, so cases cannot leak state into each other.
 */

const UA = "aaaaaaaa-0000-4000-8000-00000000000a";
const UB = "bbbbbbbb-0000-4000-8000-00000000000b";
const CO_A = "aaaaaaaa-1111-4111-8111-00000000000a";
const CO_B = "bbbbbbbb-1111-4111-8111-00000000000b";
const DEAL_A = "aaaaaaaa-2222-4222-8222-00000000000a";
const DEAL_B = "bbbbbbbb-2222-4222-8222-00000000000b";

const RLS_VIOLATION = "42501";

/** The SQLSTATE of the error a query raises, or null when it succeeds. */
async function sqlState(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
  const { client } = db;
  await client.query("insert into auth.users (id) values ($1), ($2)", [UA, UB]);
  await client.query("insert into companies (id, name) values ($1, 'Company A'), ($2, 'Company B')", [
    CO_A,
    CO_B,
  ]);
  await client.query("insert into memberships (user_id, company_id) values ($1, $2), ($3, $4)", [
    UA,
    CO_A,
    UB,
    CO_B,
  ]);
  await client.query(
    `insert into deals (id, company_id, name, inputs) values
       ($1, $2, 'Deal A', '{"who":"a"}'), ($3, $4, 'Deal B', '{"who":"b"}')`,
    [DEAL_A, CO_A, DEAL_B, CO_B],
  );
  await client.query(
    `insert into default_prices (company_id, region, code, variant, tier, unit, unit_price_cents, as_of)
     values
       (null, 'utah-north', 'framing', 'std', null, 'sf', 450, '2026-01-01'),
       ($1,   'utah-north', 'framing', 'std', null, 'sf', 475, '2026-01-01'),
       ($2,   'utah-north', 'framing', 'std', null, 'sf', 490, '2026-01-01')`,
    [CO_A, CO_B],
  );
  await client.query(
    `insert into comps (company_id, region, data) values
       ($1, 'utah-north', '{"address":"1 North St"}'),
       ($1, 'utah-south', '{"address":"2 South St"}'),
       ($2, 'utah-north', '{"address":"3 Other Co St"}')`,
    [CO_A, CO_B],
  );
  await client.query(
    `insert into price_book_entries (company_id, code, variant, unit, unit_price_cents, as_of)
     values ($1, 'framing', 'std', 'sf', 500, '2026-02-01'), ($2, 'framing', 'std', 'sf', 600, '2026-02-01')`,
    [CO_A, CO_B],
  );
  await client.query(
    `insert into market_settings (company_id, region, settings)
     values ($1, 'utah-north', '{}'), ($2, 'utah-north', '{}')`,
    [CO_A, CO_B],
  );
  await client.query(
    `insert into company_settings (company_id, rules, contingency_pct)
     values ($1, '{}', 0.05), ($2, '{}', 0.08)`,
    [CO_A, CO_B],
  );
});

afterAll(async () => {
  await db?.drop();
});

describe("deals", () => {
  it("shows a member only their own company's deals", async () => {
    const rows = await asUser(db.client, UA, async (c) => (await c.query("select id from deals")).rows);
    expect(rows).toEqual([{ id: DEAL_A }]);
  });

  it("refuses to insert a deal into another company", async () => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(c.query("insert into deals (company_id, name, inputs) values ($1, 'Sneaky', '{}')", [CO_B])),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("lets a member insert a deal into their own company", async () => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(c.query("insert into deals (company_id, name, inputs) values ($1, 'Mine', '{}')", [CO_A])),
    );
    expect(state).toBeNull();
  });

  it("updates 0 rows of another company's deal", async () => {
    const result = await asUser(db.client, UA, (c) =>
      c.query("update deals set name = 'Hijacked' where id = $1", [DEAL_B]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("deletes 0 rows of another company's deal", async () => {
    const result = await asUser(db.client, UA, (c) => c.query("delete from deals where id = $1", [DEAL_B]));
    expect(result.rowCount).toBe(0);
  });

  it("refuses to move a deal into another company", async () => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(c.query("update deals set company_id = $1 where id = $2", [CO_B, DEAL_A])),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("shows nothing to anon", async () => {
    // No grant to anon, so the select is refused; if one is ever added it must still return no rows.
    let rows: unknown[] = [];
    const state = await asUser(db.client, null, (c) =>
      sqlState(c.query("select id from deals").then((r) => void (rows = r.rows))),
    );
    expect(state === RLS_VIOLATION || (state === null && rows.length === 0)).toBe(true);
  });

  it("shows nothing to a signed-in user who belongs to no company", async () => {
    const stranger = "cccccccc-0000-4000-8000-00000000000c";
    const rows = await asUser(db.client, stranger, async (c) => (await c.query("select id from deals")).rows);
    expect(rows).toEqual([]);
  });

  it("round-trips the golden deal through the inputs column", async () => {
    const stored = await asUser(db.client, UA, async (c) => {
      await c.query("insert into deals (id, company_id, name, inputs) values ($1, $2, 'Golden', $3::jsonb)", [
        "aaaaaaaa-2222-4222-8222-0000000000a1",
        CO_A,
        JSON.stringify(GOLDEN_DEAL),
      ]);
      const r = await c.query("select inputs from deals where id = $1", [
        "aaaaaaaa-2222-4222-8222-0000000000a1",
      ]);
      return r.rows[0]?.inputs;
    });
    expect(stored).toEqual(GOLDEN_DEAL);
  });

  it("rejects an unknown status and defaults to analyzing", async () => {
    const bad = await asUser(db.client, UA, (c) =>
      sqlState(c.query("insert into deals (company_id, name, status, inputs) values ($1, 'X', 'won', '{}')", [CO_A])),
    );
    expect(bad).toBe("23514");
    const row = await asUser(db.client, UA, async (c) => (await c.query("select status, schema_version from deals where id = $1", [DEAL_A])).rows[0]);
    expect(row).toEqual({ status: "analyzing", schema_version: 1 });
  });
});

describe("updated_at", () => {
  it("moves forward on update, even if the client sets it", async () => {
    // Inserted with an explicit old stamp (the trigger fires on update only), all inside one rolled-back transaction.
    const old = new Date("2020-01-01T00:00:00Z");
    const after = await asUser(db.client, UA, async (c) => {
      const id = "aaaaaaaa-2222-4222-8222-0000000000a2";
      await c.query("insert into deals (id, company_id, name, inputs, updated_at) values ($1, $2, 'Old', '{}', $3)", [
        id,
        CO_A,
        old,
      ]);
      const r = await c.query(
        "update deals set name = 'New', updated_at = '2001-01-01T00:00:00Z' where id = $1 returning updated_at",
        [id],
      );
      return r.rows[0]?.updated_at as Date;
    });
    expect(after.getTime()).toBeGreaterThan(old.getTime());
  });

  it("has a trigger on every table that has the column", async () => {
    const withColumn = await db.client.query(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'updated_at' order by table_name`,
    );
    const withTrigger = await db.client.query(
      `select distinct c.relname as table_name
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
        order by c.relname`,
    );
    expect(withColumn.rows.map((r) => r.table_name)).toEqual(["companies", "comps", "deals"]);
    expect(withTrigger.rows).toEqual(withColumn.rows);
  });
});

describe("default prices", () => {
  it("shows the global default and the member's own, never another company's", async () => {
    const rows = await asUser(
      db.client,
      UA,
      async (c) => (await c.query("select company_id, unit_price_cents from default_prices order by unit_price_cents")).rows,
    );
    expect(rows.map((r) => [r.company_id, Number(r.unit_price_cents)])).toEqual([
      [null, 450],
      [CO_A, 475],
    ]);
  });

  it("refuses to insert a global default (null company)", async () => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(
        c.query(
          `insert into default_prices (company_id, region, code, variant, unit, unit_price_cents, as_of)
           values (null, 'utah-north', 'roofing', 'std', 'sf', 100, '2026-01-01')`,
        ),
      ),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("refuses to insert a default for another company", async () => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(
        c.query(
          `insert into default_prices (company_id, region, code, variant, unit, unit_price_cents, as_of)
           values ($1, 'utah-north', 'roofing', 'std', 'sf', 100, '2026-01-01')`,
          [CO_B],
        ),
      ),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("cannot change or delete the global default", async () => {
    const { updated, deleted } = await asUser(db.client, UA, async (c) => ({
      updated: (await c.query("update default_prices set unit_price_cents = 1 where company_id is null")).rowCount,
      deleted: (await c.query("delete from default_prices where company_id is null")).rowCount,
    }));
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
  });

  it("cannot turn its own default into a global one", async () => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(c.query("update default_prices set company_id = null where company_id = $1", [CO_A])),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("allows one global row per code, variant and tier even when tier is null", async () => {
    const state = await sqlState(
      db.client.query(
        `insert into default_prices (company_id, region, code, variant, tier, unit, unit_price_cents, as_of)
         values (null, 'utah-north', 'framing', 'std', null, 'sf', 1, '2026-01-01')`,
      ),
    );
    expect(state).toBe("23505");
  });
});

describe("the other company tables", () => {
  it("hides memberships and companies that are not yours", async () => {
    const { memberships, companies } = await asUser(db.client, UA, async (c) => ({
      memberships: (await c.query("select user_id from memberships")).rows,
      companies: (await c.query("select id from companies")).rows,
    }));
    expect(memberships).toEqual([{ user_id: UA }]);
    expect(companies).toEqual([{ id: CO_A }]);
  });

  it("does not let a user join a company", async () => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(c.query("insert into memberships (user_id, company_id) values ($1, $2)", [UA, CO_B])),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("filters comps by region and never shows another company's", async () => {
    const rows = await asUser(
      db.client,
      UA,
      async (c) => (await c.query("select data from comps where region = 'utah-north'")).rows,
    );
    expect(rows).toEqual([{ data: { address: "1 North St" } }]);
  });

  it("scopes price book entries, market settings and company settings by company", async () => {
    const seen = await asUser(db.client, UA, async (c) => ({
      price: (await c.query("select company_id from price_book_entries")).rows,
      market: (await c.query("select company_id from market_settings")).rows,
      company: (await c.query("select company_id from company_settings")).rows,
    }));
    expect(seen.price).toEqual([{ company_id: CO_A }]);
    expect(seen.market).toEqual([{ company_id: CO_A }]);
    expect(seen.company).toEqual([{ company_id: CO_A }]);

    for (const table of ["price_book_entries", "market_settings", "company_settings"]) {
      const result = await asUser(db.client, UA, (c) => c.query(`delete from ${table} where company_id = $1`, [CO_B]));
      expect(result.rowCount, table).toBe(0);
    }
    const state = await asUser(db.client, UA, (c) =>
      sqlState(c.query("insert into company_settings (company_id, rules, contingency_pct) values ($1, '{}', 0.1)", [CO_B])),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("has row-level security enabled on every table", async () => {
    const result = await db.client.query(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    );
    expect(result.rows.map((r) => r.relname)).toEqual([
      "companies",
      "company_settings",
      "comps",
      "deals",
      "default_prices",
      "market_settings",
      "memberships",
      "price_book_entries",
    ]);
    expect(result.rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });
});
