import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatDayRange,
  formatDays,
  formatMoney,
  formatMoneyInput,
  formatNumberInput,
  formatPercent,
  formatPercentCompact,
  formatPercentInput,
  parseDollars,
  parseNumber,
  parsePercent,
} from "./format";

describe("parseDollars", () => {
  it.each([
    ["1,350,000", 135_000_000],
    ["$1,350,000", 135_000_000],
    [" 1350000 ", 135_000_000],
    ["1350000", 135_000_000],
    ["0", 0],
    ["$0", 0],
    ["999", 99_900],
    ["1,000", 100_000],
    ["01350000", 135_000_000],
  ])("reads %j as %i cents", (text, cents) => {
    expect(parseDollars(text, { allowCents: false })).toBe(cents);
  });

  it("reads a fraction only when cents are allowed", () => {
    expect(parseDollars("1350000.50", { allowCents: true })).toBe(135_000_050);
    expect(parseDollars("1350000.50", { allowCents: false })).toBeNull();
  });

  it("builds cents from the digits, so 0.29 is exactly 29", () => {
    expect(parseDollars("0.29", { allowCents: true })).toBe(29);
    expect(parseDollars("0.07", { allowCents: true })).toBe(7);
    expect(parseDollars("19.99", { allowCents: true })).toBe(1999);
    expect(parseDollars(".5", { allowCents: true })).toBe(50);
    expect(parseDollars("$.50", { allowCents: true })).toBe(50);
    expect(parseDollars("12.5", { allowCents: true })).toBe(1250);
  });

  it("refuses a third fraction digit when cents are allowed", () => {
    expect(parseDollars("1.005", { allowCents: true })).toBeNull();
    expect(parseDollars("1.500", { allowCents: true })).toBeNull();
  });

  it("takes a zero-only fraction as whole dollars when cents are not allowed", () => {
    expect(parseDollars("1350000.00", { allowCents: false })).toBe(135_000_000);
    expect(parseDollars("5.0", { allowCents: false })).toBe(500);
    expect(parseDollars("5.01", { allowCents: false })).toBeNull();
    expect(parseDollars("5.50", { allowCents: false })).toBeNull();
  });

  it.each([
    "",
    "   ",
    "$",
    "-",
    "-5",
    "-$5",
    "$-5",
    "1e3",
    "abc",
    "1.2.3",
    "1,35,0000",
    "1,2",
    "1,2345",
    ",100",
    "100,",
    "1,,000",
    "5.",
    ".",
    "$ 5",
    "1 000",
    "NaN",
    "Infinity",
    "0x10",
    "12abc",
  ])("rejects %j", (text) => {
    expect(parseDollars(text, { allowCents: true })).toBeNull();
    expect(parseDollars(text, { allowCents: false })).toBeNull();
  });

  it("rejects an amount that is not a safe integer once in cents", () => {
    expect(parseDollars("9007199254740993", { allowCents: false })).toBeNull();
    expect(parseDollars("9".repeat(400), { allowCents: false })).toBeNull();
    // Number.MAX_SAFE_INTEGER is 9007199254740991 cents: one cent more is out.
    expect(parseDollars("90071992547409.91", { allowCents: true })).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseDollars("90071992547409.92", { allowCents: true })).toBeNull();
    expect(parseDollars("90071992547409", { allowCents: false })).toBe(9_007_199_254_740_900);
    expect(parseDollars("90071992547410", { allowCents: false })).toBeNull();
  });

  it("never returns anything but null or a non-negative safe integer", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (text, allowCents) => {
        const cents = parseDollars(text, { allowCents });
        return cents === null || (Number.isSafeInteger(cents) && cents >= 0 && !Object.is(cents, -0));
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[$0-9.,\- e]{0,14}$/), fc.boolean(), (text, allowCents) => {
        const cents = parseDollars(text, { allowCents });
        return cents === null || (Number.isSafeInteger(cents) && cents >= 0 && !Object.is(cents, -0));
      }),
    );
  });

  it("reads back what formatMoney writes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000_000_000 }), (cents) => {
        const text = formatMoney(cents, { cents: true });
        return parseDollars(text, { allowCents: true }) === cents;
      }),
    );
  });
});

