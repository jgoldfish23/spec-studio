import { describe, expect, it } from "vitest";
import { relativeDay } from "./relativeDay";

const TODAY = "2026-10-31";
/** A timestamp at local noon on the given calendar day, so the test does not depend on the machine's time zone. */
const at = (year: number, month: number, day: number, hour = 12): string => new Date(year, month - 1, day, hour).toISOString();

describe("relativeDay", () => {
  it("says Today for the same calendar day, at any hour", () => {
    expect(relativeDay(at(2026, 10, 31, 0), TODAY)).toBe("Today");
    expect(relativeDay(at(2026, 10, 31, 23), TODAY)).toBe("Today");
  });

  it("says Yesterday for the day before, even a few minutes after midnight", () => {
    expect(relativeDay(at(2026, 10, 30, 23), TODAY)).toBe("Yesterday");
    expect(relativeDay(at(2026, 10, 30, 0), TODAY)).toBe("Yesterday");
  });

  it("counts calendar days, not 24-hour spans", () => {
    expect(relativeDay(at(2026, 10, 29), TODAY)).toBe("2 days ago");
    expect(relativeDay(at(2026, 10, 1), TODAY)).toBe("30 days ago");
  });

  it("counts across a month and a year end", () => {
    expect(relativeDay(at(2026, 12, 30), "2027-01-02")).toBe("3 days ago");
  });

  it("uses a short date past 30 days", () => {
    expect(relativeDay(at(2026, 9, 30), TODAY)).toBe("Sep 30, 2026");
    expect(relativeDay(at(2025, 1, 5), TODAY)).toBe("Jan 5, 2025");
  });

  it("says Today for a timestamp in the future", () => {
    expect(relativeDay(at(2026, 11, 3), TODAY)).toBe("Today");
  });

  it("shows a dash when either date cannot be read", () => {
    expect(relativeDay("not a date", TODAY)).toBe("—");
    expect(relativeDay(at(2026, 10, 30), "soon")).toBe("—");
  });
});
