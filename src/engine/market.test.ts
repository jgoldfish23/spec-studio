import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOLDEN_COMPS } from "./__fixtures__/golden";
import { SAMPLE_HOUSE, SAMPLE_LOT } from "./__fixtures__/sampleHouse";
import type { HouseModel } from "./house";
import {
  DEFAULT_MARKET_SETTINGS,
  effectiveSf,
  estimatePrice,
  scoreComps,
  similarity,
  subjectFromDeal,
  weightedPercentile,
  type Comp,
  type MarketSettings,
  type PriceEstimate,
  type Subject,
} from "./market";
import { roundCents } from "./money";
import type { Result } from "./result";

const TODAY = "2026-10-30";
const S = DEFAULT_MARKET_SETTINGS;
const subject = subjectFromDeal(SAMPLE_HOUSE, SAMPLE_LOT);

/** Comp A of the brief: matches the subject on every factor, so it scores 100. */
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

const compA = comp({ id: "A" });
const compB = comp({
  id: "B",
  city: "Layton",
  aboveGradeFinishedSf: 2400,
  basementFinishedSf: 1000,
  yearBuilt: 2018,
  soldDate: "2026-01-10",
  soldPriceCents: 120_000_000,
  garageBays: 2,
  walkout: true,
});

const score = (overrides: Partial<Comp>, s: Subject = subject, m: MarketSettings = S): number =>
  similarity(s, comp(overrides), m, TODAY);

function unwrap(r: Result<PriceEstimate>): PriceEstimate {
  if (r.status !== "ok") throw new Error(`expected ok, got incomplete: ${JSON.stringify(r.missing)}`);
  return r.value;
}

const estimateFor = (comps: Comp[], selections: Record<string, boolean> = {}): PriceEstimate =>
  unwrap(estimatePrice(subject, scoreComps(subject, comps, S, selections, TODAY), S));

const houseClone = (): HouseModel => structuredClone(SAMPLE_HOUSE);

describe("DEFAULT_MARKET_SETTINGS", () => {
  it("carries the spec starting values", () => {
    expect(S).toEqual({
      region: "utah-north",
      basementFactor: 0.6,
      featureValues: {
        garageBayCents: 1_200_000,
        walkoutCents: 900_000,
        lotPerAcreCents: 6_000_000,
        aduCents: 3_500_000,
        poolCents: 2_500_000,
      },
      similarityWeights: { location: 25, size: 25, age: 15, recency: 20, features: 15 },
      includeThreshold: 75,
      seasonalFactors: [1.2, 1.1, 0.95, 0.9, 0.9, 0.95, 1.0, 1.0, 1.05, 1.1, 1.15, 1.2],
      elasticity: 3.0,
      marketCondition: "normal",
      conditionFactors: { hot: 0.85, normal: 1.0, slow: 1.2 },
      assumedClosingDays: 35,
      defaultTaxRate: 0.0048,
    });
  });

  it("has weights that add up to 100 points", () => {
    const w = S.similarityWeights;
    expect(w.location + w.size + w.age + w.recency + w.features).toBe(100);
  });
});

describe("effectiveSf", () => {
  it("adds the basement at its factor", () => {
    expect(effectiveSf(2200, 1600, 0.6)).toBeCloseTo(3160, 9);
    expect(effectiveSf(2200, 0, 0.6)).toBe(2200);
    expect(effectiveSf(0, 1000, 0.5)).toBe(500);
  });
});

