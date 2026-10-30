import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SAMPLE_HOUSE, SAMPLE_LOT } from "./__fixtures__/sampleHouse";
import { compDomDays, estimateDom, fitSeasonalFactors, type DomEstimate } from "./dom";
import {
  DEFAULT_MARKET_SETTINGS,
  scoreComps,
  subjectFromDeal,
  type Comp,
  type MarketSettings,
  type ScoredComp,
} from "./market";
import type { Cents } from "./money";
import type { Result } from "./result";

const TODAY = "2026-10-30";
const M = DEFAULT_MARKET_SETTINGS;
const subject = subjectFromDeal(SAMPLE_HOUSE, SAMPLE_LOT);

/** A comp that matches the subject on every factor, so it scores 100 when it sold recently. */
const comp = (overrides: Partial<Comp> = {}): Comp => ({
  id: "comp-x",
  address: "1 Test St, Kaysville, UT",
  city: "Kaysville",
  county: "Davis",
  region: "utah-north",
  status: "sold",
  listDate: "2026-04-15",
  soldDate: "2026-06-15",
  soldPriceCents: 130_000_000,
  aboveGradeFinishedSf: 2200,
  basementFinishedSf: 1600,
  unfinishedSf: 0,
  beds: 5,
  baths: 4,
  yearBuilt: 2025,
  newConstruction: true,
  lotAcres: 0.33,
  garageBays: 3,
  basementFinish: "partial",
  walkout: false,
  adu: false,
  pool: false,
  source: "manual",
  verified: true,
  ...overrides,
});

/** The brief's three comps: days to contract 45 (Apr), 60 (Jul) and 84 (Feb, no contract date). */
const D1 = comp({ id: "D1", listDate: "2026-04-01", contractDate: "2026-05-16", soldDate: "2026-06-20" });
const D2 = comp({ id: "D2", listDate: "2026-07-01", contractDate: "2026-08-30", soldDate: "2026-10-01" });
const D3 = comp({ id: "D3", listDate: "2026-02-02", soldDate: "2026-06-01" });
const THREE = [D1, D2, D3];

const MID: Cents = 135_000_000;

const scoreAll = (comps: Comp[], selections: Record<string, boolean> = {}): ScoredComp[] =>
  scoreComps(subject, comps, M, selections, TODAY);

function unwrap(r: Result<DomEstimate>): DomEstimate {
  if (r.status !== "ok") throw new Error(`expected ok, got incomplete: ${JSON.stringify(r.missing)}`);
  return r.value;
}

const estimate = (
  scored: ScoredComp[],
  m: MarketSettings = M,
  listMonth = 5,
  planned: Cents | undefined = undefined,
): DomEstimate => unwrap(estimateDom(scored, m, listMonth, MID, planned, TODAY));

/** Wraps comps as already-included scored comps so a test can pick each weight directly. */
const included = (comps: Comp[], score = 100): ScoredComp[] => comps.map((c) => ({ comp: c, score, included: true }));

/** `YYYY-MM-DD` plus `n` days, in UTC. */
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A sold comp listed on `listDate` that went under contract `dom` days later. */
const withDom = (id: string, listDate: string, dom: number, soldDate = "2026-09-01"): Comp =>
  comp({ id, listDate, contractDate: addDays(listDate, dom), soldDate });

/** Same settings with every seasonal factor 1, so a test sees only the factor it varies. */
const FLAT: MarketSettings = { ...M, seasonalFactors: Array<number>(12).fill(1) };

