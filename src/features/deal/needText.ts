import { COST_CODES } from "@engine";
import type { MissingItem } from "@engine";
import { variantName } from "../estimate/lineFormat";

// The fields a validation issue can be about, by the path `validateDeal` reports, named as their step's screen labels
// them. A label that is only clear inside its card ("Total sf" under Basement, "Rate %" under the land loan) gets the
// card's name in front, because a "Needs:" list shows it on its own.
const FIELD_LABELS: Readonly<Record<string, string>> = {
  // Lot
  "lot.city": "City",
  "lot.county": "County",
  "lot.region": "Region",
  "lot.acres": "Acres",
  "lot.frontageFt": "Frontage",
  "lot.utilities": "Utilities at the street",
  "lot.utilities.water": "Water",
  "lot.utilities.sewer": "Sewer",
  "lot.utilities.gas": "Gas",
  "lot.utilities.power": "Power",
  "lot.utilities.secondaryWater": "Secondary water",
  "lot.priceCents": "Lot price",
  "lot.closingCents": "Closing costs",
  "lot.financing": "Pay for land with",
  "lot.financing.ltv": "Land loan LTV %",
  "lot.financing.rate": "Land loan rate %",
  "lot.financing.points": "Land loan points %",
  "lot.propertyTaxRate": "Property tax rate %",
  "lot.hoaMonthlyCents": "HOA $/month",
  "timeline.landClose": "Land closes",
  "timeline.preConMonths": "Design & permits months",
  "timeline.buildMonths": "Build months",
  "timeline.listEarlyMonths": "Months before completion",
  "timeline.closingDays": "Closing days after contract",
  // House
  "house.source": "Start from",
  "house.stockPlanRef": "Plan name/reference",
  "house.style": "Style",
  "house.levels.main.finishedSf": "Main finished sf",
  "house.levels.main.unfinishedSf": "Main unfinished sf",
  "house.levels.main.ceilingFt": "Main ceilings ft",
  "house.levels.upper.finishedSf": "Upper finished sf",
  "house.levels.upper.unfinishedSf": "Upper unfinished sf",
  "house.levels.upper.ceilingFt": "Upper ceilings ft",
  "house.levels.basement.totalSf": "Basement total sf",
  "house.levels.basement.finishedSf": "Basement finished sf",
  "house.footprint": "Footprint",
  "house.footprint.widthFt": "Width ft",
  "house.footprint.depthFt": "Depth ft",
  "house.footprint.complexity": "Corners & jogs",
  "house.roof.style": "Roof style",
  "house.roof.pitchPer12": "Pitch (/12)",
  "house.garage.bays": "Garage bays",
  "house.rooms.bedrooms": "Bedrooms",
  "house.rooms.fullBaths": "Full baths",
  "house.rooms.halfBaths": "Half baths",
  "house.rooms.fireplaces": "Fireplaces",
  "house.exterior": "Exterior",
  "house.exterior.stonePct": "Stone %",
  "house.exterior.stuccoPct": "Stucco %",
  "house.exterior.boardBattenPct": "Board & batten %",
  "house.exterior.fiberCementPct": "Fiber cement %",
  "house.finishes.houseTier": "Finishes",
  "house.finishes.overrides.kitchen": "Kitchen finish",
  "house.finishes.overrides.primaryBath": "Primary bath finish",
  "house.finishes.overrides.basement": "Basement finish",
  "house.adu.type": "ADU",
  "house.adu.finishedSf": "ADU finished sf",
  "house.pool.type": "Pool",
  "house.outside.coveredPatioSf": "Covered patio sf",
  "house.outside.flatworkSf": "Driveway & flatwork sf",
  "house.outside.fenceLf": "Fencing lf",
  "house.outside.landscapingTier": "Landscaping tier",
  // Estimate
  contingencyPct: "Contingency",
  // Market
  "overrides.basePriceCents": "Base sale price",
  "overrides.baseDomDays": "Base days on market",
  plannedListPriceCents: "Planned list price",
  // Pro forma
  "loan.ltc": "Loan-to-cost %",
  "loan.rate": "Construction loan rate %",
  "loan.points": "Construction loan points %",
  "loan.drawFeeCents": "Draw fee $",
  "loan.termMonths": "Term months",
  "loan.extensionPct": "Extension fee %",
  "loan.extensionMonths": "Extension length months",
  "loan.interestMode": "Interest",
  "carry.insuranceRate": "Builder's risk %/yr",
  "carry.utilitiesBuildMonthlyCents": "Utilities during build $/mo",
  "carry.utilitiesAfterMonthlyCents": "Utilities after completion $/mo",
  "carry.stagingMonthlyCents": "Staging $/mo",
  "carry.upkeepMonthlyCents": "Upkeep $/mo",
  selling: "Selling costs",
  "selling.listingPct": "Listing agent %",
  "selling.buyerPct": "Buyer's agent %",
  "selling.closingPct": "Closing & title %",
  "selling.concessionsCents": "Rate buydown / concessions $",
  "rules.minMarginOnSale": "Minimum margin on sale",
  "rules.minAnnualizedReturn": "Minimum annualized return",
  "rules.minDownsideProfitCents": "Minimum downside profit",
};

/** Every bid, and every field of one (`bids.3.vendor`), is edited on the bid's own form. */
const BID_PATH = /^bids(\.\d+(\.\w+)?)?$/;

/** The label of the field at `path`, or undefined when there is none to give. */
function fieldLabel(path: string): string | undefined {
  if (BID_PATH.test(path)) return "Bid";
  return Object.hasOwn(FIELD_LABELS, path) ? FIELD_LABELS[path] : undefined;
}

/** "lot.city: Required" without "lot.city: ". An item from before items carried a `ref` has its first word taken. */
function withoutPath(item: MissingItem): string {
  const prefix = item.ref === undefined ? /^[\w.]*: / : `${item.ref}: `;
  if (typeof prefix === "string") return item.message.startsWith(prefix) ? item.message.slice(prefix.length) : item.message;
  return item.message.replace(prefix, "");
}

/** Variants that only repeat the line or its unit ("base", "ls", "window" on Windows): they add nothing to read. */
const SAY_NOTHING = new Set(["base", "ls", "lf", "unit", "month", "ton", "connection", "window", "fixture"]);

/** The variant and tier the engine names at the end of a missing price's message: `variant "hard", upgraded tier`. */
const PRICE_KEY = /variant "([^"]*)", (?:no tier|(\w+) tier)$/;

/** "No price for Flooring (Hard, upgraded tier)": the cost code by name, with what the engine says it priced. */
function missingPriceText(item: MissingItem): string {
  const code = COST_CODES.find((candidate) => candidate.id === item.ref);
  if (code === undefined) return item.message;
  const match = PRICE_KEY.exec(item.message);
  const variant = match?.[1];
  const tier = match?.[2];
  const details = [
    variant !== undefined && variant !== "" && !SAY_NOTHING.has(variant) ? variantName(variant) : null,
    tier !== undefined ? `${tier} tier` : null,
  ].filter((detail) => detail !== null);
  return `No price for ${code.name}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

/**
 * A missing item as the owner reads it, wherever one is listed: a field that is not right is named by its label
 * ("City: Required", not "lot.city: Required"), a missing price by its cost line, and anything else as the engine says
 * it.
 */
export function needText(item: MissingItem): string {
  if (item.code === "invalidDeal") {
    const message = withoutPath(item);
    const label = item.ref === undefined ? undefined : fieldLabel(item.ref);
    return label === undefined ? message : `${label}: ${message}`;
  }
  if (item.code === "missingPrice") return missingPriceText(item);
  return item.message;
}
