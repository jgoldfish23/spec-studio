import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOLDEN_DEAL, GOLDEN_EXPECTED, goldenEstimate } from "./__fixtures__/golden";
import { buildProFormaInput, runCashFlow, type ScenarioInputs } from "./cashflow";
import { DEFAULT_SCENARIO_DEFS, type DealInputs, type ScenarioDefs } from "./deal";
import type { PriceEstimate } from "./market";
import type { DomEstimate } from "./dom";
import { computeMetrics } from "./metrics";
import { roundCents } from "./money";
import type { Result } from "./result";
import {
  bandOf,
  DOM_COLUMNS,
  PRICE_DELTAS,
  resolveScenarios,
  runScenarios,
  sensitivityGrid,
  type Band,
  type ScenarioName,
} from "./scenarios";

const price = (lowCents: number, midCents: number, highCents: number): PriceEstimate => ({
  lowCents,
  midCents,
  highCents,
  midPerEffectiveSfCents: 0,
  comps: [],
});

const dom = (lowDays: number, typicalDays: number, highDays: number): DomEstimate => ({
  lowDays,
  typicalDays,
  highDays,
  confidence: "medium",
  compCount: 6,
  recentCount: 3,
  factors: { seasonal: 1, pricePosition: 1, condition: 1 },
  explain: [],
});

const MARKET_PRICE = price(120_900_000, 130_000_000, 135_200_000);
const MARKET_DOM = dom(45, 54, 69);
const OVERRIDES = { basePriceCents: 135_000_000, baseDomDays: 62 };