describe("parsePercent", () => {
  it.each([
    ["9", 0.09],
    ["9.5%", 0.095],
    ["9.5 %", 0.095],
    [" 12 ", 0.12],
    ["100", 1],
    ["0", 0],
    ["0.5", 0.005],
    [".5", 0.005],
    ["-5", -0.05],
    ["-2.5%", -0.025],
  ])("reads %j as %d", (text, decimal) => {
    expect(parsePercent(text)).toBe(decimal);
  });

  it("moves the decimal point in the text, so the result is exactly the literal", () => {
    expect(parsePercent("7.1")).toBe(0.071);
    expect(parsePercent("0.07")).toBe(0.0007);
    expect(parsePercent("0.29")).toBe(0.0029);
    expect(parsePercent("12.53")).toBe(0.1253);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parsePercent("-0"), 0)).toBe(true);
    expect(Object.is(parsePercent("-0.00%"), 0)).toBe(true);
  });

  it.each(["", "   ", "%", "-", "-%", "1e3", "1.2.3", "abc", "5%%", "%5", "--5", "5.", "1,000", "Infinity", "NaN"])(
    "rejects %j",
    (text) => {
      expect(parsePercent(text)).toBeNull();
    },
  );

  it("rejects a number too large to be finite", () => {
    expect(parsePercent("9".repeat(400))).toBeNull();
  });

  it("never returns NaN or Infinity", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = parsePercent(text);
        return result === null || Number.isFinite(result);
      }),
    );
  });
});

describe("parseNumber", () => {
  it.each([
    ["2.5", false, 2.5],
    ["3,800", true, 3800],
    ["3800", true, 3800],
    ["-4", true, -4],
    ["-4.25", false, -4.25],
    ["0", true, 0],
    ["4.0", true, 4],
    ["4.00", true, 4],
    [" 12 ", true, 12],
    [".5", false, 0.5],
  ])("reads %j (integer: %s) as %d", (text, integer, expected) => {
    expect(parseNumber(text, { integer })).toBe(expected);
  });

  it("refuses a fraction in integer mode", () => {
    expect(parseNumber("2.5", { integer: true })).toBeNull();
    expect(parseNumber("4.01", { integer: true })).toBeNull();
  });

  it("never returns negative zero", () => {
    expect(Object.is(parseNumber("-0", { integer: true }), 0)).toBe(true);
    expect(Object.is(parseNumber("-0.0", { integer: false }), 0)).toBe(true);
  });

  it.each(["", "-", "1e3", "abc", "1.2.3", "1,35,0000", "1,2", "--1", "5.", "$5", "5%", "Infinity", "NaN"])(
    "rejects %j",
    (text) => {
      expect(parseNumber(text, { integer: false })).toBeNull();
      expect(parseNumber(text, { integer: true })).toBeNull();
    },
  );

  it("rejects a number too large to be finite, and an integer too large to be safe", () => {
    expect(parseNumber("9".repeat(400), { integer: false })).toBeNull();
    expect(parseNumber("9007199254740993", { integer: true })).toBeNull();
  });

  it("never returns NaN or Infinity", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (text, integer) => {
        const result = parseNumber(text, { integer });
        return result === null || Number.isFinite(result);
      }),
    );
  });
});

describe("formatMoney", () => {
  it("writes whole dollars with thousands separators", () => {
    expect(formatMoney(135_000_000)).toBe("$1,350,000");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(99)).toBe("$1");
    expect(formatMoney(100)).toBe("$1");
  });

  it("writes an em dash for a missing amount", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
  });

  it("writes negatives with an ASCII hyphen", () => {
    expect(formatMoney(-1_250_000)).toBe("-$12,500");
    expect(formatMoney(-1_250_000, { cents: true })).toBe("-$12,500.00");
  });

  it("rounds half away from zero to whole dollars", () => {
    expect(formatMoney(150)).toBe("$2");
    expect(formatMoney(149)).toBe("$1");
    expect(formatMoney(50)).toBe("$1");
    expect(formatMoney(49)).toBe("$0");
    expect(formatMoney(-50)).toBe("-$1");
    expect(formatMoney(-150)).toBe("-$2");
  });

  it("never writes a negative zero", () => {
    expect(formatMoney(-49)).toBe("$0");
    expect(formatMoney(-0)).toBe("$0");
  });

  it("writes two decimals when asked", () => {
    expect(formatMoney(135_000_050, { cents: true })).toBe("$1,350,000.50");
    expect(formatMoney(5, { cents: true })).toBe("$0.05");
    expect(formatMoney(0, { cents: true })).toBe("$0.00");
    expect(formatMoney(29, { cents: true })).toBe("$0.29");
  });
});