describe("subjectFromDeal", () => {
  it("reads the sample house and lot", () => {
    expect(subject).toEqual({
      city: "Kaysville",
      county: "Davis",
      region: "utah-north",
      aboveGradeFinishedSf: 2200,
      basementFinishedSf: 1600,
      garageBays: 3,
      basementFinish: "partial",
      walkout: false,
      adu: false,
      pool: false,
      lotAcres: 0.33,
    });
  });

  it("adds upper-level finished area to above-grade", () => {
    const h = houseClone();
    h.levels.upper = { finishedSf: 1800, unfinishedSf: 200, ceilingFt: 9 };
    expect(subjectFromDeal(h, SAMPLE_LOT).aboveGradeFinishedSf).toBe(4000);
  });

  it("classifies the basement finish", () => {
    const none = houseClone();
    delete none.levels.basement;
    expect(subjectFromDeal(none, SAMPLE_LOT)).toMatchObject({
      basementFinish: "none",
      basementFinishedSf: 0,
      walkout: false,
    });

    const finished = houseClone();
    finished.levels.basement = { totalSf: 2200, finishedSf: 2200, walkout: true };
    expect(subjectFromDeal(finished, SAMPLE_LOT)).toMatchObject({
      basementFinish: "finished",
      basementFinishedSf: 2200,
      walkout: true,
    });

    const unfinished = houseClone();
    unfinished.levels.basement = { totalSf: 2200, finishedSf: 0, walkout: false };
    expect(subjectFromDeal(unfinished, SAMPLE_LOT)).toMatchObject({
      basementFinish: "unfinished",
      basementFinishedSf: 0,
    });
  });

  it("flags an ADU or a pool of any type", () => {
    const h = houseClone();
    h.adu = { type: "detached" };
    h.pool = { type: "gunite", spa: false, heated: true };
    const s = subjectFromDeal(h, SAMPLE_LOT);
    expect(s.adu).toBe(true);
    expect(s.pool).toBe(true);
    h.adu = { type: "basement" };
    expect(subjectFromDeal(h, SAMPLE_LOT).adu).toBe(true);
  });

  it("takes bays from the garage and acres from the lot", () => {
    const h = houseClone();
    h.garage = { bays: 4, tandem: false, rvBay: false };
    expect(subjectFromDeal(h, { ...SAMPLE_LOT, acres: 1.25 })).toMatchObject({ garageBays: 4, lotAcres: 1.25 });
  });
});