/** The scenarios of an ok result; fails the test on anything else. */
function okValue<T>(r: Result<T>): { value: T; codes: string[] } {
  if (r.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return { value: r.value, codes: r.warnings.map((w) => w.code) };
}

describe("resolveScenarios", () => {
  it("scales the market range around the base price and days on market overrides", () => {
    const { value: r, codes } = okValue(resolveScenarios(DEFAULT_SCENARIO_DEFS, MARKET_PRICE, MARKET_DOM, OVERRIDES));
    expect(r.downside).toEqual({ priceCents: 125_550_000, domDays: 79, overrunPct: 0.05 });
    expect(r.base).toEqual({ priceCents: 135_000_000, domDays: 62, overrunPct: 0 });
    expect(r.upside).toEqual({ priceCents: 140_400_000, domDays: 52, overrunPct: 0 });
    expect(codes).toEqual([]);
  });

  it("uses the market values as they are when there are no overrides", () => {
    const { value: r, codes } = okValue(resolveScenarios(DEFAULT_SCENARIO_DEFS, MARKET_PRICE, MARKET_DOM, {}));
    expect(r.downside).toEqual({ priceCents: 120_900_000, domDays: 69, overrunPct: 0.05 });
    expect(r.base).toEqual({ priceCents: 130_000_000, domDays: 54, overrunPct: 0 });
    expect(r.upside).toEqual({ priceCents: 135_200_000, domDays: 45, overrunPct: 0 });
    expect(codes).toEqual([]);
  });

  it("scales only the price when only the price is overridden", () => {
    const { value: r } = okValue(
      resolveScenarios(DEFAULT_SCENARIO_DEFS, MARKET_PRICE, MARKET_DOM, { basePriceCents: 135_000_000 }),
    );
    expect(r.downside).toMatchObject({ priceCents: 125_550_000, domDays: 69 });
    expect(r.base).toMatchObject({ priceCents: 135_000_000, domDays: 54 });
    expect(r.upside).toMatchObject({ priceCents: 140_400_000, domDays: 45 });
  });

  it("scales only the days on market when only they are overridden", () => {
    const { value: r } = okValue(
      resolveScenarios(DEFAULT_SCENARIO_DEFS, MARKET_PRICE, MARKET_DOM, { baseDomDays: 62 }),
    );
    expect(r.downside).toMatchObject({ priceCents: 120_900_000, domDays: 79 });
    expect(r.base).toMatchObject({ priceCents: 130_000_000, domDays: 62 });
    expect(r.upside).toMatchObject({ priceCents: 135_200_000, domDays: 52 });
  });

  it("maps each scenario through its own price source, days source and overrun", () => {
    const defs: ScenarioDefs = {
      downside: { priceSource: "mid", domSource: "typical", overrunPct: 0.1 },
      base: { priceSource: "low", domSource: "high", overrunPct: 0.02 },
      upside: { priceSource: "high", domSource: "low", overrunPct: 0 },
    };
    const { value: r } = okValue(resolveScenarios(defs, MARKET_PRICE, MARKET_DOM, {}));
    expect(r.downside).toEqual({ priceCents: 130_000_000, domDays: 54, overrunPct: 0.1 });
    expect(r.base).toEqual({ priceCents: 120_900_000, domDays: 69, overrunPct: 0.02 });
    expect(r.upside).toEqual({ priceCents: 135_200_000, domDays: 45, overrunPct: 0 });
  });

  it("rounds half away from zero to the cent and to the whole day", () => {
    // 1 × 3 / 2 = 1.5 cents, 1 × 3 / 2 = 1.5 days: both round up.
    const { value: r } = okValue(
      resolveScenarios(DEFAULT_SCENARIO_DEFS, price(1, 2, 3), dom(1, 2, 3), { basePriceCents: 1, baseDomDays: 1 }),
    );
    expect(r.upside).toMatchObject({ priceCents: 2, domDays: 1 }); // upside: price high (1.5 → 2), days low (0.5 → 1)
    expect(r.downside).toMatchObject({ priceCents: 1, domDays: 2 }); // downside: price low (0.5 → 1), days high (1.5 → 2)
  });

  describe("without market data", () => {
    it("uses the overrides for all three scenarios, with one noMarketRange warning", () => {
      const r = resolveScenarios(DEFAULT_SCENARIO_DEFS, null, null, OVERRIDES);
      const { value, codes } = okValue(r);
      expect(value.downside).toEqual({ priceCents: 135_000_000, domDays: 62, overrunPct: 0.05 });
      expect(value.base).toEqual({ priceCents: 135_000_000, domDays: 62, overrunPct: 0 });
      expect(value.upside).toEqual({ priceCents: 135_000_000, domDays: 62, overrunPct: 0 });
      expect(codes).toEqual(["noMarketRange"]);
      if (r.status === "ok") expect(r.warnings[0]?.message).not.toBe("");
    });

    it("warns once when only the price has fallen back", () => {
      const { value, codes } = okValue(
        resolveScenarios(DEFAULT_SCENARIO_DEFS, null, MARKET_DOM, { basePriceCents: 135_000_000 }),
      );
      expect(value.downside).toEqual({ priceCents: 135_000_000, domDays: 69, overrunPct: 0.05 });
      expect(value.base).toEqual({ priceCents: 135_000_000, domDays: 54, overrunPct: 0 });
      expect(value.upside).toEqual({ priceCents: 135_000_000, domDays: 45, overrunPct: 0 });
      expect(codes).toEqual(["noMarketRange"]);
    });

    it("warns once when only the days on market have fallen back", () => {
      const { value, codes } = okValue(
        resolveScenarios(DEFAULT_SCENARIO_DEFS, MARKET_PRICE, null, { baseDomDays: 62 }),
      );
      expect(value.downside).toEqual({ priceCents: 120_900_000, domDays: 62, overrunPct: 0.05 });
      expect(value.base).toEqual({ priceCents: 130_000_000, domDays: 62, overrunPct: 0 });
      expect(value.upside).toEqual({ priceCents: 135_200_000, domDays: 62, overrunPct: 0 });
      expect(codes).toEqual(["noMarketRange"]);
    });

    it("is incomplete (noComps) with no market and no overrides", () => {
      const r = resolveScenarios(DEFAULT_SCENARIO_DEFS, null, null, {});
      expect(r.status).toBe("incomplete");
      if (r.status !== "incomplete") return;
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]).toMatchObject({ code: "noComps", step: "market" });
      expect(r.missing[0]?.message).toMatch(/price/i);
      expect(r.missing[0]?.message).toMatch(/days on market/i);
    });

    it("is incomplete when the price has neither a market range nor an override", () => {
      const r = resolveScenarios(DEFAULT_SCENARIO_DEFS, null, MARKET_DOM, { baseDomDays: 62 });
      expect(r.status).toBe("incomplete");
      if (r.status !== "incomplete") return;
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]).toMatchObject({ code: "noComps", step: "market" });
      expect(r.missing[0]?.message).toMatch(/price/i);
    });

    it("is incomplete when the days on market have neither a market range nor an override", () => {
      const r = resolveScenarios(DEFAULT_SCENARIO_DEFS, MARKET_PRICE, null, { basePriceCents: 135_000_000 });
      expect(r.status).toBe("incomplete");
      if (r.status !== "incomplete") return;
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]).toMatchObject({ code: "noComps", step: "market" });
      expect(r.missing[0]?.message).toMatch(/days on market/i);
    });

    it("is incomplete when one dimension is covered by an override and the other has nothing", () => {
      expect(resolveScenarios(DEFAULT_SCENARIO_DEFS, null, null, { basePriceCents: 135_000_000 }).status).toBe(
        "incomplete",
      );
      expect(resolveScenarios(DEFAULT_SCENARIO_DEFS, null, null, { baseDomDays: 62 }).status).toBe("incomplete");
    });
  });

  it("treats a market range with no mid as missing, so an override stands in for it", () => {
    const { value, codes } = okValue(resolveScenarios(DEFAULT_SCENARIO_DEFS, price(0, 0, 0), dom(0, 0, 0), OVERRIDES));
    expect(value.downside).toMatchObject({ priceCents: 135_000_000, domDays: 62 });
    expect(value.upside).toMatchObject({ priceCents: 135_000_000, domDays: 62 });
    expect(codes).toEqual(["noMarketRange"]);
  });

  it("does not change its arguments", () => {
    const defs = structuredClone(DEFAULT_SCENARIO_DEFS);
    const p = structuredClone(MARKET_PRICE);
    const d = structuredClone(MARKET_DOM);
    const o = { ...OVERRIDES };
    resolveScenarios(defs, p, d, o);
    expect(defs).toEqual(DEFAULT_SCENARIO_DEFS);
    expect(p).toEqual(MARKET_PRICE);
    expect(d).toEqual(MARKET_DOM);
    expect(o).toEqual(OVERRIDES);
  });

  it("puts the override exactly on the base scenario (mid → P0) for any market range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 365 }),
        fc.integer({ min: 1, max: 365 }),
        (p0, a, b, c, d0, typical) => {
          const [low, mid, high] = [a, b, c].sort((x, y) => x - y) as [number, number, number];
          const r = okValue(
            resolveScenarios(DEFAULT_SCENARIO_DEFS, price(low, mid, high), dom(1, typical, 2 * typical), {
              basePriceCents: p0,
              baseDomDays: d0,
            }),
          ).value;
          expect(r.base.priceCents).toBe(p0);
          expect(r.base.domDays).toBe(d0);
        },
      ),
    );
  });

  it("keeps downside ≤ base ≤ upside in price, and upside ≤ base ≤ downside in days, when the market range is ordered", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.tuple(
          fc.integer({ min: 1, max: 1_000_000_000 }),
          fc.integer({ min: 1, max: 1_000_000_000 }),
          fc.integer({ min: 1, max: 1_000_000_000 }),
        ),
        fc.tuple(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 400 })),
        fc.integer({ min: 0, max: 800 }),
        (p0, prices, days, d0) => {
          const [pl, pm, ph] = [...prices].sort((x, y) => x - y) as [number, number, number];
          const [dl, dt, dh] = [...days].sort((x, y) => x - y) as [number, number, number];
          const r = okValue(
            resolveScenarios(DEFAULT_SCENARIO_DEFS, price(pl, pm, ph), dom(dl, dt, dh), {
              basePriceCents: p0,
              baseDomDays: d0,
            }),
          ).value;
          expect(r.downside.priceCents).toBeLessThanOrEqual(r.base.priceCents);
          expect(r.base.priceCents).toBeLessThanOrEqual(r.upside.priceCents);
          expect(r.upside.domDays).toBeLessThanOrEqual(r.base.domDays);
          expect(r.base.domDays).toBeLessThanOrEqual(r.downside.domDays);
          expect(Number.isInteger(r.downside.domDays)).toBe(true);
          expect(Number.isInteger(r.downside.priceCents)).toBe(true);
        },
      ),
    );
  });
});

