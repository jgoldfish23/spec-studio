import type { EstimateLine } from "@engine";
import { formatPercent } from "../../lib/format";

const MISSING = "—";

/** Where the money of some cost lines came from: a bid, the owner's price book, or a starter default. */
export interface SourceCents {
  bid: number;
  priceBook: number;
  default: number;
}

/**
 * The cents of `lines` by price source, as the estimate itself counts them: a bid line is a bid, and any other line is
 * split by the source of each of its parts (a line can be partly price book and partly default).
 */
export function sourceCents(lines: readonly EstimateLine[]): SourceCents {
  const cents: SourceCents = { bid: 0, priceBook: 0, default: 0 };
  for (const line of lines) {
    if (line.source === "bid") cents.bid += line.totalCents;
    else for (const part of line.parts) cents[part.source] += part.totalCents;
  }
  return cents;
}

const NAMES: readonly (readonly [keyof SourceCents, string])[] = [
  ["bid", "Bid"],
  ["priceBook", "Price book"],
  ["default", "Default"],
];

/** A share as a whole percent; anything real but under half a percent is "<1%" rather than a "0%" that reads as none. */
const share = (cents: number, total: number): string =>
  cents / total < 0.005 ? "<1%" : formatPercent(cents / total, 0);

/** "Bid 20% · Price book 70% · Default 10%": the sources the division's cost rests on, left out when it has none. */
export function sourceMixText(cents: SourceCents): string {
  const total = cents.bid + cents.priceBook + cents.default;
  if (!(total > 0)) return MISSING;
  return NAMES.filter(([key]) => cents[key] > 0)
    .map(([key, name]) => `${name} ${share(cents[key], total)}`)
    .join(" · ");
}
