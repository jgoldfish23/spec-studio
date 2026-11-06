// Run with UPDATE_SEED=1 to rewrite supabase/migrations/0003_starter_cost_book.sql from STARTER_COST_BOOK.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DefaultPrice } from "@engine";
import { STARTER_COST_BOOK } from "../starterCostBook";
import { starterSeedSql } from "./starterSeed";

const FILE = join(process.cwd(), "supabase", "migrations", "0003_starter_cost_book.sql");

describe("starterSeedSql", () => {
  it("matches the committed 0003 migration byte for byte", () => {
    const sql = starterSeedSql(STARTER_COST_BOOK);
    if (process.env.UPDATE_SEED === "1") writeFileSync(FILE, sql);
    expect(readFileSync(FILE, "utf8")).toBe(sql);
  });

  it("inserts global rows and skips ones that exist", () => {
    const sql = starterSeedSql(STARTER_COST_BOOK);
    expect(sql).toContain("insert into public.default_prices");
    expect(sql).toMatch(/on conflict do nothing;\s*$/);
    expect(sql).toContain("(null, 'utah-north', 'framing'");
    expect(sql.match(/^\(null, /gm)).toHaveLength(STARTER_COST_BOOK.length);
  });

  it("escapes quotes in strings and writes null tiers as null", () => {
    const price: DefaultPrice = {
      code: "framing",
      variant: "it's",
      tier: null,
      region: "utah-north",
      unitPriceCents: 2350,
      unit: "sf",
      asOf: "2026-10-30",
      verified: false,
      sourceNote: "O'Brien's quote",
    };
    const sql = starterSeedSql([price]);
    expect(sql).toContain("'it''s'");
    expect(sql).toContain("'O''Brien''s quote'");
    expect(sql).toContain("null, 'sf', 2350, '2026-10-30', false,");
  });
});