describe("runScenarios", () => {
  const estimate = goldenEstimate();

  it("runs each scenario through the cash flow and metrics", () => {
    const base = GOLDEN_EXPECTED.scenarios.base.inputs;
    const stress = GOLDEN_EXPECTED.scenarios.stress.inputs;
    const upside: ScenarioInputs = { priceCents: 140_400_000, domDays: 52, overrunPct: 0 };
    const results = runScenarios(GOLDEN_DEAL, estimate, { downside: stress, base, upside });

    expect(results.base.inputs).toEqual(base);
    expect(results.downside.inputs).toEqual(stress);
    expect(results.upside.inputs).toEqual(upside);
    expect(results.base.metrics.profitCents).toBe(GOLDEN_EXPECTED.scenarios.base.metrics.profitCents);
    expect(results.downside.metrics.profitCents).toBe(GOLDEN_EXPECTED.scenarios.stress.metrics.profitCents);

    for (const name of ["downside", "base", "upside"] as const satisfies readonly ScenarioName[]) {
      const input = buildProFormaInput(GOLDEN_DEAL, estimate, results[name].inputs);
      const cf = runCashFlow(input);
      expect(results[name].cashFlow).toEqual(cf);
      expect(results[name].metrics).toEqual(computeMetrics(cf, input));
    }
  });

  it("orders profit upside > base > downside on the golden deal", () => {
    const resolved = okValue(resolveScenarios(DEFAULT_SCENARIO_DEFS, MARKET_PRICE, MARKET_DOM, OVERRIDES)).value;
    const r = runScenarios(GOLDEN_DEAL, estimate, resolved);
    expect(r.upside.metrics.profitCents).toBeGreaterThan(r.base.metrics.profitCents);
    expect(r.base.metrics.profitCents).toBeGreaterThan(r.downside.metrics.profitCents);
  });
});

