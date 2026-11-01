import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { todayIso } from "./today";

describe("todayIso", () => {
  const savedTz = process.env.TZ;

  beforeAll(() => {
    // Utah time, so the local date and the UTC date really can differ.
    process.env.TZ = "America/Denver";
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("is the local calendar date at 9:30 pm, when UTC is already tomorrow", () => {
    // 2026-11-01 03:30 UTC is 2026-10-31 21:30 in Denver (MDT, UTC-6).
    vi.useFakeTimers({ now: new Date("2026-11-01T03:30:00Z") });
    expect(new Date().getDate()).toBe(31); // the zone took effect, so this test can tell local from UTC
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(todayIso()).toBe("2026-10-31");
  });

  it("follows the local date across midnight", () => {
    // 23:59 on Dec 1 in Denver (MST, UTC-7) is already Dec 2 in UTC; five minutes later it is Dec 2 everywhere.
    vi.useFakeTimers({ now: new Date(2026, 11, 1, 23, 59) });
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-12-02");
    expect(todayIso()).toBe("2026-12-01");
    vi.setSystemTime(new Date(2026, 11, 2, 0, 4));
    expect(todayIso()).toBe("2026-12-02");
  });

  it("zero-pads the month and the day", () => {
    vi.useFakeTimers({ now: new Date(2027, 0, 5, 12) });
    expect(todayIso()).toBe("2027-01-05");
  });
});
