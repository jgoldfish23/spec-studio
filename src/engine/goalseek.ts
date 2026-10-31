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
 * The most points a search grid may have: $10 million in $100 steps, far past any lever of a spec home. Bisection
 * would take only 17 probes, but laying out a grid much bigger than this (or one with an endless end) is where float
 * error makes the walk to its last point never finish, so such a grid is refused instead.
 */
const MAX_GRID_POINTS = 100_000;

/**
 * The search grid over [lo, hi]: `lo + k * step` for k = 0.. while it stays within `hi`, then `hi` itself when it
 * is not already a grid point. Returns the point count and a way to read the i-th point. Throws a `RangeError` for a
 * step that is not a positive number, an end that is not finite, or more than `MAX_GRID_POINTS` points.
 */
function gridOf(lo: number, hi: number, step: number): { count: number; at: (i: number) => number } {
  if (!(step > 0) || !Number.isFinite(step)) throw new RangeError(`step must be a positive number, got ${step}`);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError(`the ends must be finite numbers, got ${lo} and ${hi}`);
  if (!(lo <= hi)) return { count: 0, at: () => NaN };
  // Points: every whole step from `lo`, plus `hi` when it is off the grid.
  if (Math.ceil((hi - lo) / step) + 1 > MAX_GRID_POINTS) {
    throw new RangeError(`the grid from ${lo} to ${hi} in steps of ${step} has more than ${MAX_GRID_POINTS} points`);
  }
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

/** The search's answer, or null (not reachable) when its range is too wide or unbounded to search (see `gridOf`). */
function searched(search: () => number | null): number | null {
  try {
    return search();
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * For each lever alone (lot price, base sale price, build cost), the value nearest the current one where
 * `isGo` says the deal passes every rule, within bounds: lot at least $0, price at most +50%, build at least
 * -50%. Results come in that order; a lever that cannot get there is `{ reachable: false }`, and so is a lever whose
 * range is too wide to search (more than 100,000 steps of $100).
 */
export function goalSeek(
  current: { lotPriceCents: Cents; basePriceCents: Cents; buildTotalCents: Cents },
  isGo: (a: Adjustment) => boolean,
): LeverResult[] {
  const { lotPriceCents, basePriceCents, buildTotalCents } = current;

  const lot = searched(() => seekMax((x) => isGo({ lotPriceCents: x }), 0, lotPriceCents, STEP_CENTS));
  const sale = searched(() =>
    seekMin(
      (x) => isGo({ salePriceFactor: factorOf(x, basePriceCents) }),
      basePriceCents,
      roundCents(basePriceCents * MAX_PRICE_FACTOR),
      STEP_CENTS,
    ),
  );
  const build = searched(() =>
    seekMax(
      (x) => isGo({ buildCostFactor: factorOf(x, buildTotalCents) }),
      roundCents(buildTotalCents * MIN_BUILD_FACTOR),
      buildTotalCents,
      STEP_CENTS,
    ),
  );

  return [
    reached("lotPrice", lot, lotPriceCents),
    reached("salePrice", sale, basePriceCents),
    reached("buildCost", build, buildTotalCents),
  ];
}
