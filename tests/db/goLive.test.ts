import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, freshDatabase, type TestDatabase } from "./helpers";

/** Migration 0002: create_company, timestamps everywhere, tighter grants, and the Plan 2 RLS regressions. */

const UA = "aaaaaaaa-0000-4000-8000-00000000000a";
const UB = "bbbbbbbb-0000-4000-8000-00000000000b";
const UNEW = "dddddddd-0000-4000-8000-00000000000d";
const CO_A = "aaaaaaaa-1111-4111-8111-00000000000a";
const CO_B = "bbbbbbbb-1111-4111-8111-00000000000b";

const RLS_VIOLATION = "42501";
const NAME = "City Creek Construction";
const RULES = { lotRule: "x" };

async function sqlState(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}

let db: TestDatabase;

const createCompany = (c: import("pg").Client, name: string) =>
  c.query("select public.create_company($1, $2::jsonb, $3) as id", [name, JSON.stringify(RULES), 0.07]);

beforeAll(async () => {
  db = await freshDatabase();
  const { client } = db;
  await client.query("insert into auth.users (id) values ($1), ($2), ($3)", [UA, UB, UNEW]);
  await client.query("insert into companies (id, name) values ($1, 'Company A'), ($2, 'Company B')", [CO_A, CO_B]);
  await client.query("insert into memberships (user_id, company_id) values ($1, $2), ($3, $4)", [UA, CO_A, UB, CO_B]);
  await client.query(
    `insert into default_prices (company_id, region, code, variant, tier, unit, unit_price_cents, as_of)
     values ($1, 'utah-north', 'framing', 'std', null, 'sf', 475, '2026-01-01'),
            ($2, 'utah-north', 'framing', 'std', null, 'sf', 490, '2026-01-01')`,
    [CO_A, CO_B],
  );
  await client.query(
    "insert into comps (id, company_id, region, data) values ('aaaaaaaa-3333-4333-8333-00000000000a', $1, 'utah-north', '{}')",
    [CO_A],
  );
  await client.query(
    `insert into price_book_entries (company_id, code, variant, unit, unit_price_cents, as_of)
     values ($1, 'framing', 'std', 'sf', 500, '2026-02-01')`,
    [CO_A],
  );
  await client.query("insert into market_settings (company_id, region, settings) values ($1, 'utah-north', '{}')", [CO_A]);
  await client.query("insert into company_settings (company_id, rules, contingency_pct) values ($1, '{}', 0.05), ($2, '{}', 0.08)", [
    CO_A,
    CO_B,
  ]);
});

afterAll(async () => {
  await db?.drop();
});

