import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MONTH_DAYS,
  addMonths,
  calendarMonth,
  daysBetween,
  monthOfDate,
  yearOfDate,
} from "./dates";

describe("daysBetween", () => {
  it("counts days from a to b", () => {
    expect(daysBetween("2026-01-10", "2026-10-30")).toBe(293);
    expect(daysBetween("2026-06-15", "2026-10-30")).toBe(137);
    expect(daysBetween("2026-10-30", "2026-10-30")).toBe(0);
  });

  it("is negative when b is before a", () => {
    expect(daysBetween("2026-10-30", "2026-06-15")).toBe(-137);
  });

  it("handles leap days and year boundaries", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
  });

  it("is not affected by daylight saving transitions", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
  });

  it("is antisymmetric", () => {
    const day = fc.integer({ min: 0, max: 20_000 }).map((n) => new Date(Date.UTC(1990, 0, 1 + n)).toISOString().slice(0, 10));
    fc.assert(
      fc.property(day, day, (a, b) => {
        expect(daysBetween(a, b) + daysBetween(b, a)).toBe(0);
      }),
    );
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => daysBetween("2026-1-10", "2026-10-30")).toThrow(RangeError);
    expect(() => daysBetween("2026-10-30", "2026-02-30")).toThrow(RangeError);
    expect(() => daysBetween("2026-13-01", "2026-10-30")).toThrow(RangeError);
    expect(() => daysBetween("not a date", "2026-10-30")).toThrow(RangeError);
  });
});

describe("addMonths", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2027-06", 11)).toBe("2028-05");
    expect(addMonths("2027-11", 2)).toBe("2028-01");
    expect(addMonths("2027-12", 1)).toBe("2028-01");
    expect(addMonths("2027-06", 0)).toBe("2027-06");
    expect(addMonths("2027-06", 24)).toBe("2029-06");
  });

  it("subtracts months for negative n", () => {
    expect(addMonths("2028-01", -1)).toBe("2027-12");
    expect(addMonths("2028-05", -11)).toBe("2027-06");
    expect(addMonths("2028-01", -13)).toBe("2026-12");
  });

  it("zero-pads the month", () => {
    expect(addMonths("2027-01", 1)).toBe("2027-02");
    expect(addMonths("2027-08", 1)).toBe("2027-09");
  });

  it("round-trips with its negation", () => {
    const ym = fc.tuple(fc.integer({ min: 1900, max: 2200 }), fc.integer({ min: 1, max: 12 })).map(([y, m]) => `${y}-${String(m).padStart(2, "0")}`);
    fc.assert(
      fc.property(ym, fc.integer({ min: -600, max: 600 }), (start, n) => {
        expect(addMonths(addMonths(start, n), -n)).toBe(start);
      }),
    );
  });

  it("rejects a malformed year-month", () => {
    expect(() => addMonths("2027-6", 1)).toThrow(RangeError);
    expect(() => addMonths("2027-13", 1)).toThrow(RangeError);
    expect(() => addMonths("2027-00", 1)).toThrow(RangeError);
    expect(() => addMonths("2027-06-15", 1)).toThrow(RangeError);
  });
});

describe("calendarMonth / monthOfDate / yearOfDate", () => {
  it("returns the 1-12 calendar month of a year-month", () => {
    expect(calendarMonth("2028-05")).toBe(5);
    expect(calendarMonth("2028-12")).toBe(12);
    expect(calendarMonth("2028-01")).toBe(1);
  });

  it("returns month and year of an ISO date", () => {
    expect(monthOfDate("2026-10-30")).toBe(10);
    expect(monthOfDate("2026-01-01")).toBe(1);
    expect(yearOfDate("2026-10-30")).toBe(2026);
    expect(yearOfDate("2028-02-29")).toBe(2028);
  });

  it("rejects malformed input", () => {
    expect(() => calendarMonth("2028-5")).toThrow(RangeError);
    expect(() => monthOfDate("2026-10")).toThrow(RangeError);
    expect(() => yearOfDate("2027-02-29")).toThrow(RangeError);
  });
});

describe("MONTH_DAYS", () => {
  it("is 365 / 12", () => {
    expect(MONTH_DAYS).toBe(365 / 12);
    expect(MONTH_DAYS * 12).toBeCloseTo(365, 10);
  });
});
