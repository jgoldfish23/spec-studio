import { describe, expect, it } from "vitest";
import type { MissingItem, Timeline } from "@engine";
import {
  barPercent,
  finishedSf,
  listedToSold,
  listingMonthOf,
  longMonthYear,
  monthYear,
  NEEDS_DOM_COMPS,
  NEEDS_PRICE_COMPS,
  pricePerFinishedSf,
  whyIncomplete,
} from "./marketFormat";

describe("monthYear", () => {
  it("names the month of a date in three letters", () => {
    expect(monthYear("2026-03-15")).toBe("Mar 2026");
    expect(monthYear("2025-12-01")).toBe("Dec 2025");
    expect(monthYear("2026-01-31")).toBe("Jan 2026");
  });

  it("does not move a date at the start or end of a month into the next or the last", () => {
    expect(monthYear("2026-03-01")).toBe("Mar 2026");
    expect(monthYear("2026-02-28")).toBe("Feb 2026");
  });

  it("is a dash for no date and for text that is not a date", () => {
    expect(monthYear(undefined)).toBe("—");
    expect(monthYear("")).toBe("—");
    expect(monthYear("2026-13-01")).toBe("—");
    expect(monthYear("soon")).toBe("—");
  });
});

describe("listedToSold", () => {
  it("joins the two months with an arrow", () => {
    expect(listedToSold({ listDate: "2026-03-15", soldDate: "2026-05-15" })).toBe("Mar 2026 → May 2026");
    expect(listedToSold({ listDate: "2025-10-15", soldDate: "2026-02-15" })).toBe("Oct 2025 → Feb 2026");
  });

  it("leaves a dash on the side that is not known", () => {
    expect(listedToSold({ soldDate: "2026-05-15" })).toBe("— → May 2026");
    expect(listedToSold({ listDate: "2026-03-15" })).toBe("Mar 2026 → —");
    expect(listedToSold({})).toBe("— → —");
  });
});

describe("longMonthYear and listingMonthOf", () => {
  it("names a month in full with its year", () => {
    expect(longMonthYear("2028-05")).toBe("May 2028");
    expect(longMonthYear("2027-12")).toBe("December 2027");
  });

  it("is null for a month that is not one", () => {
    expect(longMonthYear("2028-13")).toBeNull();
    expect(longMonthYear("2028-00")).toBeNull();
    expect(longMonthYear("May")).toBeNull();
  });

  const timeline = (change: Partial<Timeline> = {}): Timeline => ({
    landClose: "2027-06",
    preConMonths: 2,
    buildMonths: 9,
    listEarlyMonths: 0,
    closingDays: 35,
    ...change,
  });

  it("works out the month the house lists in from the timeline: land close, design, build, less early listing", () => {
    expect(listingMonthOf(timeline())).toBe("May 2028");
    expect(listingMonthOf(timeline({ listEarlyMonths: 2 }))).toBe("March 2028");
    expect(listingMonthOf(timeline({ landClose: "2026-11", buildMonths: 2, preConMonths: 0 }))).toBe("January 2027");
  });

  it("is null instead of throwing for a timeline it cannot read", () => {
    expect(listingMonthOf(timeline({ landClose: "2026-13" }))).toBeNull();
    expect(listingMonthOf(timeline({ landClose: "soon" }))).toBeNull();
  });
});

describe("finishedSf and pricePerFinishedSf", () => {
  const comp = { aboveGradeFinishedSf: 2173, basementFinishedSf: 1777, soldPriceCents: 136_500_000 };

  it("adds the area above grade and the finished basement", () => {
    expect(finishedSf(comp)).toBe(3950);
  });

  it("divides the sold price by it, in cents", () => {
    expect(pricePerFinishedSf(comp)).toBeCloseTo(34_556.96, 2);
  });

  it("is null without a sold price or without any finished area", () => {
    expect(pricePerFinishedSf({ ...comp, soldPriceCents: undefined })).toBeNull();
    expect(pricePerFinishedSf({ ...comp, aboveGradeFinishedSf: 0, basementFinishedSf: 0 })).toBeNull();
  });

  it("is null for an area that is not a number", () => {
    expect(finishedSf({ ...comp, aboveGradeFinishedSf: Number.NaN })).toBeNull();
    expect(pricePerFinishedSf({ ...comp, basementFinishedSf: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("barPercent", () => {
  it("puts 0 to 180 days across the bar", () => {
    expect(barPercent(0)).toBe(0);
    expect(barPercent(45)).toBe(25);
    expect(barPercent(90)).toBe(50);
    expect(barPercent(180)).toBe(100);
  });

  it("holds days outside the bar at its ends, and a number that is not one at the start", () => {
    expect(barPercent(-20)).toBe(0);
    expect(barPercent(400)).toBe(100);
    expect(barPercent(Number.NaN)).toBe(0);
    expect(barPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("whyIncomplete", () => {
  const item = (code: string, message: string): MissingItem => ({ code, message, step: "market" });

  it("tells the owner to add comps, or give a number of their own, when comps are what is missing", () => {
    expect(whyIncomplete([item("noComps", "Include at least one sold comp")], "noComps", NEEDS_PRICE_COMPS)).toBe(
      "Needs sold comps — add at least one below, or enter your own base sale price above.",
    );
    expect(whyIncomplete([item("noDomComps", "x")], "noDomComps", NEEDS_DOM_COMPS)).toBe(
      "Needs sold comps — add at least one below, or enter your own base days on market above.",
    );
  });

  it("gives the engine's own reason when something else is missing", () => {
    expect(whyIncomplete([item("invalidDeal", "lot.city: Required")], "noComps", NEEDS_PRICE_COMPS)).toBe(
      "lot.city: Required",
    );
  });

  it("still asks for comps when comps are one of several things missing", () => {
    expect(
      whyIncomplete([item("noPriceMid", "Needs a price"), item("noDomComps", "x")], "noDomComps", NEEDS_DOM_COMPS),
    ).toBe(NEEDS_DOM_COMPS);
  });

  it("has something to say even with nothing listed", () => {
    expect(whyIncomplete([], "noComps", NEEDS_PRICE_COMPS)).toBe("Not available yet.");
  });
});