describe("similarity", () => {
  it("scores a comp that matches on every factor 100 (comp A)", () => {
    expect(similarity(subject, compA, S, TODAY)).toBeCloseTo(100, 6);
  });

  it("scores comp B 68.78: county match, 5% smaller, 8 years old, 9.6 months ago, 3 of 5 features", () => {
    expect(similarity(subject, compB, S, TODAY)).toBeCloseTo(68.78, 2);
  });

  describe("location", () => {
    it("scores same city 1.0, same county 0.7, same region 0.4, otherwise 0", () => {
      expect(score({ city: "Kaysville" })).toBeCloseTo(100, 9);
      expect(score({ city: "Layton" })).toBeCloseTo(100 - 25 * 0.3, 9);
      expect(score({ city: "Ogden", county: "Weber" })).toBeCloseTo(100 - 25 * 0.6, 9);
      expect(score({ city: "Provo", county: "Utah", region: "utah-south" })).toBeCloseTo(100 - 25, 9);
    });

    it("compares case-insensitively and ignores surrounding spaces", () => {
      expect(score({ city: "  kaysVILLE " })).toBeCloseTo(100, 9);
      expect(score({ city: "Layton", county: " DAVIS " })).toBeCloseTo(92.5, 9);
      expect(score({ city: "Ogden", county: "Weber", region: " Utah-North" })).toBeCloseTo(85, 9);
    });
  });

  describe("size", () => {
    it("falls off linearly with the effective-sf gap, as a share of 30% of the subject", () => {
      // Subject effective sf is 3160, so 30% is 948 sf.
      expect(score({ aboveGradeFinishedSf: 2200 + 474 })).toBeCloseTo(100 - 25 * 0.5, 9);
      expect(score({ aboveGradeFinishedSf: 2200 - 474 })).toBeCloseTo(100 - 25 * 0.5, 9);
    });

    it("counts basement sf at the basement factor", () => {
      // 1000 more basement sf is 600 effective sf.
      expect(score({ basementFinishedSf: 2600 })).toBeCloseTo(100 - 25 * (600 / 948), 9);
    });

    it("is zero at a 30% gap and never negative beyond it", () => {
      expect(score({ aboveGradeFinishedSf: 2200 + 948 })).toBeCloseTo(75, 9);
      expect(score({ aboveGradeFinishedSf: 6000 })).toBeCloseTo(75, 9);
      expect(score({ aboveGradeFinishedSf: 100, basementFinishedSf: 0 })).toBeCloseTo(75, 9);
    });

    it("does not divide by zero when the subject has no finished area", () => {
      const empty: Subject = { ...subject, aboveGradeFinishedSf: 0, basementFinishedSf: 0 };
      const same = score({ aboveGradeFinishedSf: 0, basementFinishedSf: 0 }, empty);
      const other = score({}, empty);
      expect(Number.isFinite(same)).toBe(true);
      expect(Number.isFinite(other)).toBe(true);
      expect(same - other).toBeCloseTo(25, 9);
    });
  });

  describe("age", () => {
    it("scores 1.0 when sold within 3 years of being built, else 0.5", () => {
      expect(score({ yearBuilt: 2023 })).toBeCloseTo(100, 9); // 3 years
      expect(score({ yearBuilt: 2022 })).toBeCloseTo(100 - 15 * 0.5, 9); // 4 years
      expect(score({ yearBuilt: 2026 })).toBeCloseTo(100, 9); // built the year it sold
    });

    it("uses the year of the sold date, not of today", () => {
      expect(score({ yearBuilt: 2018, soldDate: "2021-06-15" })).toBeCloseTo(100 - 20 * 0.6, 9);
    });

    it("uses today's year for a comp that has not sold", () => {
      const active = { status: "active", soldDate: undefined, soldPriceCents: undefined } as const;
      expect(score({ ...active, yearBuilt: 2023 })).toBeCloseTo(100, 9);
      expect(score({ ...active, yearBuilt: 2022 })).toBeCloseTo(92.5, 9);
    });
  });

  describe("recency", () => {
    it("scores 1.0 up to 6 months, 0.7 up to 12 months, 0.4 beyond", () => {
      expect(score({ soldDate: "2026-05-01" })).toBeCloseTo(100, 9); // 182 days
      expect(score({ soldDate: "2026-04-30" })).toBeCloseTo(100 - 20 * 0.3, 9); // 183 days
      expect(score({ soldDate: "2025-10-30" })).toBeCloseTo(100 - 20 * 0.3, 9); // 365 days = 12 months
      expect(score({ soldDate: "2025-10-29" })).toBeCloseTo(100 - 20 * 0.6, 9); // 366 days
    });

    it("scores a comp that has not sold as 1.0", () => {
      const active = { status: "active", soldDate: undefined, soldPriceCents: undefined } as const;
      expect(score({ ...active })).toBeCloseTo(100, 9);
    });
  });

  describe("features", () => {
    it("gives each of garage bays, basement finish, walkout, ADU and pool 3 of the 15 points", () => {
      expect(score({ garageBays: 2 })).toBeCloseTo(97, 9);
      expect(score({ basementFinish: "finished" })).toBeCloseTo(97, 9);
      expect(score({ walkout: true })).toBeCloseTo(97, 9);
      expect(score({ adu: true })).toBeCloseTo(97, 9);
      expect(score({ pool: true })).toBeCloseTo(97, 9);
      expect(score({ garageBays: 4, basementFinish: "none", walkout: true, adu: true, pool: true })).toBeCloseTo(85, 9);
    });
  });

  it("follows the weights in the settings", () => {
    const m: MarketSettings = {
      ...S,
      similarityWeights: { location: 40, size: 10, age: 10, recency: 20, features: 20 },
    };
    expect(similarity(subject, comp({ city: "Layton" }), m, TODAY)).toBeCloseTo(100 - 40 * 0.3, 9);
  });
});

