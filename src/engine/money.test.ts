import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dollars, formatUsd, mulRate, roundCents, sumCents } from "./money";

describe("roundCents", () => {
  it("rounds half away from zero, absorbing float noise at .5", () => {
    // 267.49999999999994 is the double immediately below 267.5 (the brief's 267.49999999999997 parses to it).
    expect(roundCents(267.49999999999994)).toBe(268);
    expect(roundCents(1.005 * 100)).toBe(101);
    expect(roundCents(267.4)).toBe(267);
    expect(roundCents(267.5)).toBe(268);
    expect(roundCents(-267.5)).toBe(-268);
    expect(roundCents(-267.49999999999994)).toBe(-268);
    expect(roundCents(-267.4)).toBe(-267);
  });

  it("does not round values clearly below .5 up", () => {
    expect(roundCents(267.4999)).toBe(267);
    expect(roundCents(-267.4999)).toBe(-267);
  });

  it("returns a positive zero, never negative zero", () => {
    expect(Object.is(roundCents(-0.2), 0)).toBe(true);
    expect(Object.is(roundCents(-0), 0)).toBe(true);
    expect(roundCents(0)).toBe(0);
  });

  it("is symmetric about zero", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }), (x) => {
        expect(roundCents(-x)).toBe(roundCents(x) === 0 ? 0 : -roundCents(x));
      }),
    );
  });

  it("leaves integers unchanged", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (n) => {
        expect(roundCents(n)).toBe(n);
      }),
    );
  });
});

describe("mulRate", () => {
  it("multiplies cents by a decimal rate and rounds to cents", () => {
    expect(mulRate(70_095_000, 0.05)).toBe(3_504_750);
    expect(mulRate(10_000, 0.0925)).toBe(925);
    expect(mulRate(1_001, 0.5)).toBe(501);
    expect(mulRate(-1_001, 0.5)).toBe(-501);
  });

  it("returns zero for a zero rate or zero amount", () => {
    expect(mulRate(70_095_000, 0)).toBe(0);
    expect(mulRate(0, 0.05)).toBe(0);
  });
});

describe("sumCents", () => {
  it("sums rounded parts", () => {
    expect(sumCents([100, 250, -50])).toBe(300);
    expect(sumCents([])).toBe(0);
  });

  it("accepts a readonly array", () => {
    const parts: readonly number[] = [1, 2, 3];
    expect(sumCents(parts)).toBe(6);
  });
});

describe("dollars", () => {
  it("converts whole and fractional dollars to integer cents", () => {
    expect(dollars(1_350_000)).toBe(135_000_000);
    expect(dollars(0)).toBe(0);
    expect(dollars(-19_000)).toBe(-1_900_000);
    expect(dollars(19.99)).toBe(1_999);
    expect(dollars(0.07)).toBe(7);
  });
});

describe("formatUsd", () => {
  it("formats cents as whole dollars with thousands separators", () => {
    expect(formatUsd(135_000_000)).toBe("$1,350,000");
    expect(formatUsd(3_504_750)).toBe("$35,048");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(99_999)).toBe("$1,000");
    expect(formatUsd(12_300)).toBe("$123");
  });

  it("uses the U+2212 minus sign for negatives", () => {
    expect(formatUsd(-1_900_000)).toBe("−$19,000");
    expect(formatUsd(-1_900_000).startsWith("-")).toBe(false);
  });

  it("rounds half away from zero to whole dollars", () => {
    expect(formatUsd(50)).toBe("$1");
    expect(formatUsd(49)).toBe("$0");
    expect(formatUsd(-50)).toBe("−$1");
  });

  it("never shows a negative zero", () => {
    expect(formatUsd(-49)).toBe("$0");
    expect(formatUsd(-1)).toBe("$0");
  });
});