describe("formatPercent", () => {
  it("writes a decimal as a percent with one digit by default", () => {
    expect(formatPercent(0.1253)).toBe("12.5%");
    expect(formatPercent(0.09, 2)).toBe("9.00%");
    expect(formatPercent(0.095, 0)).toBe("10%");
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("writes a negative with an ASCII hyphen", () => {
    expect(formatPercent(-0.05)).toBe("-5.0%");
  });

  it("never writes a negative zero", () => {
    expect(formatPercent(-0.00001)).toBe("0.0%");
  });

  it("writes an em dash for a missing value", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("does not group digits, so the text reads back with parsePercent", () => {
    expect(formatPercent(12.345, 2)).toBe("1234.50%");
  });
});

describe("formatPercentCompact", () => {
  it("drops trailing zeros", () => {
    expect(formatPercentCompact(0, 2)).toBe("0%");
    expect(formatPercentCompact(1, 2)).toBe("100%");
    expect(formatPercentCompact(0.1, 2)).toBe("10%");
    expect(formatPercentCompact(0.125, 2)).toBe("12.5%");
    expect(formatPercentCompact(0.0125, 2)).toBe("1.25%");
  });
});

describe("formatDays and formatDayRange", () => {
  it("writes a count with its unit", () => {
    expect(formatDays(45)).toBe("45 days");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(0)).toBe("0 days");
    expect(formatDays(1200)).toBe("1,200 days");
    expect(formatDays(null)).toBe("—");
    expect(formatDays(undefined)).toBe("—");
  });

  it("writes a range with an en dash and no unit", () => {
    expect(formatDayRange(45, 90)).toBe("45–90");
    expect(formatDayRange(null, 90)).toBe("—");
    expect(formatDayRange(45, undefined)).toBe("—");
  });
});

describe("text shown inside a form field", () => {
  it("writes money without the symbol, in a form parseDollars reads back", () => {
    expect(formatMoneyInput(135_000_000, false)).toBe("1,350,000");
    expect(formatMoneyInput(135_000_050, true)).toBe("1,350,000.50");
    expect(formatMoneyInput(1200, true)).toBe("12.00");
    expect(formatMoneyInput(0, false)).toBe("0");
    expect(formatMoneyInput(150, false)).toBe("2");
  });

  it("writes a percent without the sign, in a form parsePercent reads back", () => {
    expect(formatPercentInput(0.09, 2)).toBe("9.00");
    expect(formatPercentInput(0.071, 2)).toBe("7.10");
    expect(formatPercentInput(-0.05, 1)).toBe("-5.0");
    expect(formatPercentInput(-0.000001, 2)).toBe("0.00");
    expect(parsePercent(formatPercentInput(0.071, 2))).toBe(0.071);
  });

  it("writes a number with separators and no needless decimals", () => {
    expect(formatNumberInput(3800)).toBe("3,800");
    expect(formatNumberInput(2.5)).toBe("2.5");
    expect(formatNumberInput(0.1 + 0.2)).toBe("0.3");
    expect(parseNumber(formatNumberInput(3800), { integer: true })).toBe(3800);
  });

  it("writes nothing for a value that is not a finite number", () => {
    expect(formatMoneyInput(Number.NaN, false)).toBe("");
    expect(formatPercentInput(Number.POSITIVE_INFINITY, 2)).toBe("");
    expect(formatNumberInput(Number.NaN)).toBe("");
  });
});