describe("scoreComps", () => {
  it("sorts by score, highest first, and includes comps at or above the threshold", () => {
    const scored = scoreComps(subject, [compB, compA], S, {}, TODAY);
    expect(scored.map((s) => s.comp.id)).toEqual(["A", "B"]);
    expect(scored[0]!.score).toBeCloseTo(100, 6);
    expect(scored[1]!.score).toBeCloseTo(68.78, 2);
    expect(scored.map((s) => s.included)).toEqual([true, false]);
  });

  it("includes a comp that scores exactly the threshold", () => {
    const [only] = scoreComps(subject, [compA], { ...S, includeThreshold: 100 }, {}, TODAY);
    expect(only!.included).toBe(true);
    const [above] = scoreComps(subject, [compA], { ...S, includeThreshold: 100.001 }, {}, TODAY);
    expect(above!.included).toBe(false);
  });

  it("lets the owner include a low scorer or exclude a high scorer", () => {
    const scored = scoreComps(subject, [compA, compB], S, { B: true, A: false }, TODAY);
    expect(scored.find((s) => s.comp.id === "B")!.included).toBe(true);
    expect(scored.find((s) => s.comp.id === "A")!.included).toBe(false);
  });

  it("ignores selections for other ids, including names that exist on every object", () => {
    const odd = comp({ id: "constructor" });
    const scored = scoreComps(subject, [odd, compB], S, { elsewhere: false }, TODAY);
    expect(scored.map((s) => s.included)).toEqual([true, false]);
  });

  it("keeps input order among equal scores", () => {
    const scored = scoreComps(subject, [comp({ id: "first" }), comp({ id: "second" }), comp({ id: "third" })], S, {}, TODAY);
    expect(scored.map((s) => s.comp.id)).toEqual(["first", "second", "third"]);
  });

  it("returns an empty list for no comps", () => {
    expect(scoreComps(subject, [], S, {}, TODAY)).toEqual([]);
  });
});

describe("weightedPercentile", () => {
  const sample = [
    { value: 10, weight: 1 },
    { value: 20, weight: 1 },
    { value: 30, weight: 2 },
  ];

  it("takes the first value whose cumulative weight reaches p of the total", () => {
    expect(weightedPercentile(sample, 0.5)).toBe(20);
    expect(weightedPercentile(sample, 0.25)).toBe(10);
    expect(weightedPercentile(sample, 0.75)).toBe(30);
    expect(weightedPercentile(sample, 0)).toBe(10);
    expect(weightedPercentile(sample, 1)).toBe(30);
  });

  it("sorts by value, not input order, and leaves the input alone", () => {
    const shuffled = [sample[2]!, sample[0]!, sample[1]!];
    expect(weightedPercentile(shuffled, 0.5)).toBe(20);
    expect(shuffled.map((x) => x.value)).toEqual([30, 10, 20]);
  });

  it("returns the only value of a single-item list", () => {
    expect(weightedPercentile([{ value: 7, weight: 3 }], 0.25)).toBe(7);
  });

  it("is not thrown off by float error in the cumulative weight", () => {
    // Six equal weights: the sum of three of them lands one ulp below half of the sum of six.
    const w = 58.521017608069926;
    const six = [1, 2, 3, 4, 5, 6].map((value) => ({ value, weight: w }));
    expect(weightedPercentile(six, 0.5)).toBe(3);
  });

  it("throws on an empty list", () => {
    expect(() => weightedPercentile([], 0.5)).toThrow(RangeError);
  });

  it("throws when p is outside 0 to 1", () => {
    expect(() => weightedPercentile(sample, -0.1)).toThrow(RangeError);
    expect(() => weightedPercentile(sample, 1.1)).toThrow(RangeError);
    expect(() => weightedPercentile(sample, Number.NaN)).toThrow(RangeError);
  });

  const arbItems = fc.array(
    fc.record({ value: fc.integer({ min: -1000, max: 1000 }), weight: fc.double({ min: 0.1, max: 100, noNaN: true }) }),
    { minLength: 1, maxLength: 12 },
  );

  it("always returns one of the values and never decreases as p grows (property)", () => {
    fc.assert(
      fc.property(arbItems, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (items, a, b) => {
        const [p1, p2] = a <= b ? [a, b] : [b, a];
        const r1 = weightedPercentile(items, p1);
        const r2 = weightedPercentile(items, p2);
        expect(items.map((x) => x.value)).toContain(r1);
        expect(r1).toBeLessThanOrEqual(r2);
      }),
    );
  });
});