describe("compDomDays", () => {
  it("counts list to contract when there is a contract date", () => {
    expect(compDomDays({ ...comp(), listDate: "2026-04-01", contractDate: "2026-05-16" }, M)).toBe(45);
  });

  it("falls back to sold − list − assumed closing days", () => {
    expect(
      compDomDays({ ...comp(), listDate: "2026-02-02", contractDate: undefined, soldDate: "2026-06-01" }, M),
    ).toBe(84);
  });

  it("uses the assumedClosingDays setting", () => {
    const c = { ...comp(), listDate: "2026-02-02", contractDate: undefined, soldDate: "2026-06-01" };
    expect(compDomDays(c, { ...M, assumedClosingDays: 21 })).toBe(98);
  });

  it("ignores the sold date and closing days when a contract date exists", () => {
    const c = { ...comp(), listDate: "2026-04-01", contractDate: "2026-05-16", soldDate: "2026-12-31" };
    expect(compDomDays(c, { ...M, assumedClosingDays: 90 })).toBe(45);
  });

  it("is null without a list date", () => {
    expect(compDomDays({ ...comp(), listDate: undefined }, M)).toBeNull();
    expect(compDomDays({ ...comp(), listDate: undefined, contractDate: "2026-05-16" }, M)).toBeNull();
  });

  it("is null when neither a contract date nor a sold date exists", () => {
    expect(compDomDays({ ...comp(), contractDate: undefined, soldDate: undefined }, M)).toBeNull();
  });

  it("is null when the dates are out of order", () => {
    expect(compDomDays({ ...comp(), listDate: "2026-05-16", contractDate: "2026-04-01" }, M)).toBeNull();
    // 20 days from list to sale cannot also hold 35 closing days.
    const c = { ...comp(), listDate: "2026-04-01", contractDate: undefined, soldDate: "2026-04-21" };
    expect(compDomDays(c, M)).toBeNull();
  });

  it("allows zero days: under contract the day it listed", () => {
    expect(compDomDays({ ...comp(), listDate: "2026-04-01", contractDate: "2026-04-01" }, M)).toBe(0);
    const c = { ...comp(), listDate: "2026-04-01", contractDate: undefined, soldDate: "2026-05-06" };
    expect(compDomDays(c, M)).toBe(0);
  });
});

