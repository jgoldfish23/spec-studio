import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@engine";
import type { MissingItem } from "@engine";
import { newDealInputs } from "../../data/newDeal";
import { evaluated } from "../../testing/engineContext";
import { needText } from "./needText";

/** An item as the engine makes one for a validation issue at `path`. */
const invalid = (path: string, message: string, step: MissingItem["step"] = "lot"): MissingItem => ({
  code: "invalidDeal",
  message: `${path}: ${message}`,
  step,
  ref: path,
});

const missingPrice = (code: string, variant: string, tier: string | null, ref = code): MissingItem => ({
  code: "missingPrice",
  message: `No price for Some name (${code}), variant "${variant}", ${tier === null ? "no tier" : `${tier} tier`}`,
  step: "estimate",
  ref,
});

describe("needText", () => {
  it("names a validation issue by the field's label, without the path", () => {
    expect(needText(invalid("lot.city", "Required"))).toBe("City: Required");
    expect(needText(invalid("timeline.listEarlyMonths", "Must be 4 or less"))).toBe("Months before completion: Must be 4 or less");
  });

  it.each([
    ["lot.county", "County"],
    ["lot.acres", "Acres"],
    ["lot.frontageFt", "Frontage"],
    ["lot.priceCents", "Lot price"],
    ["lot.closingCents", "Closing costs"],
    ["lot.hoaMonthlyCents", "HOA $/month"],
    ["lot.propertyTaxRate", "Property tax rate %"],
    ["lot.financing.ltv", "Land loan LTV %"],
    ["lot.utilities.secondaryWater", "Secondary water"],
    ["timeline.landClose", "Land closes"],
    ["timeline.preConMonths", "Design & permits months"],
    ["timeline.buildMonths", "Build months"],
    ["timeline.closingDays", "Closing days after contract"],
    ["house.levels.main.finishedSf", "Main finished sf"],
    ["house.levels.main.ceilingFt", "Main ceilings ft"],
    ["house.levels.upper.unfinishedSf", "Upper unfinished sf"],
    ["house.levels.basement.totalSf", "Basement total sf"],
    ["house.footprint.widthFt", "Width ft"],
    ["house.footprint", "Footprint"],
    ["house.roof.pitchPer12", "Pitch (/12)"],
    ["house.garage.bays", "Garage bays"],
    ["house.rooms.bedrooms", "Bedrooms"],
    ["house.exterior.stonePct", "Stone %"],
    ["house.exterior", "Exterior"],
    ["house.adu.finishedSf", "ADU finished sf"],
    ["house.outside.flatworkSf", "Driveway & flatwork sf"],
    ["house.outside.fenceLf", "Fencing lf"],
    ["contingencyPct", "Contingency"],
    ["overrides.basePriceCents", "Base sale price"],
    ["overrides.baseDomDays", "Base days on market"],
    ["plannedListPriceCents", "Planned list price"],
    ["loan.ltc", "Loan-to-cost %"],
    ["loan.rate", "Construction loan rate %"],
    ["loan.drawFeeCents", "Draw fee $"],
    ["loan.termMonths", "Term months"],
    ["loan.extensionMonths", "Extension length months"],
    ["carry.insuranceRate", "Builder's risk %/yr"],
    ["carry.stagingMonthlyCents", "Staging $/mo"],
    ["selling.listingPct", "Listing agent %"],
    ["selling.concessionsCents", "Rate buydown / concessions $"],
    ["selling", "Selling costs"],
  ])("labels %s as %s", (path, label) => {
    expect(needText(invalid(path, "Must be 0 or more"))).toBe(`${label}: Must be 0 or more`);
  });

  it("calls a problem with any bid a bid", () => {
    expect(needText(invalid("bids.0.vendor", "Required", "estimate"))).toBe("Bid: Required");
    expect(needText(invalid("bids.12.amountCents", "Must be 0 or more", "estimate"))).toBe("Bid: Must be 0 or more");
    expect(needText(invalid("bids.3.receivedOn", "Year must be 1900 or later", "estimate"))).toBe("Bid: Year must be 1900 or later");
  });

  it("falls back to the message without its path for a path it has no label for", () => {
    expect(needText(invalid("scenarioDefs.base.overrunPct", "Must be 1 or less", "proforma"))).toBe("Must be 1 or less");
    expect(needText(invalid("", "Expected object, received null", "proforma"))).toBe("Expected object, received null");
  });

  it("strips the path even from an item that carries no ref", () => {
    expect(needText({ code: "invalidDeal", message: "lot.city: Required", step: "lot" })).toBe("Required");
  });

  it("names a missing price by the cost code's name, with the variant and tier in plain words", () => {
    expect(needText(missingPrice("cladding", "boardBatten", null))).toBe("No price for Exterior cladding (Board batten)");
    expect(needText(missingPrice("flooring", "hard", "upgraded"))).toBe("No price for Flooring (Hard, upgraded tier)");
    // A variant that only repeats the line or its unit says nothing, so it is left out.
    expect(needText(missingPrice("windows", "window", "luxury"))).toBe("No price for Windows & exterior doors (luxury tier)");
    expect(needText(missingPrice("plans", "ls", null))).toBe("No price for Plans & engineering");
  });

  it("keeps a missing price's own message when its code is not a cost code", () => {
    const item = missingPrice("gazebo", "base", null);
    expect(needText(item)).toBe(item.message);
  });

  it("keeps every other item's own message", () => {
    const item: MissingItem = { code: "noComps", message: "No comparable sales fit this house", step: "market" };
    expect(needText(item)).toBe("No comparable sales fit this house");
    expect(needText({ code: "engineError", message: "Couldn't calculate this deal", step: "proforma" })).toBe(
      "Couldn't calculate this deal",
    );
  });

  it("reads a new deal's first need as City: Required", async () => {
    const evaluation = await evaluated(newDealInputs("2026-10-31", { rules: DEFAULT_RULES, contingencyPct: 0.05 }));
    expect(evaluation.verdict.missing?.map(needText)).toEqual(["City: Required"]);
  });
});
