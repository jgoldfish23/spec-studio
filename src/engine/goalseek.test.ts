import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { goalSeek, seekMax, seekMin, type Adjustment, type LeverResult } from "./goalseek";

const CURRENT = { lotPriceCents: 29_500_000, basePriceCents: 135_000_000, buildTotalCents: 73_599_750 };

/** A synthetic "is it a go?" that flips at one threshold per lever; other levers must be at their current value. */
const isGoAt = (a: Adjustment): boolean =>
  (a.lotPriceCents !== undefined && a.lotPriceCents <= 25_400_000) ||
  (a.salePriceFactor !== undefined && a.salePriceFactor >= 1.039) ||
  (a.buildCostFactor !== undefined && a.buildCostFactor <= 0.944);

describe("seekMax", () => {
  it("finds the largest grid point that passes", () => {
    expect(seekMax((x) => x <= 25_400_000, 0, 29_500_000, 10_000)).toBe(25_400_000);
  });

  it("rounds down to the grid when the true threshold sits between points", () => {
    expect(seekMax((x) => x <= 25_405_000, 0, 29_500_000, 10_000)).toBe(25_400_000);
  });

  it("returns null when even the low end fails", () => {
    expect(seekMax(() => false, 0, 29_500_000, 10_000)).toBeNull();
  });

  it("returns the high end when everything passes, on or off the grid", () => {
    expect(seekMax(() => true, 0, 29_500_000, 10_000)).toBe(29_500_000);
    expect(seekMax(() => true, 0, 29_505_000, 10_000)).toBe(29_505_000);
  });

  it("returns the low end when only it passes", () => {
    expect(seekMax((x) => x <= 0, 0, 29_500_000, 10_000)).toBe(0);
    expect(seekMax((x) => x <= 36_799_875, 36_799_875, 73_599_750, 10_000)).toBe(36_799_875);
  });

  it("walks the grid from the low end, so an off-zero low end keeps its offset", () => {
    expect(seekMax((x) => x <= 69_478_164, 36_799_875, 73_599_750, 10_000)).toBe(69_469_875);
  });

  it("includes the high end as a point when it is off the grid", () => {
    expect(seekMax((x) => x <= 73_599_750, 36_799_875, 73_599_750, 10_000)).toBe(73_599_750);
    // The point below the high end is the last grid point, not the high end.
    expect(seekMax((x) => x < 73_599_750, 36_799_875, 73_599_750, 10_000)).toBe(73_599_750 - 9_875);
  });

  it("handles a single-point range", () => {
    expect(seekMax(() => true, 500, 500, 10_000)).toBe(500);
    expect(seekMax(() => false, 500, 500, 10_000)).toBeNull();
  });

  it("returns null for an empty range", () => {
    expect(seekMax(() => true, 10, 5, 1)).toBeNull();
  });

  it("rejects a step that is not positive", () => {
    expect(() => seekMax(() => true, 0, 10, 0)).toThrow(RangeError);
    expect(() => seekMax(() => true, 0, 10, -1)).toThrow(RangeError);
  });

  it("bisects instead of scanning: a 2,950-point range takes at most 14 probes", () => {
    let probes = 0;
    const answer = seekMax(
      (x) => {
        probes += 1;
        return x <= 25_400_000;
      },
      0,
      29_500_000,
      10_000,
    );
    expect(answer).toBe(25_400_000);
    expect(probes).toBeLessThanOrEqual(14);
  });

  it("matches a linear scan of the grid for any monotone predicate (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.integer({ min: 0, max: 3_000 }),
        fc.integer({ min: 1, max: 97 }),
        fc.integer({ min: -2_000, max: 5_000 }),
        (lo, span, step, cut) => {
          const hi = lo + span;
          const points: number[] = [];
          for (let x = lo; x <= hi; x += step) points.push(x);
          if (points[points.length - 1] !== hi) points.push(hi);
          const passing = points.filter((x) => x <= cut);
          expect(seekMax((x) => x <= cut, lo, hi, step)).toBe(passing.length > 0 ? passing[passing.length - 1] : null);
        },
      ),
    );
  });
});