describe("estimateDom", () => {
  it("gives the brief's low / typical / high for three perfect comps", () => {
    expect(scoreAll(THREE).map((s) => s.score)).toEqual([100, 100, 100]);
    const d = estimate(scoreAll(THREE));
    // domAdj = 45 / 0.9, 60 / 1.0, 84 / 1.1 = 50, 60, 76.4; all × 0.9 for a May listing.
    expect([d.lowDays, d.typicalDays, d.highDays]).toEqual([45, 54, 69]);
    expect(d.confidence).toBe("low");
    expect(d.compCount).toBe(3);
    expect(d.recentCount).toBe(3);
    expect(d.factors).toEqual({ seasonal: 0.9, pricePosition: 1, condition: 1 });
  });

  it("explains each factor in order, with its effect on the typical days", () => {
    const d = estimate(scoreAll(THREE));
    expect(d.explain).toEqual([
      { label: "Comps median (3 comps)", effect: "60 days" },
      { label: "Season (May, ×0.90)", effect: "−10% → 54 days" },
      { label: "Price position (no planned list price)", effect: "no change → 54 days" },
      { label: "Market condition (normal)", effect: "no change → 54 days" },
    ]);
  });

  it("raises the days when the planned list price sits above the mid", () => {
    const d = estimate(scoreAll(THREE), M, 5, Math.round(MID * 1.02));
    // 1 + 3.0 × 0.02 = 1.06 → 60 × 0.9 × 1.06 = 57.24
    expect(d.typicalDays).toBe(57);
    expect([d.lowDays, d.highDays]).toEqual([48, 73]);
    expect(d.factors.pricePosition).toBeCloseTo(1.06, 12);
    expect(d.explain[2]).toEqual({ label: "Price position (2% over mid)", effect: "+6% → 57 days" });
  });

  it("does not lower the days when the planned list price is below the mid", () => {
    const d = estimate(scoreAll(THREE), M, 5, Math.round(MID * 0.9));
    expect(d.factors.pricePosition).toBe(1);
    expect(d.typicalDays).toBe(54);
    expect(d.explain[2]?.effect).toBe("no change → 54 days");
  });

  it("scales by the market condition", () => {
    const slow = estimate(scoreAll(THREE), { ...M, marketCondition: "slow" });
    expect(slow.typicalDays).toBe(65); // 60 × 0.9 × 1.2 = 64.8
    expect(slow.factors.condition).toBe(1.2);
    expect(slow.explain[3]).toEqual({ label: "Market condition (slow)", effect: "+20% → 65 days" });
    const hot = estimate(scoreAll(THREE), { ...M, marketCondition: "hot" });
    expect(hot.typicalDays).toBe(46); // 60 × 0.9 × 0.85 = 45.9
    expect(hot.explain[3]).toEqual({ label: "Market condition (hot)", effect: "−15% → 46 days" });
  });

  it("uses the subject's list month for the seasonal factor", () => {
    expect(estimate(scoreAll(THREE), M, 12).factors.seasonal).toBe(1.2);
    expect(estimate(scoreAll(THREE), M, 1).typicalDays).toBe(72); // 60 × 1.2
    expect(estimate(scoreAll(THREE), M, 12).explain[1]?.label).toBe("Season (December, ×1.20)");
  });

  it("de-seasonalizes each comp by its own list month", () => {
    const january = [withDom("jan", "2026-01-10", 60)];
    // 60 days in January (×1.2) is 50 days in a neutral month.
    expect(estimate(included(january), M, 7).typicalDays).toBe(50);
    // The same comp in a flat-season market stays 60.
    expect(estimate(included(january), FLAT, 7).typicalDays).toBe(60);
  });

  it("weights the percentiles by similarity score", () => {
    const comps = [withDom("a", "2026-07-01", 30), withDom("b", "2026-07-01", 60), withDom("c", "2026-07-01", 90)];
    const scored: ScoredComp[] = [
      { comp: comps[0]!, score: 2, included: true },
      { comp: comps[1]!, score: 2, included: true },
      { comp: comps[2]!, score: 8, included: true },
    ];
    const d = estimate(scored, FLAT, 7);
    // Total weight 12: the 25th percentile needs 3 (cumulative 2, 4 → 60); the median and 75th need 6 and 9 → 90.
    expect([d.lowDays, d.typicalDays, d.highDays]).toEqual([60, 90, 90]);
    // Equal weights would put the median at 60.
    expect(estimate(included(comps), FLAT, 7).typicalDays).toBe(60);
  });

  it("uses only included comps", () => {
    const d = estimate(scoreAll(THREE, { D3: false }));
    expect(d.compCount).toBe(2);
    expect([d.lowDays, d.typicalDays, d.highDays]).toEqual([45, 45, 54]); // domAdj 50 and 60, × 0.9
    const out = scoreAll(THREE).map((s) => (s.comp.id === "D3" ? { ...s, included: false } : s));
    expect(estimate(out).compCount).toBe(2);
  });

  it("ignores comps that are not sold", () => {
    const active = comp({ id: "act", status: "active", listDate: "2026-07-01", contractDate: "2026-12-01" });
    const pending = comp({ id: "pen", status: "pending", listDate: "2026-07-01", contractDate: "2026-07-05" });
    const d = estimate([...included(THREE), ...included([active, pending])]);
    expect(d.compCount).toBe(3);
    expect([d.lowDays, d.typicalDays, d.highDays]).toEqual([45, 54, 69]);
  });

  it("ignores comps whose days on market cannot be known", () => {
    const noList = comp({ id: "nl", listDate: undefined });
    const backwards = comp({ id: "bw", listDate: "2026-05-16", contractDate: "2026-04-01" });
    const noDates = comp({ id: "nd", contractDate: undefined, soldDate: undefined });
    const d = estimate(included([...THREE, noList, backwards, noDates]));
    expect(d.compCount).toBe(3);
    expect([d.lowDays, d.typicalDays, d.highDays]).toEqual([45, 54, 69]);
  });

  it("rounds half days away from zero", () => {
    // 9 days × 0.5 = 4.5 → 5 (half away from zero, not to even).
    const halved: MarketSettings = { ...FLAT, conditionFactors: { ...M.conditionFactors, normal: 0.5 } };
    const d = estimate(included([withDom("nine", "2026-04-01", 9)]), halved);
    expect([d.lowDays, d.typicalDays, d.highDays]).toEqual([5, 5, 5]);
  });

  describe("confidence and counts", () => {
    /** `n` comps, `recent` of them sold within six months of TODAY (the rest a year ago). */
    const mixed = (n: number, recent: number): ScoredComp[] =>
      included(
        Array.from({ length: n }, (_, i) =>
          withDom(`c${i}`, "2025-06-01", 40 + i, i < recent ? "2026-08-01" : "2025-09-01"),
        ),
      );

    it("is high with 10 comps and 5 sold in the last six months", () => {
      const d = estimate(mixed(10, 5));
      expect(d.confidence).toBe("high");
      expect(d.compCount).toBe(10);
      expect(d.recentCount).toBe(5);
    });

    it("is medium with 10 comps but only 4 recent", () => {
      expect(estimate(mixed(10, 4)).confidence).toBe("medium");
    });

    it("is medium with 9 comps even when all are recent", () => {
      expect(estimate(mixed(9, 9)).confidence).toBe("medium");
    });

    it("is medium with 5 comps and low with 4", () => {
      expect(estimate(mixed(5, 5)).confidence).toBe("medium");
      expect(estimate(mixed(4, 4)).confidence).toBe("low");
    });

    it("counts a sale as recent up to six months back, by the same rule as the recency score", () => {
      // 6 months = 182.5 days: 182 days back is recent, 183 is not.
      const one = (soldDate: string | undefined): DomEstimate =>
        estimate(included([{ ...withDom("s", "2026-01-01", 30), soldDate }]));
      expect(one(addDays(TODAY, -182)).recentCount).toBe(1);
      expect(one(addDays(TODAY, -183)).recentCount).toBe(0);
      expect(one(undefined).recentCount).toBe(0);
    });

    it("counts only the comps behind the estimate", () => {
      const noList = comp({ id: "nl", listDate: undefined });
      const d = estimate([...mixed(5, 5), ...included([noList])]);
      expect(d.compCount).toBe(5);
      expect(d.recentCount).toBe(5);
    });
  });

  describe("without usable comps", () => {
    const expectNoDomComps = (r: Result<DomEstimate>): void => {
      expect(r.status).toBe("incomplete");
      if (r.status !== "incomplete") return;
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]?.code).toBe("noDomComps");
      expect(r.missing[0]?.step).toBe("market");
    };

    it("is incomplete with no comps at all", () => {
      expectNoDomComps(estimateDom([], M, 5, MID, undefined, TODAY));
    });

    it("is incomplete when every comp is excluded", () => {
      const scored = scoreAll(THREE, { D1: false, D2: false, D3: false });
      expectNoDomComps(estimateDom(scored, M, 5, MID, undefined, TODAY));
    });

    it("is incomplete when no included sold comp has days on market", () => {
      const active = comp({ id: "act", status: "active" });
      const noList = comp({ id: "nl", listDate: undefined });
      expectNoDomComps(estimateDom(included([active, noList]), M, 5, MID, undefined, TODAY));
    });
  });

  describe("invalid inputs", () => {
    it("is incomplete when a planned price needs a mid that is not positive", () => {
      const r = estimateDom(scoreAll(THREE), M, 5, 0, 135_000_000, TODAY);
      expect(r.status).toBe("incomplete");
      if (r.status === "incomplete") expect(r.missing[0]?.step).toBe("market");
      // Without a planned price the mid is not needed.
      expect(estimateDom(scoreAll(THREE), M, 5, 0, undefined, TODAY).status).toBe("ok");
    });

    it("throws on a list month outside 1 to 12", () => {
      for (const month of [0, 13, 5.5, Number.NaN]) {
        expect(() => estimateDom(scoreAll(THREE), M, month, MID, undefined, TODAY)).toThrow(RangeError);
      }
    });

    it("throws when the seasonal curve cannot be divided by", () => {
      const short = { ...M, seasonalFactors: [1, 1, 1] };
      expect(() => estimateDom(scoreAll(THREE), short, 1, MID, undefined, TODAY)).toThrow(RangeError);
      const zero = { ...M, seasonalFactors: M.seasonalFactors.map((f, i) => (i === 3 ? 0 : f)) };
      expect(() => estimateDom(scoreAll(THREE), zero, 5, MID, undefined, TODAY)).toThrow(RangeError);
    });
  });

  it("keeps low ≤ typical ≤ high, in whole days (property)", () => {
    const entry = fc.record({
      dom: fc.integer({ min: 0, max: 400 }),
      month: fc.integer({ min: 1, max: 12 }),
      score: fc.integer({ min: 0, max: 100 }),
    });
    fc.assert(
      fc.property(
        fc.array(entry, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 12 }),
        fc.option(fc.integer({ min: 100_000_000, max: 200_000_000 }), { nil: undefined }),
        fc.constantFrom<MarketSettings["marketCondition"]>("hot", "normal", "slow"),
        (entries, listMonth, planned, marketCondition) => {
          const scored = entries.map(
            (e, i): ScoredComp => ({
              comp: withDom(`p${i}`, `2026-${String(e.month).padStart(2, "0")}-01`, e.dom),
              score: e.score,
              included: true,
            }),
          );
          const d = estimate(scored, { ...M, marketCondition }, listMonth, planned);
          expect(Number.isInteger(d.lowDays) && Number.isInteger(d.typicalDays) && Number.isInteger(d.highDays)).toBe(true);
          expect(d.lowDays).toBeLessThanOrEqual(d.typicalDays);
          expect(d.typicalDays).toBeLessThanOrEqual(d.highDays);
          expect(d.compCount).toBe(entries.length);
        },
      ),
    );
  });
});

