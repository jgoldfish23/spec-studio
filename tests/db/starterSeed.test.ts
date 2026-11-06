import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTER_COST_BOOK } from "../../src/data/starterCostBook";
import { defaultPriceFromRow, type DefaultPriceRow } from "../../src/data/supabase/mappers";
import { asUser, freshDatabase, type TestDatabase } from "./helpers";

const UA = "aaaaaaaa-0000-4000-8000-00000000000a";
const CO_A = "aaaaaaaa-1111-4111-8111-00000000000a";

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
  await db.client.query("insert into auth.users (id) values ($1)", [UA]);
  await db.client.query("insert into companies (id, name) values ($1, 'Company A')", [CO_A]);
  await db.client.query("insert into memberships (user_id, company_id) values ($1, $2)", [UA, CO_A]);
});

afterAll(async () => {
  await db?.drop();
});

describe("starter cost book rows", () => {
  it("has one global row per starter price", async () => {
    const { rows } = await db.client.query("select count(*)::int as n from default_prices where company_id is null");
    expect(rows[0].n).toBe(STARTER_COST_BOOK.length);
  });

  it("maps back to exactly the starter prices", async () => {
    const { rows } = await db.client.query<DefaultPriceRow>("select id, company_id, region, code, variant, tier, unit, unit_price_cents, as_of::text as as_of, verified, source_note from default_prices where company_id is null");
    const key = (p: { code: string; variant: string; tier: string | null }) => `${p.code}|${p.variant}|${p.tier}`;
    const got = new Map(rows.map((r) => [key(r), defaultPriceFromRow(r)]));
    for (const p of STARTER_COST_BOOK) expect(got.get(key(p))).toEqual(p);
  });

  it("is readable by a member and not writable by them", async () => {
    const n = await asUser(db.client, UA, async (c) => {
      const { rows } = await c.query("select count(*)::int as n from default_prices where company_id is null");
      return rows[0].n as number;
    });
    expect(n).toBe(STARTER_COST_BOOK.length);

    const attempts = [
      "update default_prices set unit_price_cents = 1 where company_id is null",
      "delete from default_prices where company_id is null",
    ];
    for (const sql of attempts) {
      const affected = await asUser(db.client, UA, async (c) => (await c.query(sql)).rowCount);
      expect(affected).toBe(0);
    }
    await expect(
      asUser(db.client, UA, (c) =>
        c.query(
          `insert into default_prices (company_id, region, code, variant, tier, unit, unit_price_cents, as_of)
           values (null, 'utah-north', 'zzz', 'x', null, 'sf', 1, '2026-01-01')`,
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