describe("seekMin", () => {
  it("finds the smallest grid point that passes", () => {
    expect(seekMin((x) => x >= 140_200_000, 135_000_000, 202_500_000, 10_000)).toBe(140_200_000);
  });

  it("rounds up to the grid when the true threshold sits between points", () => {
    expect(seekMin((x) => x >= 140_195_000, 135_000_000, 202_500_000, 10_000)).toBe(140_200_000);
  });

  it("returns null when even the high end fails", () => {
    expect(seekMin(() => false, 135_000_000, 202_500_000, 10_000)).toBeNull();
  });

  it("returns the low end when everything passes", () => {
    expect(seekMin(() => true, 135_000_000, 202_500_000, 10_000)).toBe(135_000_000);
  });

  it("returns the high end when only it passes, even off the grid", () => {
    expect(seekMin((x) => x >= 202_505_000, 135_000_000, 202_505_000, 10_000)).toBe(202_505_000);
  });

  it("handles a single-point range and an empty range", () => {
    expect(seekMin(() => true, 500, 500, 10_000)).toBe(500);
    expect(seekMin(() => false, 500, 500, 10_000)).toBeNull();
    expect(seekMin(() => true, 10, 5, 1)).toBeNull();
  });

  it("rejects a step that is not positive", () => {
    expect(() => seekMin(() => true, 0, 10, 0)).toThrow(RangeError);
  });

  it("bisects instead of scanning: a 6,751-point range takes at most 14 probes", () => {
    let probes = 0;
    const answer = seekMin(
      (x) => {
        probes += 1;
        return x >= 140_200_000;
      },
      135_000_000,
      202_500_000,
      10_000,
    );
    expect(answer).toBe(140_200_000);
    expect(probes).toBeLessThanOrEqual(14);
  });

  it("matches a linear scan of the grid for any monotone predicate (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.integer({ min: 0, max: 3_000 }),
        fc.integer({ min: 1, max: 97 }),
        fc.integer({ min: -2_000, max: 5_000 }),
        (lo, span, step, cut) => {
          const hi = lo + span;
          const points: number[] = [];
          for (let x = lo; x <= hi; x += step) points.push(x);
          if (points[points.length - 1] !== hi) points.push(hi);
          const passing = points.filter((x) => x >= cut);
          expect(seekMin((x) => x >= cut, lo, hi, step)).toBe(passing.length > 0 ? passing[0] : null);
        },
      ),
    );
  });
});

