import type { DefaultPrice } from "@engine";

const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const row = (p: DefaultPrice): string => {
  if (!Number.isSafeInteger(p.unitPriceCents)) {
    throw new Error(`Starter price ${p.code}/${p.variant} has unitPriceCents ${p.unitPriceCents}; it must be a whole number of cents.`);
  }
  return `(null, ${quote(p.region)}, ${quote(p.code)}, ${quote(p.variant)}, ${p.tier === null ? "null" : quote(p.tier)}, ` +
  `${quote(p.unit)}, ${p.unitPriceCents}, ${quote(p.asOf)}, ${p.verified ? "true" : "false"}, ${quote(p.sourceNote)})`;
};

/**
 * The SQL of migration 0003: the starter cost book as global `default_prices` rows (`company_id` null),
 * which every company reads and none can change. Generated, never hand-edited.
 */
export function starterSeedSql(prices: readonly DefaultPrice[]): string {
  return (
    "-- Generated from src/data/starterCostBook.ts by src/data/supabase/starterSeed.test.ts (UPDATE_SEED=1). Do not edit.\n" +
    "insert into public.default_prices (company_id, region, code, variant, tier, unit, unit_price_cents, as_of, verified, source_note)\n" +
    "values\n" +
    prices.map(row).join(",\n") +
    "\non conflict do nothing;\n"
  );
}
