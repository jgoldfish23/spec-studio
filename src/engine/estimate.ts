import {
  COST_CODES,
  linePartsFor,
  resolvePrice,
  type CostBookView,
  type CostCodeId,
  type Division,
  type LinePart,
} from "./costbook";
import { daysBetween, type ISODate } from "./dates";
import type { Bid } from "./deal";
import type { HouseModel } from "./house";
import { mulRate, roundCents, sumCents, type Cents } from "./money";
import type { Quantities } from "./quantities";
import { incomplete, ok, type MissingItem, type Result, type Warning } from "./result";

export type EstimateContext = {
  region: string;
  /** Decimal, `0.05` = 5%. */
  contingencyPct: number;
  buildMonths: number;
  today: ISODate;
};

/** A takeoff part with the price it was costed at. */
export type EstimatePart = LinePart & {
  unitPriceCents: Cents;
  totalCents: Cents;
  source: "priceBook" | "default";
  asOf: ISODate;
  stale: boolean;
};

/** One cost code. A bid replaces the line outright, so a bid line has no parts. */
export type EstimateLine = {
  code: CostCodeId;
  name: string;
  division: Division;
  parts: EstimatePart[];
  totalCents: Cents;
  source: "bid" | "priceBook" | "default";
  bid?: Bid;
  stale: boolean;
};

export type Estimate = {
  /** In cost-code order. */
  lines: EstimateLine[];
  /** Every division is present; one with no lines is 0. Excludes contingency. */
  divisionSubtotals: Record<Division, Cents>;
  subtotalCents: Cents;
  contingencyPct: number;
  contingencyCents: Cents;
  totalCents: Cents;
  costPerFinishedSfCents: Cents;
  /** How much of the subtotal rests on bids, the owner's price book, and starter defaults. */
  confidence: {
    bidCents: Cents;
    priceBookCents: Cents;
    defaultCents: Cents;
    bidShare: number;
    priceBookShare: number;
    defaultShare: number;
  };
  /** The default-priced lines worth bidding first, and the default share left once they are bid. */
  bidsNext: { codes: CostCodeId[]; defaultShareAfter: number };
  /** Lines whose price or bid is more than a year old. */
  staleCount: number;
};

/** A price or bid older than this many days is stale. */
const STALE_AFTER_DAYS = 365;
const BIDS_NEXT_COUNT = 4;

const isStale = (asOf: ISODate, today: ISODate): boolean => daysBetween(asOf, today) > STALE_AFTER_DAYS;

const share = (cents: Cents, subtotal: Cents): number => (subtotal === 0 ? 0 : cents / subtotal);

const emptyDivisions = (): Record<Division, Cents> => ({
  soft: 0,
  site: 0,
  structure: 0,
  envelope: 0,
  mep: 0,
  interior: 0,
  exteriorFinish: 0,
  general: 0,
});

/** Groups parts by cost code, keeping their order. */
function groupByCode(parts: readonly LinePart[]): Map<CostCodeId, LinePart[]> {
  const byCode = new Map<CostCodeId, LinePart[]>();
  for (const part of parts) {
    const group = byCode.get(part.code);
    if (group) group.push(part);
    else byCode.set(part.code, [part]);
  }
  return byCode;
}

/**
 * One winning bid per cost code: the latest `receivedOn`, with the first in the array winning a
 * tie. A bid for something that is not a cost code is dropped and reported as a warning.
 */
function winningBids(bids: readonly Bid[]): { winners: Map<CostCodeId, Bid>; warnings: Warning[] } {
  const known = new Set<string>(COST_CODES.map((c) => c.id));
  const winners = new Map<CostCodeId, Bid>();
  const warnings: Warning[] = [];
  for (const bid of bids) {
    if (!known.has(bid.code)) {
      warnings.push({
        code: "unknownBidCode",
        message: `Ignored the bid from ${bid.vendor} for "${bid.code}": it is not a cost code`,
      });
      continue;
    }
    const code = bid.code as CostCodeId;
    const current = winners.get(code);
    // ISO dates sort the same as calendar order, so a plain string compare is enough.
    if (!current || bid.receivedOn > current.receivedOn) winners.set(code, bid);
  }
  return { winners, warnings };
}

const keyOf = (p: LinePart): string => JSON.stringify([p.code, p.variant, p.tier]);