describe("estimatePrice", () => {
  // Three Kaysville comps (built 2025, sold within 6 months, every feature matching, same lot size).
  const c1 = comp({ id: "C1", soldPriceCents: 126_400_000 }); // 2200 + 1600 -> 3160 effective
  const c2 = comp({ id: "C2", aboveGradeFinishedSf: 2000, basementFinishedSf: 1000, soldPriceCents: 106_600_000 }); // 2600
  const c3 = comp({ id: "C3", aboveGradeFinishedSf: 2500, basementFinishedSf: 1500, soldPriceCents: 129_200_000 }); // 3400

  it("takes the similarity-weighted 25th, 50th and 75th percentile of implied values", () => {
    // Implied: C3 120,080,000 (weight 93.7), C1 126,400,000 (100), C2 129,560,000 (85.2).
    const est = estimateFor([c1, c2, c3]);
    expect([est.lowCents, est.midCents, est.highCents]).toEqual([120_080_000, 126_400_000, 129_560_000]);
    expect(est.midPerEffectiveSfCents).toBe(40_000);
  });

  it("reports each comp's adjusted price, implied value and weight (its score)", () => {
    const est = estimateFor([c1, c2, c3]);
    expect(est.comps.map((c) => c.id)).toEqual(["C1", "C3", "C2"]); // score order
    const byId = Object.fromEntries(est.comps.map((c) => [c.id, c]));
    expect(byId["C1"]).toMatchObject({ adjustedCents: 126_400_000, impliedCents: 126_400_000, weight: 100 });
    expect(byId["C2"]).toMatchObject({ adjustedCents: 106_600_000, impliedCents: 129_560_000 });
    expect(byId["C2"]!.weight).toBeCloseTo(25 * (1 - 560 / 948) + 75, 9);
    expect(byId["C3"]).toMatchObject({ adjustedCents: 129_200_000, impliedCents: 120_080_000 });
    expect(byId["C3"]!.weight).toBeCloseTo(25 * (1 - 240 / 948) + 75, 9);
  });

  it("collapses to one value when only one comp is included", () => {
    const est = estimateFor([c1, c2, c3], { C2: false, C3: false });
    expect([est.lowCents, est.midCents, est.highCents]).toEqual([126_400_000, 126_400_000, 126_400_000]);
    expect(est.comps.map((c) => c.id)).toEqual(["C1"]);
  });

  it("uses a low-scoring comp the owner included, and leaves it out otherwise", () => {
    // B: garage 2 (+$12,000), walkout (-$9,000) -> adjusted $1,203,000; 3000 effective sf.
    const without = estimateFor([compA, compB]);
    expect(without.comps.map((c) => c.id)).toEqual(["A"]);
    expect(without.highCents).toBe(130_000_000);

    const withB = estimateFor([compA, compB], { [compB.id]: true });
    expect(withB.comps.map((c) => c.id)).toEqual(["A", "B"]);
    expect(withB.comps[1]).toMatchObject({ adjustedCents: 120_300_000, impliedCents: 126_716_000 });
    expect(withB.comps[1]!.weight).toBeCloseTo(68.78, 2);
    // B's implied value is lower; its weight 68.78 of 168.78 reaches p = 0.25 but not 0.5.
    expect([withB.lowCents, withB.midCents, withB.highCents]).toEqual([126_716_000, 130_000_000, 130_000_000]);
  });

  describe("adjustment toward the subject", () => {
    // Priced so the comp has the subject's effective sf: implied == adjusted.
    const adjusted = (overrides: Partial<Comp>): number => {
      const est = estimateFor([comp({ id: "adj", soldPriceCents: 100_000_000, ...overrides })], { adj: true });
      return est.comps[0]!.adjustedCents;
    };

    it("adds (subject - comp) x value for each feature", () => {
      // Comp: garage 2 (+12,000), walkout (-9,000), pool (-25,000), lot 0.25 (+0.08 x 60,000 = +4,800).
      expect(adjusted({ garageBays: 2, walkout: true, lotAcres: 0.25, pool: true })).toBe(100_000_000 - 1_720_000);
    });

    it("adjusts each feature on its own", () => {
      expect(adjusted({ garageBays: 2 })).toBe(100_000_000 + 1_200_000);
      expect(adjusted({ garageBays: 5 })).toBe(100_000_000 - 2_400_000);
      expect(adjusted({ walkout: true })).toBe(100_000_000 - 900_000);
      expect(adjusted({ adu: true })).toBe(100_000_000 - 3_500_000);
      expect(adjusted({ pool: true })).toBe(100_000_000 - 2_500_000);
      expect(adjusted({ lotAcres: 0.25 })).toBe(100_000_000 + 480_000);
      expect(adjusted({ lotAcres: 0.5 })).toBe(100_000_000 - 1_020_000);
    });

    it("adds value for a feature the subject has and the comp lacks", () => {
      const withAdu: Subject = { ...subject, adu: true, walkout: true, pool: true };
      const scored = scoreComps(withAdu, [comp({ id: "adj", soldPriceCents: 100_000_000 })], S, { adj: true }, TODAY);
      const est = unwrap(estimatePrice(withAdu, scored, S));
      expect(est.comps[0]!.adjustedCents).toBe(100_000_000 + 3_500_000 + 900_000 + 2_500_000);
    });

    it("follows the feature values in the settings", () => {
      const m: MarketSettings = { ...S, featureValues: { ...S.featureValues, garageBayCents: 2_000_000 } };
      const scored = scoreComps(subject, [comp({ id: "adj", garageBays: 2 })], m, { adj: true }, TODAY);
      expect(unwrap(estimatePrice(subject, scored, m)).comps[0]!.adjustedCents).toBe(130_000_000 + 2_000_000);
    });

    it("rounds the lot adjustment to whole cents, halves away from zero", () => {
      // 0.01 acre x 6,000,050 cents = 60,000.5 cents.
      const m: MarketSettings = { ...S, featureValues: { ...S.featureValues, lotPerAcreCents: 6_000_050 } };
      const adjustedFor = (lotAcres: number): number => {
        const scored = scoreComps(subject, [comp({ id: "adj", lotAcres })], m, { adj: true }, TODAY);
        return unwrap(estimatePrice(subject, scored, m)).comps[0]!.adjustedCents;
      };
      expect(adjustedFor(0.32)).toBe(130_000_000 + 60_001);
      expect(adjustedFor(0.34)).toBe(130_000_000 - 60_001);
    });
  });

  it("scales the adjusted price to the subject's size and rounds to cents", () => {
    // 3000 effective sf comp (2400 + 1000 x 0.6) priced at an awkward figure.
    const c = comp({ id: "odd", aboveGradeFinishedSf: 2400, basementFinishedSf: 1000, soldPriceCents: 123_456_789 });
    const est = estimateFor([c], { odd: true });
    const implied = roundCents((123_456_789 / 3000) * 3160);
    expect(est.comps[0]!.impliedCents).toBe(implied);
    expect(est.midCents).toBe(implied);
    expect(Number.isInteger(est.midCents)).toBe(true);
    expect(est.midPerEffectiveSfCents).toBe(roundCents(implied / 3160));
  });

  it("uses only included comps that sold at a recorded price", () => {
    const pending = comp({ id: "pend", status: "pending", soldDate: undefined, soldPriceCents: undefined, listPriceCents: 999_000_000 });
    const active = comp({ id: "act", status: "active", soldDate: undefined, soldPriceCents: undefined, listPriceCents: 999_000_000 });
    const noPrice = comp({ id: "np", soldPriceCents: undefined });
    const est = estimateFor([c1, pending, active, noPrice], { pend: true, act: true, np: true });
    expect(est.comps.map((c) => c.id)).toEqual(["C1"]);
  });

  it("skips a comp with no effective sf", () => {
    const flat = comp({ id: "flat", aboveGradeFinishedSf: 0, basementFinishedSf: 0 });
    const est = estimateFor([c1, flat], { flat: true });
    expect(est.comps.map((c) => c.id)).toEqual(["C1"]);
    expect(Number.isFinite(est.midCents)).toBe(true);
  });

  it("is incomplete with noComps when nothing included has sold", () => {
    const check = (r: Result<PriceEstimate>) => {
      expect(r.status).toBe("incomplete");
      if (r.status === "incomplete") {
        expect(r.missing[0]).toMatchObject({ code: "noComps", step: "market" });
        expect(r.missing[0]!.message).not.toBe("");
      }
    };
    check(estimatePrice(subject, [], S));
    check(estimatePrice(subject, scoreComps(subject, [c1, c2], S, { C1: false, C2: false }, TODAY), S));
    check(estimatePrice(subject, scoreComps(subject, [compB], S, {}, TODAY), S)); // scores 68.8, not included
    const active = comp({ id: "act", status: "active", soldDate: undefined, soldPriceCents: undefined });
    check(estimatePrice(subject, scoreComps(subject, [active], S, {}, TODAY), S));
    const flat = comp({ id: "flat", aboveGradeFinishedSf: 0, basementFinishedSf: 0 });
    check(estimatePrice(subject, scoreComps(subject, [flat], S, { flat: true }, TODAY), S));
  });

  it("is incomplete when the subject has no finished area", () => {
    const empty: Subject = { ...subject, aboveGradeFinishedSf: 0, basementFinishedSf: 0 };
    const r = estimatePrice(empty, scoreComps(empty, [c1], S, { C1: true }, TODAY), S);
    expect(r.status).toBe("incomplete");
    if (r.status === "incomplete") expect(r.missing[0]).toMatchObject({ code: "missingFinishedArea", step: "house" });
  });

  it("does not change the scored list it is given", () => {
    const scored = scoreComps(subject, [c1, c2, c3], S, {}, TODAY);
    const before = structuredClone(scored);
    estimatePrice(subject, scored, S);
    expect(scored).toEqual(before);
  });

  it("keeps low <= mid <= high (property)", () => {
    const arbComp = fc.record({
      aboveGradeFinishedSf: fc.integer({ min: 1500, max: 3500 }),
      basementFinishedSf: fc.integer({ min: 0, max: 2000 }),
      soldPriceCents: fc.integer({ min: 50_000_000, max: 250_000_000 }),
      garageBays: fc.integer({ min: 0, max: 5 }),
      lotAcres: fc.double({ min: 0.1, max: 2, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(arbComp, { minLength: 1, maxLength: 8 }), (rows) => {
        const comps = rows.map((r, i) => comp({ id: `p${i}`, ...r }));
        const everyone = Object.fromEntries(comps.map((c) => [c.id, true]));
        const est = estimateFor(comps, everyone);
        expect(est.lowCents).toBeLessThanOrEqual(est.midCents);
        expect(est.midCents).toBeLessThanOrEqual(est.highCents);
        expect(est.comps).toHaveLength(comps.length);
      }),
    );
  });
});

describe("golden comps", () => {
  it("are valid comp records", () => {
    const statuses = ["sold", "active", "pending"];
    const finishes = ["none", "unfinished", "partial", "finished"];
    const sources = ["manual", "csv", "claudeFile", "ownSale"];
    expect(GOLDEN_COMPS).toHaveLength(8);
    for (const c of GOLDEN_COMPS) {
      expect(statuses).toContain(c.status);
      expect(finishes).toContain(c.basementFinish);
      expect(sources).toContain(c.source);
    }
  });

  it("score and price against the sample subject", () => {
    const scored = scoreComps(subject, GOLDEN_COMPS, S, {}, TODAY);
    expect(scored).toHaveLength(8);
    for (const s of scored) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
    expect(scored.map((s) => s.score)).toEqual([...scored.map((s) => s.score)].sort((a, b) => b - a));

    const all = Object.fromEntries(GOLDEN_COMPS.map((c) => [c.id, true]));
    const est = unwrap(estimatePrice(subject, scoreComps(subject, GOLDEN_COMPS, S, all, TODAY), S));
    expect(est.comps).toHaveLength(8);
    expect(est.lowCents).toBeLessThanOrEqual(est.midCents);
    expect(est.midCents).toBeLessThanOrEqual(est.highCents);
  });
});
