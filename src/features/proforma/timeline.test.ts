import { describe, expect, it } from "vitest";
import type { CashFlowTimes } from "@engine";
import { barLayout, monthLabel, timelineSegments } from "./timeline";

/** The golden deal's base scenario: land closes Jun 2027, two months of permits, a nine month build, 62 days on market. */
const GOLDEN_BASE: CashFlowTimes = {
  buildStart: 2,
  completion: 11,
  list: 11,
  contract: 13.0383561643836,
  saleClose: 14.1890410958904,
  maturity: 14,
};

describe("monthLabel", () => {
  it("names the month a whole number of months after land close, as Mmm YYYY", () => {
    expect(monthLabel("2027-06", 0)).toBe("Jun 2027");
    expect(monthLabel("2027-06", 11)).toBe("May 2028");
    expect(monthLabel("2027-06", 14)).toBe("Aug 2028");
  });

  it("rounds a fraction of a month down", () => {
    expect(monthLabel("2027-06", 14.1890410958904)).toBe("Aug 2028");
    expect(monthLabel("2027-06", 13.99)).toBe("Jul 2028");
    expect(monthLabel("2027-06", 0.9)).toBe("Jun 2027");
  });

  it("rolls into the next year: November plus three months is February", () => {
    expect(monthLabel("2026-11", 3)).toBe("Feb 2027");
    expect(monthLabel("2027-12", 1)).toBe("Jan 2028");
    expect(monthLabel("2027-01", 12)).toBe("Jan 2028");
    expect(monthLabel("2027-01", 25)).toBe("Feb 2029");
  });

  it("names every month", () => {
    const names = Array.from({ length: 12 }, (_, i) => monthLabel("2027-01", i));
    expect(names).toEqual([
      "Jan 2027",
      "Feb 2027",
      "Mar 2027",
      "Apr 2027",
      "May 2027",
      "Jun 2027",
      "Jul 2027",
      "Aug 2027",
      "Sep 2027",
      "Oct 2027",
      "Nov 2027",
      "Dec 2027",
    ]);
  });

  it("writes a dash for a month it cannot read, instead of throwing", () => {
    expect(monthLabel("2026-13", 1)).toBe("—");
    expect(monthLabel("", 1)).toBe("—");
    expect(monthLabel("June 2027", 1)).toBe("—");
    expect(monthLabel("2027-06", Number.NaN)).toBe("—");
  });
});

describe("timelineSegments", () => {
  it("cuts the golden base case into permits, build, listed and closing", () => {
    const { segments } = timelineSegments(GOLDEN_BASE, "2027-06");
    expect(segments.map((s) => s.key)).toEqual(["permits", "build", "listed", "closing"]);
    const spans = segments.map((s) => [s.startMonth, s.endMonth]);
    expect(spans[0]).toEqual([0, 2]);
    expect(spans[1]).toEqual([2, 11]);
    expect(spans[2]?.[0]).toBe(11);
    expect(spans[2]?.[1]).toBeCloseTo(13.04, 2);
    expect(spans[3]?.[0]).toBeCloseTo(13.04, 2);
    expect(spans[3]?.[1]).toBeCloseTo(14.19, 2);
  });

  it("uses the engine's own times, unrounded", () => {
    const { segments } = timelineSegments(GOLDEN_BASE, "2027-06");
    expect(segments[2]?.endMonth).toBe(GOLDEN_BASE.contract);
    expect(segments[3]?.startMonth).toBe(GOLDEN_BASE.contract);
    expect(segments[3]?.endMonth).toBe(GOLDEN_BASE.saleClose);
  });

  it("labels each segment with how long it lasts", () => {
    const { segments } = timelineSegments(GOLDEN_BASE, "2027-06", { domDays: 62 });
    expect(segments.map((s) => s.label)).toEqual(["Permits 2 mo", "Build 9 mo · loan draws", "Listed 62 d", "Close"]);
  });

  it("says just Listed without the scenario's days on market, rather than working them back from the times", () => {
    expect(timelineSegments(GOLDEN_BASE, "2027-06").segments[2]?.label).toBe("Listed");
  });

  it("marks the month the loan matures", () => {
    expect(timelineSegments(GOLDEN_BASE, "2027-06").maturityMonth).toBe(14);
  });

  it("has no maturity mark when the loan matures after the sale has closed", () => {
    const easy: CashFlowTimes = { ...GOLDEN_BASE, maturity: 20 };
    expect(timelineSegments(easy, "2027-06").maturityMonth).toBeNull();
  });

  it("has no maturity mark for a deal with no loan, though the engine still gives it a maturity month", () => {
    const slow: CashFlowTimes = { ...GOLDEN_BASE, saleClose: 20 };
    expect(timelineSegments(slow, "2027-06").maturityMonth).toBe(14);
    expect(timelineSegments(slow, "2027-06", { hasLoan: false }).maturityMonth).toBeNull();
    expect(timelineSegments(slow, "2027-06", { hasLoan: true }).maturityMonth).toBe(14);
  });

  it("marks a loan that matures on the day of the sale", () => {
    const atClose: CashFlowTimes = { ...GOLDEN_BASE, maturity: GOLDEN_BASE.saleClose };
    expect(timelineSegments(atClose, "2027-06").maturityMonth).toBe(GOLDEN_BASE.saleClose);
  });

  it("names the land close, listing and sale close months", () => {
    expect(timelineSegments(GOLDEN_BASE, "2027-06").dates).toEqual({
      landClose: "Jun 2027",
      list: "May 2028",
      saleClose: "Aug 2028",
    });
  });

  it("rolls the dates over a year end", () => {
    const { dates } = timelineSegments({ ...GOLDEN_BASE, list: 6, saleClose: 8.4 }, "2026-11");
    expect(dates).toEqual({ landClose: "Nov 2026", list: "May 2027", saleClose: "Jul 2027" });
  });

  it("labels the listing with the days on market it is given", () => {
    expect(timelineSegments(GOLDEN_BASE, "2027-06", { domDays: 400 }).segments[2]?.label).toBe("Listed 400 d");
    expect(timelineSegments(GOLDEN_BASE, "2027-06", { domDays: 1 }).segments[2]?.label).toBe("Listed 1 d");
  });
});