describe("bandOf", () => {
  it.each<[number, Band]>([
    [-1, "loss"],
    [-500_000_000, "loss"],
    [0, "b0_50"],
    [4_999_999, "b0_50"],
    [5_000_000, "b50_100"],
    [9_999_999, "b50_100"],
    [10_000_000, "b100_150"],
    [14_999_999, "b100_150"],
    [15_000_000, "b150_200"],
    [19_999_999, "b150_200"],
    [20_000_000, "b200plus"],
    [900_000_000, "b200plus"],
  ])("puts %i cents in %s", (profitCents, band) => {
    expect(bandOf(profitCents)).toBe(band);
  });
});

describe("sensitivityGrid", () => {
  const estimate = goldenEstimate();
  const base = GOLDEN_EXPECTED.scenarios.base.inputs;
  const grid = sensitivityGrid(GOLDEN_DEAL, estimate, base);

  /** Profit of a direct cash-flow run, bypassing the grid. */
  const direct = (s: ScenarioInputs, d: DealInputs = GOLDEN_DEAL): number => {
    const input = buildProFormaInput(d, estimate, s);
    return computeMetrics(runCashFlow(input), input).profitCents;
  };

  it("lists the agreed price steps and day columns", () => {
    expect(PRICE_DELTAS).toEqual([0.05, 0, -0.05, -0.1, -0.15]);
    expect(DOM_COLUMNS).toEqual([30, 60, 90, 120, 180]);
  });

  it("is 5 × 5 with rows in price-delta order and columns in day order", () => {
    expect(grid).toHaveLength(5);
    grid.forEach((row, r) => {
      expect(row).toHaveLength(5);
      row.forEach((cell, c) => {
        expect(cell.priceDelta).toBe(PRICE_DELTAS[r]);
        expect(cell.domDays).toBe(DOM_COLUMNS[c]);
      });
    });
  });

  it("matches a direct run for every cell", () => {
    grid.forEach((row, r) => {
      row.forEach((cell, c) => {
        const priceCents = roundCents(base.priceCents * (1 + PRICE_DELTAS[r]!));
        expect(cell.profitCents).toBe(direct({ priceCents, domDays: DOM_COLUMNS[c]!, overrunPct: base.overrunPct }));
      });
    });
  });

  it("puts the 0% / 60 day cell at the base price and 60 days", () => {
    expect(grid[1]![1]!.profitCents).toBe(direct({ priceCents: base.priceCents, domDays: 60, overrunPct: 0 }));
  });

  it("buckets every cell by its profit", () => {
    for (const cell of grid.flat()) expect(cell.band).toBe(bandOf(cell.profitCents));
  });

  it("marks a negative-profit cell as a loss", () => {
    const worst = grid[4]![4]!; // −15% price, 180 days
    expect(worst.profitCents).toBeLessThan(0);
    expect(worst.band).toBe("loss");
  });

  it("marks exactly one cell as the base: 0% at the 60 day column for a base of 62 days", () => {
    const flagged = grid.flat().filter((cell) => cell.isBase);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ priceDelta: 0, domDays: 60 });
    expect(grid[1]![1]!.isBase).toBe(true);
  });

  it("never loses profit as the price rises or the days on market fall", () => {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r]!.length; c++) {
        const cell = grid[r]![c]!;
        const cheaper = grid[r + 1]?.[c];
        const slower = grid[r]![c + 1];
        if (cheaper) expect(cell.profitCents).toBeGreaterThan(cheaper.profitCents);
        if (slower) expect(cell.profitCents).toBeGreaterThan(slower.profitCents);
      }
    }
  });

  it("holds the overrun at the base scenario's", () => {
    const over = sensitivityGrid(GOLDEN_DEAL, estimate, { ...base, overrunPct: 0.05 });
    const cell = over[2]![3]!; // −5%, 120 days
    expect(cell.profitCents).toBe(
      direct({ priceCents: roundCents(base.priceCents * 0.95), domDays: 120, overrunPct: 0.05 }),
    );
    expect(cell.profitCents).toBeLessThan(grid[2]![3]!.profitCents);
  });

  describe("base cell", () => {
    const baseCell = (domDays: number): { r: number; c: number }[] => {
      const g = sensitivityGrid(GOLDEN_DEAL, estimate, { ...base, domDays });
      const found: { r: number; c: number }[] = [];
      g.forEach((row, r) => row.forEach((cell, c) => cell.isBase && found.push({ r, c })));
      return found;
    };

    it.each([
      [0, 0],
      [30, 0],
      [44, 0],
      [60, 1],
      [74, 1],
      [76, 2],
      [90, 2],
      [106, 3],
      [151, 4],
      [180, 4],
      [400, 4],
    ])("for %i days is column %i of the 0% row", (domDays, column) => {
      expect(baseCell(domDays)).toEqual([{ r: 1, c: column }]);
    });

    it.each([
      [45, 0],
      [75, 1],
      [105, 2],
      [150, 3],
    ])("breaks a tie at %i days toward the lower column (%i)", (domDays, column) => {
      expect(baseCell(domDays)).toEqual([{ r: 1, c: column }]);
    });
  });
});