describe("goalSeek", () => {
  /** The result for one lever; fails the test when it is absent. */
  const lever = (results: LeverResult[], name: LeverResult["lever"]): LeverResult => {
    const found = results.find((r) => r.lever === name);
    if (!found) throw new Error(`no ${name} result`);
    return found;
  };

  it("returns lot price, sale price, then build cost", () => {
    expect(goalSeek(CURRENT, isGoAt).map((r) => r.lever)).toEqual(["lotPrice", "salePrice", "buildCost"]);
  });

  it("finds the lot price, sale price, and build cost where the synthetic rule flips to go", () => {
    const results = goalSeek(CURRENT, isGoAt);
    expect(lever(results, "lotPrice")).toEqual({
      lever: "lotPrice",
      reachable: true,
      valueCents: 25_400_000,
      deltaCents: 25_400_000 - 29_500_000,
      deltaPct: (25_400_000 - 29_500_000) / 29_500_000,
    });
    expect(lever(results, "salePrice")).toEqual({
      lever: "salePrice",
      reachable: true,
      valueCents: 140_270_000,
      deltaCents: 140_270_000 - 135_000_000,
      deltaPct: (140_270_000 - 135_000_000) / 135_000_000,
    });
    expect(lever(results, "buildCost")).toEqual({
      lever: "buildCost",
      reachable: true,
      valueCents: 69_469_875,
      deltaCents: 69_469_875 - 73_599_750,
      deltaPct: (69_469_875 - 73_599_750) / 73_599_750,
    });
  });

  it("holds the other levers at their current values for each probe", () => {
    const seen: Adjustment[] = [];
    goalSeek(CURRENT, (a) => {
      seen.push(a);
      return false;
    });
    for (const a of seen) {
      const set = [a.lotPriceCents, a.salePriceFactor, a.buildCostFactor].filter((v) => v !== undefined);
      expect(set).toHaveLength(1);
    }
    expect(seen.some((a) => a.lotPriceCents !== undefined)).toBe(true);
    expect(seen.some((a) => a.salePriceFactor !== undefined)).toBe(true);
    expect(seen.some((a) => a.buildCostFactor !== undefined)).toBe(true);
  });

  it("reports every lever as not reachable when nothing makes it a go", () => {
    expect(goalSeek(CURRENT, () => false)).toEqual([
      { lever: "lotPrice", reachable: false },
      { lever: "salePrice", reachable: false },
      { lever: "buildCost", reachable: false },
    ]);
  });

  it("reports only the levers that can get there within bounds", () => {
    // Needs a 60% higher price (out of the +50% bound) or a lot at $0; build cost never helps.
    const results = goalSeek(CURRENT, (a) => (a.salePriceFactor ?? 1) >= 1.6 || (a.lotPriceCents ?? 1) <= 0);
    expect(lever(results, "salePrice")).toEqual({ lever: "salePrice", reachable: false });
    expect(lever(results, "buildCost")).toEqual({ lever: "buildCost", reachable: false });
    expect(lever(results, "lotPrice")).toMatchObject({ reachable: true, valueCents: 0, deltaCents: -29_500_000, deltaPct: -1 });
  });

  it("stays inside the bounds: lot at least $0, price at most +50%, build at least -50%", () => {
    const results = goalSeek(CURRENT, () => true);
    // Lot price: the largest passing point is the current price.
    expect(lever(results, "lotPrice")).toMatchObject({ valueCents: 29_500_000, deltaCents: 0, deltaPct: 0 });
    // Sale price: the smallest passing point is the current price (a factor of exactly 1).
    expect(lever(results, "salePrice")).toMatchObject({ valueCents: 135_000_000, deltaCents: 0, deltaPct: 0 });
    // Build cost: the largest passing point is the current cost.
    expect(lever(results, "buildCost")).toMatchObject({ valueCents: 73_599_750, deltaCents: 0, deltaPct: 0 });

    const probes: Adjustment[] = [];
    goalSeek(CURRENT, (a) => {
      probes.push(a);
      return true;
    });
    for (const a of probes) {
      if (a.lotPriceCents !== undefined) expect(a.lotPriceCents).toBeGreaterThanOrEqual(0);
      if (a.lotPriceCents !== undefined) expect(a.lotPriceCents).toBeLessThanOrEqual(29_500_000);
      if (a.salePriceFactor !== undefined) expect(a.salePriceFactor).toBeLessThanOrEqual(1.5);
      if (a.salePriceFactor !== undefined) expect(a.salePriceFactor).toBeGreaterThanOrEqual(1);
      if (a.buildCostFactor !== undefined) expect(a.buildCostFactor).toBeGreaterThanOrEqual(0.5);
      if (a.buildCostFactor !== undefined) expect(a.buildCostFactor).toBeLessThanOrEqual(1);
    }
  });

  it("reaches the +50% price bound and the -50% build bound when those are the only answers", () => {
    const results = goalSeek(CURRENT, (a) => (a.salePriceFactor ?? 0) >= 1.5 || (a.buildCostFactor ?? 2) <= 0.5);
    expect(lever(results, "salePrice")).toMatchObject({ reachable: true, valueCents: 202_500_000 });
    expect(lever(results, "buildCost")).toMatchObject({ reachable: true, valueCents: 36_799_875 });
  });

  it("avoids dividing by zero when a current value is zero", () => {
    const results = goalSeek({ lotPriceCents: 0, basePriceCents: 0, buildTotalCents: 0 }, () => true);
    for (const r of results) {
      expect(r).toEqual({ lever: r.lever, reachable: true, valueCents: 0, deltaCents: 0, deltaPct: 0 });
    }
  });
});
