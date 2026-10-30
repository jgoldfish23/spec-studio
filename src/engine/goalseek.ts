import { roundCents, type Cents } from "./money";

/** What goal seek tries: one lever moved, the others left alone. */
export type Adjustment = {
  /** Replaces the lot price. */
  lotPriceCents?: Cents;
  /** Multiplies every scenario's sale price. */
  salePriceFactor?: number;
  /** Multiplies every estimate line. */
  buildCostFactor?: number;
};

export type LeverResult = {
  lever: "lotPrice" | "salePrice" | "buildCost";
  reachable: boolean;
  /** The lever's value that makes it a Go: lot price, base sale price, or build cost total. */
  valueCents?: Cents;
  deltaCents?: Cents;
  /** Change from the current value as a decimal; 0 when the current value is 0. */
  deltaPct?: number;
};

/** Goal seek moves each lever in $100 steps. */
const STEP_CENTS: Cents = 10_000;
/** The sale price may rise by at most 50%. */
const MAX_PRICE_FACTOR = 1.5;
/** The build cost may fall by at most 50%. */
const MIN_BUILD_FACTOR = 0.5;

/**
 * The search grid over [lo, hi]: `lo + k * step` for k = 0.. while it stays within `hi`, then `hi` itself when it
 * is not already a grid point. Returns the point count and a way to read the i-th point.
 */
function gridOf(lo: number, hi: number, step: number): { count: number; at: (i: number) => number } {
  if (!(step > 0) || !Number.isFinite(step)) throw new RangeError(`step must be a positive number, got ${step}`);
  if (!(lo <= hi)) return { count: 0, at: () => NaN };
  // Floor, then correct for float error in the division so that exactly the points <= hi are on the grid.
  let last = Math.floor((hi - lo) / step);
  while (lo + (last + 1) * step <= hi) last += 1;
  while (last > 0 && lo + last * step > hi) last -= 1;
  const hasTail = lo + last * step < hi;
  return {
    count: last + 1 + (hasTail ? 1 : 0),
    at: (i) => (i <= last ? lo + i * step : hi),
  };
}

/**
 * The largest point on the step grid in [lo, hi] that passes, assuming `passes` is monotone (true up to the
 * answer, false above it). Null when `lo` fails. Bisects over grid indexes, so it takes O(log n) probes.
 */
export function seekMax(passes: (x: number) => boolean, lo: number, hi: number, step: number): number | null {
  const { count, at } = gridOf(lo, hi, step);
  if (count === 0 || !passes(at(0))) return null;
  let good = 0; // index known to pass
  let bad = count; // first index known to fail (count = none known)
  while (bad - good > 1) {
    const mid = good + Math.floor((bad - good) / 2);
    if (passes(at(mid))) good = mid;
    else bad = mid;
  }
  return at(good);
}

/**
 * The smallest point on the step grid in [lo, hi] that passes, assuming `passes` is monotone (false below the
 * answer, true from it up). Null when `hi` fails. Same grid as `seekMax`.
 */
export function seekMin(passes: (x: number) => boolean, lo: number, hi: number, step: number): number | null {
  const { count, at } = gridOf(lo, hi, step);
  if (count === 0 || !passes(at(count - 1))) return null;
  let bad = -1; // index known to fail (-1 = none known)
  let good = count - 1; // index known to pass
  while (good - bad > 1) {
    const mid = bad + Math.floor((good - bad) / 2);
    if (passes(at(mid))) good = mid;
    else bad = mid;
  }
  return at(good);
}

/** x over the current value; 1 (no change) when the current value is 0, where a factor changes nothing. */
const factorOf = (x: Cents, current: Cents): number => (current === 0 ? 1 : x / current);

function reached(lever: LeverResult["lever"], x: Cents | null, current: Cents): LeverResult {
  if (x === null) return { lever, reachable: false };
  return {
    lever,
    reachable: true,
    valueCents: x,
    deltaCents: x - current,
    deltaPct: current === 0 ? 0 : (x - current) / current,
  };
}

/**
 * For each lever alone (lot price, base sale price, build cost), the value nearest the current one where
 * `isGo` says the deal passes every rule, within bounds: lot at least $0, price at most +50%, build at least
 * -50%. Results come in that order; a lever that cannot get there is `{ reachable: false }`.
 */
export function goalSeek(
  current: { lotPriceCents: Cents; basePriceCents: Cents; buildTotalCents: Cents },
  isGo: (a: Adjustment) => boolean,
): LeverResult[] {
  const { lotPriceCents, basePriceCents, buildTotalCents } = current;

  const lot = seekMax((x) => isGo({ lotPriceCents: x }), 0, lotPriceCents, STEP_CENTS);
  const sale = seekMin(
    (x) => isGo({ salePriceFactor: factorOf(x, basePriceCents) }),
    basePriceCents,
    roundCents(basePriceCents * MAX_PRICE_FACTOR),
    STEP_CENTS,
  );
  const build = seekMax(
    (x) => isGo({ buildCostFactor: factorOf(x, buildTotalCents) }),
    roundCents(buildTotalCents * MIN_BUILD_FACTOR),
    buildTotalCents,
    STEP_CENTS,
  );

  return [
    reached("lotPrice", lot, lotPriceCents),
    reached("salePrice", sale, basePriceCents),
    reached("buildCost", build, buildTotalCents),
  ];
}