describe("create_company", () => {
  it("creates the company, an owner membership and the settings row", async () => {
    const out = await asUser(db.client, UNEW, async (c) => {
      const id = (await createCompany(c, NAME)).rows[0].id as string;
      // Read back as the new member, through row-level security: all three rows are visible to them.
      const company = (await c.query("select name, default_region from companies where id = $1", [id])).rows;
      const member = (await c.query("select user_id, role from memberships where company_id = $1", [id])).rows;
      const settings = (
        await c.query("select rules, contingency_pct::float8 as pct from company_settings where company_id = $1", [id])
      ).rows;
      return { id, company, member, settings };
    });
    expect(out.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(out.company).toEqual([{ name: NAME, default_region: "utah-north" }]);
    expect(out.member).toEqual([{ user_id: UNEW, role: "owner" }]);
    expect(out.settings).toEqual([{ rules: RULES, pct: 0.07 }]);
  });

  it("trims the name", async () => {
    const name = await asUser(db.client, UNEW, async (c) => {
      const id = (await createCompany(c, `  \t${NAME}\n `)).rows[0].id as string;
      return (await c.query("select name from companies where id = $1", [id])).rows[0].name;
    });
    expect(name).toBe(NAME);
  });

  it("raises SS002 the second time", async () => {
    const state = await asUser(db.client, UNEW, async (c) => {
      await createCompany(c, NAME);
      return sqlState(createCompany(c, "Another"));
    });
    expect(state).toBe("SS002");
  });

  it("raises SS002 for a user who is already a member", async () => {
    expect(await asUser(db.client, UA, (c) => sqlState(createCompany(c, NAME)))).toBe("SS002");
  });

  it("raises SS001 with no signed-in user", async () => {
    // Run as authenticated but with an empty subject, so auth.uid() is null.
    await db.client.query("begin");
    try {
      await db.client.query("set local role authenticated");
      await db.client.query("select set_config('request.jwt.claim.sub', '', true)");
      expect(await sqlState(createCompany(db.client, NAME))).toBe("SS001");
    } finally {
      await db.client.query("rollback");
    }
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["121 characters", "x".repeat(121)],
  ])("raises SS003 for a %s name", async (_label, name) => {
    expect(await asUser(db.client, UNEW, (c) => sqlState(createCompany(c, name)))).toBe("SS003");
  });

  it("accepts a 120-character name", async () => {
    expect(await asUser(db.client, UNEW, (c) => sqlState(createCompany(c, "x".repeat(120))))).toBeNull();
  });

  it("is executable by authenticated but not anon", async () => {
    await expect(asUser(db.client, null, (c) => createCompany(c, NAME))).rejects.toThrow(/permission denied/);
    await expect(asUser(db.client, null, (c) => c.query("select public.is_member($1)", [CO_A]))).rejects.toThrow(
      /permission denied/,
    );
    expect(await asUser(db.client, UA, (c) => sqlState(c.query("select public.is_member($1)", [CO_A])))).toBeNull();
  });
});

describe("regressions deferred from Plan 2", () => {
  it("does not let a member move their membership to another company", async () => {
    // No update policy on memberships, so the row is invisible to the update: 0 rows, no error.
    const result = await asUser(db.client, UA, (c) =>
      c.query("update memberships set company_id = $1 where user_id = $2", [CO_B, UA]),
    );
    expect(result.rowCount).toBe(0);
    const row = await db.client.query("select company_id from memberships where user_id = $1", [UA]);
    expect(row.rows).toEqual([{ company_id: CO_A }]);
  });

  it("cannot insert or update companies directly", async () => {
    const ins = await asUser(db.client, UA, (c) => sqlState(c.query("insert into companies (name) values ('Mine')")));
    expect(ins).toBe(RLS_VIOLATION);
    const upd = await asUser(db.client, UA, (c) => c.query("update companies set name = 'Renamed' where id = $1", [CO_A]));
    expect(upd.rowCount).toBe(0);
    const name = await db.client.query("select name from companies where id = $1", [CO_A]);
    expect(name.rows).toEqual([{ name: "Company A" }]);
  });

  const MOVES: [string, string][] = [
    ["comps", "company_id = $1"],
    ["price_book_entries", "company_id = $1"],
    ["market_settings", "company_id = $1"],
    ["company_settings", "company_id = $1"],
    ["default_prices", "company_id = $1"],
  ];
  it.each(MOVES)("cannot move a %s row to another company", async (table, where) => {
    const state = await asUser(db.client, UA, (c) =>
      sqlState(c.query(`update ${table} set company_id = $2 where ${where}`, [CO_A, CO_B])),
    );
    expect(state).toBe(RLS_VIOLATION);
  });

  it("can insert, update and delete its own price book, market settings, company settings and default prices", async () => {
    await asUser(db.client, UA, async (c) => {
      // price_book_entries
      await c.query(
        "insert into price_book_entries (company_id, code, variant, unit, unit_price_cents, as_of) values ($1, 'roofing', 'std', 'sf', 1, '2026-03-01')",
        [CO_A],
      );
      expect((await c.query("update price_book_entries set unit_price_cents = 2 where code = 'roofing'")).rowCount).toBe(1);
      expect((await c.query("delete from price_book_entries where code = 'roofing'")).rowCount).toBe(1);

      // market_settings
      await c.query("insert into market_settings (company_id, region, settings) values ($1, 'utah-south', '{}')", [CO_A]);
      expect((await c.query("update market_settings set settings = '{\"a\":1}' where region = 'utah-south'")).rowCount).toBe(1);
      expect((await c.query("delete from market_settings where region = 'utah-south'")).rowCount).toBe(1);

      // company_settings
      expect((await c.query("update company_settings set contingency_pct = 0.1 where company_id = $1", [CO_A])).rowCount).toBe(1);
      expect((await c.query("delete from company_settings where company_id = $1", [CO_A])).rowCount).toBe(1);
      await c.query("insert into company_settings (company_id, rules, contingency_pct) values ($1, '{}', 0.05)", [CO_A]);

      // default_prices (company rows)
      await c.query(
        "insert into default_prices (company_id, region, code, variant, unit, unit_price_cents, as_of) values ($1, 'utah-north', 'roofing', 'std', 'sf', 1, '2026-03-01')",
        [CO_A],
      );
      expect((await c.query("update default_prices set unit_price_cents = 2 where code = 'roofing'")).rowCount).toBe(1);
      expect((await c.query("delete from default_prices where code = 'roofing'")).rowCount).toBe(1);
    });
  });
});

describe("timestamps", () => {
  it("every public table has created_at and updated_at", async () => {
    const tables = (
      await db.client.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname")
    ).rows.map((r) => r.relname as string);
    expect(tables.length).toBeGreaterThanOrEqual(8);
    const cols = await db.client.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and column_name in ('created_at', 'updated_at')`,
    );
    for (const t of tables) {
      const have = cols.rows.filter((r) => r.table_name === t).map((r) => r.column_name).sort();
      expect(have, t).toEqual(["created_at", "updated_at"]);
    }
  });

  it("updated_at moves forward on update for every table", async () => {
    const old = "2020-01-01T00:00:00Z";
    const targets: [string, string][] = [
      ["memberships", "true"],
      ["default_prices", "true"],
      ["price_book_entries", "true"],
      ["market_settings", "true"],
      ["company_settings", "true"],
      ["companies", "true"],
      ["comps", "true"],
    ];
    for (const [table, where] of targets) {
      const { before, after } = await (async () => {
        await db.client.query("begin");
        try {
          // The trigger would overwrite the old stamp, so switch it off while planting it.
          await db.client.query(`alter table ${table} disable trigger user`);
          await db.client.query(`update ${table} set updated_at = $1`, [old]);
          await db.client.query(`alter table ${table} enable trigger user`);
          const before = (await db.client.query(`select min(updated_at) as t from ${table}`)).rows[0].t as Date;
          await db.client.query(`update ${table} set created_at = created_at where ${where}`);
          const after = (await db.client.query(`select min(updated_at) as t from ${table}`)).rows[0].t as Date;
          return { before, after };
        } finally {
          await db.client.query("rollback");
        }
      })();
      expect(before.getTime(), table).toBe(new Date(old).getTime());
      expect(after.getTime(), table).toBeGreaterThan(before.getTime());
    }
    // deals: covered in rls.test.ts
  });
});

describe("default privileges", () => {
  it("grants anon and authenticated nothing on a table created after 0002", async () => {
    await db.client.query("begin");
    try {
      await db.client.query("create table public.scratch_table (id int)");
      const grants = await db.client.query(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'scratch_table'
            and grantee in ('anon', 'authenticated')`,
      );
      expect(grants.rows).toEqual([]);
    } finally {
      await db.client.query("rollback");
    }
  });

  it("does not let anon execute any function in public", async () => {
    const rows = await db.client.query(
      `select p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows.rows).toEqual([]);
  });

  it("grants public, anon and authenticated nothing on a function created after 0002", async () => {
    await db.client.query("begin");
    try {
      await db.client.query("create function public.scratch_fn() returns int language sql as 'select 1'");
      const r = await db.client.query(
        `select has_function_privilege('anon', 'public.scratch_fn()', 'execute') as anon,
                has_function_privilege('authenticated', 'public.scratch_fn()', 'execute') as authenticated,
                exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where p.proname = 'scratch_fn' and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public`,
      );
      expect(r.rows[0]).toEqual({ anon: false, authenticated: false, public: false });
    } finally {
      await db.client.query("rollback");
    }
  });

  it("does not let authenticated execute the trigger function", async () => {
    const r = await db.client.query("select has_function_privilege('authenticated', 'public.set_updated_at()', 'execute') as x");
    expect(r.rows[0].x).toBe(false);
  });
});