describe("barLayout", () => {
  const total = GOLDEN_BASE.saleClose;

  it("places each segment as a share of the whole bar, edge to edge", () => {
    const { pieces } = barLayout(timelineSegments(GOLDEN_BASE, "2027-06").segments, 14);
    expect(pieces.map((p) => p.key)).toEqual(["permits", "build", "listed", "closing"]);
    expect(pieces[0]?.leftPct).toBe(0);
    expect(pieces[0]?.widthPct).toBeCloseTo((2 / total) * 100, 6);
    expect(pieces[1]?.leftPct).toBeCloseTo((2 / total) * 100, 6);
    expect(pieces[1]?.widthPct).toBeCloseTo((9 / total) * 100, 6);
    const last = pieces[3];
    expect((last?.leftPct ?? 0) + (last?.widthPct ?? 0)).toBeCloseTo(100, 6);
  });

  it("puts the loan marker as a share of the bar", () => {
    const { maturityPct } = barLayout(timelineSegments(GOLDEN_BASE, "2027-06").segments, 14);
    expect(maturityPct).toBeCloseTo((14 / total) * 100, 6);
  });

  it("has no marker without a maturity month", () => {
    expect(barLayout(timelineSegments(GOLDEN_BASE, "2027-06").segments, null).maturityPct).toBeNull();
  });

  it("cuts the build short where an early listing begins, so no two pieces overlap", () => {
    const early: CashFlowTimes = { ...GOLDEN_BASE, list: 9, contract: 9 + 62 / (365 / 12), saleClose: 11.19 };
    const { pieces } = barLayout(timelineSegments(early, "2027-06").segments, 14);
    for (const [i, piece] of pieces.entries()) {
      const next = pieces[i + 1];
      if (next !== undefined) expect(piece.leftPct + piece.widthPct).toBeLessThanOrEqual(next.leftPct + 1e-9);
    }
    const build = pieces.find((p) => p.key === "build");
    const listed = pieces.find((p) => p.key === "listed");
    expect((build?.leftPct ?? 0) + (build?.widthPct ?? 0)).toBeCloseTo(listed?.leftPct ?? -1, 6);
  });

  it("gives a piece no width rather than a negative one", () => {
    const { pieces } = barLayout(
      [
        { key: "permits", startMonth: 0, endMonth: 0, label: "Permits 0 mo" },
        { key: "build", startMonth: 0, endMonth: 4, label: "Build 4 mo · loan draws" },
      ],
      null,
    );
    expect(pieces.map((p) => p.widthPct)).toEqual([0, 100]);
  });

  it("draws nothing for a bar of no length", () => {
    expect(barLayout([], null)).toEqual({ pieces: [], maturityPct: null });
  });
});