function missingPriceItem(p: LinePart): MissingItem {
  const name = COST_CODES.find((c) => c.id === p.code)?.name ?? p.code;
  const tier = p.tier === null ? "no tier" : `${p.tier} tier`;
  return {
    code: "missingPrice",
    message: `No price for ${name} (${p.code}), variant "${p.variant}", ${tier}`,
    step: "estimate",
  };
}

/**
 * Assembles the estimate: every cost code the takeoff uses, plus any code with a bid, priced from
 * the latest bid, else the owner's price book, else the regional default. Every part without a
 * price is reported in one `incomplete` result; nothing is priced at zero.
 */
export function buildEstimate(
  q: Quantities,
  h: HouseModel,
  book: CostBookView,
  bids: Bid[],
  ctx: EstimateContext,
): Result<Estimate> {
  const partsByCode = groupByCode(linePartsFor(q, h, ctx.buildMonths));
  const { winners, warnings } = winningBids(bids);

  const lines: EstimateLine[] = [];
  const missing: MissingItem[] = [];
  const reportedMissing = new Set<string>();

  for (const costCode of COST_CODES) {
    const bid = winners.get(costCode.id);
    const parts = partsByCode.get(costCode.id);
    if (!bid && !parts) continue;
    const { id: code, name, division } = costCode;

    if (bid) {
      lines.push({
        code,
        name,
        division,
        parts: [],
        totalCents: bid.amountCents,
        source: "bid",
        bid,
        stale: isStale(bid.receivedOn, ctx.today),
      });
      continue;
    }

    const priced: EstimatePart[] = [];
    for (const part of parts ?? []) {
      const price = resolvePrice(part, book, ctx.region);
      if (!price) {
        const key = keyOf(part);
        if (!reportedMissing.has(key)) {
          reportedMissing.add(key);
          missing.push(missingPriceItem(part));
        }
        continue;
      }
      priced.push({
        ...part,
        unitPriceCents: price.unitPriceCents,
        totalCents: roundCents(part.quantity * price.unitPriceCents),
        source: price.source,
        asOf: price.asOf,
        stale: isStale(price.asOf, ctx.today),
      });
    }
    lines.push({
      code,
      name,
      division,
      parts: priced,
      totalCents: sumCents(priced.map((p) => p.totalCents)),
      source: priced.some((p) => p.source === "default") ? "default" : "priceBook",
      stale: priced.some((p) => p.stale),
    });
  }

  const finishedSf = q.finishedSf.value;
  if (finishedSf <= 0) {
    missing.push({
      code: "missingFinishedArea",
      message: "The house needs finished area above zero to work out cost per finished sf",
      step: "house",
    });
  }
  if (missing.length > 0) return incomplete(missing);

  const divisionSubtotals = emptyDivisions();
  for (const line of lines) divisionSubtotals[line.division] += line.totalCents;

  const subtotalCents = sumCents(lines.map((l) => l.totalCents));
  const contingencyCents = mulRate(subtotalCents, ctx.contingencyPct);
  const totalCents = subtotalCents + contingencyCents;

  const defaultPartCents = (line: EstimateLine): Cents =>
    sumCents(line.parts.filter((p) => p.source === "default").map((p) => p.totalCents));
  const bidCents = sumCents(lines.filter((l) => l.source === "bid").map((l) => l.totalCents));
  const priceBookCents = sumCents(
    lines.flatMap((l) => l.parts.filter((p) => p.source === "priceBook").map((p) => p.totalCents)),
  );
  const defaultCents = sumCents(lines.map(defaultPartCents));

  // `lines` is in cost-code order and the sort is stable, so equal totals keep the lower code first.
  const bidTargets = lines
    .filter((l) => l.source === "default")
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, BIDS_NEXT_COUNT);
  const defaultCentsAfter = defaultCents - sumCents(bidTargets.map(defaultPartCents));

  return ok(
    {
      lines,
      divisionSubtotals,
      subtotalCents,
      contingencyPct: ctx.contingencyPct,
      contingencyCents,
      totalCents,
      costPerFinishedSfCents: roundCents(totalCents / finishedSf),
      confidence: {
        bidCents,
        priceBookCents,
        defaultCents,
        bidShare: share(bidCents, subtotalCents),
        priceBookShare: share(priceBookCents, subtotalCents),
        defaultShare: share(defaultCents, subtotalCents),
      },
      bidsNext: {
        codes: bidTargets.map((l) => l.code),
        defaultShareAfter: share(defaultCentsAfter, subtotalCents),
      },
      staleCount: lines.filter((l) => l.stale).length,
    },
    warnings,
  );
}