describe("fitSeasonalFactors", () => {
  /** `perMonth` comps for each of `months` (1-based), each with `dom(month)` days to contract. */
  const fitComps = (months: number[], perMonth: number, dom: (month: number) => number): Comp[] =>
    months.flatMap((month) =>
      Array.from({ length: perMonth }, (_, i) =>
        // Alternate years so the same calendar month pools across years.
        withDom(`m${month}-${i}`, `${i % 2 === 0 ? 2026 : 2025}-${String(month).padStart(2, "0")}-05`, dom(month)),
      ),
    );

  const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const JAN_SLOW = (month: number): number => (month === 1 ? 90 : 60);

  it("fits the brief's curve: slow January, flat otherwise, smoothed around the year", () => {
    const f = fitSeasonalFactors(fitComps(range(1, 9), 3, JAN_SLOW), M);
    expect(f).not.toBeNull();
    expect(f).toHaveLength(12);
    expect(f?.[0]).toBe(1.17); // (Dec 1.0 + Jan 1.5 + Feb 1.0) / 3
    expect(f?.[1]).toBe(1.17); // (Jan 1.5 + Feb 1.0 + Mar 1.0) / 3
    expect(f?.[2]).toBe(1);
    expect(f?.[11]).toBe(1.17); // wraps: (Nov 1.0 + Dec 1.0 + Jan 1.5) / 3
    expect(f).toEqual([1.17, 1.17, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.17]);
  });

  it("is null with fewer than nine list months", () => {
    expect(fitSeasonalFactors(fitComps(range(1, 8), 3, JAN_SLOW), M)).toBeNull();
  });

  // Exactly 24 comps over nine months: three each in Jan–Jun, two each in Jul–Sep.
  const exactly24 = [...fitComps(range(1, 6), 3, JAN_SLOW), ...fitComps(range(7, 9), 2, JAN_SLOW)];

  it("needs 24 usable comps and no fewer", () => {
    expect(fitSeasonalFactors(exactly24, M)).not.toBeNull();
    // Dropping the last comp leaves 23 comps, still across nine months.
    expect(fitSeasonalFactors(exactly24.slice(0, 23), M)).toBeNull();
  });

  it("counts only sold comps with days on market and a list date", () => {
    const all = fitComps(range(1, 9), 3, JAN_SLOW); // 27 usable
    const unusable = [
      comp({ id: "n1", status: "active", listDate: "2026-10-01", contractDate: "2026-10-20" }),
      comp({ id: "n2", status: "pending", listDate: "2026-11-01", contractDate: "2026-11-20" }),
      comp({ id: "n3", listDate: undefined, soldDate: "2026-09-01" }),
      comp({ id: "n4", listDate: "2026-12-01", contractDate: "2026-11-01" }), // dates out of order
    ];
    // Unusable comps change neither the counts nor the curve.
    expect(fitSeasonalFactors([...all, ...unusable], M)).toEqual(fitSeasonalFactors(all, M));
    expect(fitSeasonalFactors([...exactly24, ...unusable], M)).not.toBeNull();
    expect(fitSeasonalFactors([...exactly24.slice(0, 23), ...unusable], M)).toBeNull();
    // They do not add list months either: eight real months plus Oct–Dec noise is still too few.
    expect(fitSeasonalFactors([...fitComps(range(1, 8), 4, JAN_SLOW), ...unusable], M)).toBeNull();
  });

  it("takes the mean of the two middle values for an even-sized median", () => {
    // January has DOM 40 and 80 (median 60); every other month is 60, so the whole curve is flat.
    const rest = fitComps(range(2, 9), 3, () => 60);
    const jan = [withDom("j1", "2026-01-05", 40), withDom("j2", "2026-01-06", 80)];
    expect(fitSeasonalFactors([...jan, ...rest], M)).toEqual(Array<number>(12).fill(1));
  });

  it("measures each month against the overall median", () => {
    // Overall median is 30 (more than half the comps); the three August comps at 45 → 1.5.
    const quick = fitComps([1, 2, 3, 4, 5, 6, 7, 9, 10], 3, () => 30);
    const slowAug = fitComps([8], 3, () => 45);
    const f = fitSeasonalFactors([...quick, ...slowAug], M);
    expect(f).toEqual([1, 1, 1, 1, 1, 1, 1.17, 1.17, 1.17, 1, 1, 1]);
  });

  it("is null when the overall median is zero", () => {
    expect(fitSeasonalFactors(fitComps(range(1, 9), 3, () => 0), M)).toBeNull();
  });

  it("rounds to two decimals", () => {
    // Overall median 60; July at 70 → raw 1.1667. June, July and August each smooth to 1.0556 → 1.06.
    const f = fitSeasonalFactors(fitComps(range(1, 9), 3, (m) => (m === 7 ? 70 : 60)), M);
    expect(f?.[5]).toBe(1.06);
    expect(f?.[6]).toBe(1.06);
    expect(f?.[7]).toBe(1.06);
  });
});
