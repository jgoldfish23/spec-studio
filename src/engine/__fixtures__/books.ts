import type { CostBookView, DefaultPrice, LinePart } from "../costbook";
import type { ISODate } from "../dates";
import type { Cents } from "../money";

/** A book with one verified default at the same unit price for every distinct price key in `parts`. */
export function uniformBookFor(
  parts: LinePart[],
  region: string,
  unitPriceCents: Cents,
  asOf: ISODate,
): CostBookView {
  const defaults = new Map<string, DefaultPrice>();
  for (const p of parts) {
    const key = JSON.stringify([p.code, p.variant, p.tier]);
    if (defaults.has(key)) continue;
    defaults.set(key, {
      code: p.code,
      variant: p.variant,
      tier: p.tier,
      region,
      unitPriceCents,
      unit: p.unit,
      asOf,
      verified: true,
      sourceNote: "test",
    });
  }
  return { defaults: [...defaults.values()], priceBook: [] };
}
