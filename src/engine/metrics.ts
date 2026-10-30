import { runCashFlow, type CashFlow, type ProFormaInput } from "./cashflow";
import { MONTH_DAYS } from "./dates";
import { roundCents, sumCents, type Cents } from "./money";

/** The headline numbers of one pro forma scenario (plan Reference, steps 12-15). */
export type Metrics = {
  salePriceCents: Cents;
  totalProjectCostCents: Cents;
  /** Soft and hard costs after overrun. */
  buildSpentCents: Cents;
  /** Loan points, interest (paid or capitalized), draw fees, and extension fees, on the land and construction loans. */
  financingCents: Cents;
  carryCents: Cents;
  /** Commissions, seller closing costs, and concessions. */
  sellingCostsCents: Cents;
  profitCents: Cents;
  /** Profit over the sale price; 0 when the sale price is 0. */
  marginOnSale: number;
  /** Profit over the total project cost; 0 when that cost is 0. */
  marginOnCost: number;
  /** The most cash equity has put in at any month, before the sale pays any back. */
  peakCashCents: Cents;
  /** Profit over peak cash; 0 when no cash goes in. */
  returnOnCash: number;
  /** Annualized IRR of the equity flows; null when it is undefined or outside −99% to 100% a month. */
  annualizedReturn: number | null;
  /** The sale price at which profit is zero, to the cent. Infinity if selling costs take 100% or more of the price. */
  breakEvenSalePriceCents: Cents;
  /** What holding the finished house costs for one more month on the market. */
  monthlyBurnWhileListedCents: Cents;
  /** The most days on market before the loan needs an extension; null when there is no construction loan. */
  maxDomWithoutExtension: number | null;
  /** Months from land close to the sale closing. */
  monthsLandToClose: number;
};

/** One equity cash flow: `t` months after land close, negative when equity pays in. */
export type EquityFlow = { t: number; cents: Cents };

const IRR_LOW = -0.99;
const IRR_HIGH = 1.0;
const IRR_TOLERANCE = 1e-12;
const IRR_MAX_ITERATIONS = 200;

/** The longest days on market `breakEvenDomDays` searches: three years. */
const MAX_DOM_DAYS = 1095;

/**
 * Float noise allowed when flooring a day count, so months × `MONTH_DAYS` that should be a whole number
 * of days is never floored a day short of what the cash flow (which snaps times to whole months) allows.
 */
const WHOLE_DAY_TOLERANCE = 1e-9;

/** Divides, giving 0 instead of NaN or Infinity when there is nothing to divide by. */
const ratio = (numerator: number, denominator: number): number => (denominator === 0 ? 0 : numerator / denominator);

/** Computes the headline numbers from a cash flow and the input that produced it. */
export function computeMetrics(cf: CashFlow, input: ProFormaInput): Metrics {
  const { periods, times, sale } = cf;
  const sumOf = (pick: (p: (typeof periods)[number]) => Cents): Cents => sumCents(periods.map(pick));

  const landPointsCents =
    input.landFinancing.kind === "loan" ? roundCents(input.landFinancing.points * cf.landLoanCents) : 0;
  const landRate = input.landFinancing.kind === "loan" ? input.landFinancing.rate : 0;

  const buildSpentCents = sumOf((p) => p.spendCents);
  const financingCents =
    sumOf((p) => p.pointsCents) +
    landPointsCents +
    sumOf((p) => p.interestCents) +
    sumOf((p) => p.landLoanInterestCents) +
    sumOf((p) => p.drawFeeCents) +
    sumOf((p) => p.extensionFeeCents);
  const carryCents = sumOf(
    (p) => p.taxCents + p.insuranceCents + p.utilitiesCents + p.stagingCents + p.upkeepCents + p.hoaCents,
  );
  const totalProjectCostCents =
    input.landPriceCents + input.landClosingCents + buildSpentCents + financingCents + carryCents;
  const sellingCostsCents = sale.commissionsCents + sale.closingCents + sale.concessionsCents;
  const profitCents = sale.priceCents - sellingCostsCents - totalProjectCostCents;

  // Cumulative equity only grows, so its peak is the most put in before the sale.
  const peakCashCents = periods.reduce((peak, p) => Math.max(peak, p.cumulativeEquityCents), 0);

  const irr = irrMonthly(equityFlows(cf));
  const feeShare = input.selling.listingPct + input.selling.buyerPct + input.selling.closingPct;
  const breakEvenSalePriceCents =
    feeShare >= 1
      ? Number.POSITIVE_INFINITY
      : roundCents((totalProjectCostCents + sale.concessionsCents) / (1 - feeShare));

  // One more month of holding the finished house: interest on the balance at completion, land-loan
  // interest, tax on land plus build, insurance, and the after-completion carry.
  const completion = times.completion;
  const balanceAtCompletion = completion > 0 ? (periods[completion - 1]?.loanBalanceEndCents ?? 0) : 0;
  const { carry } = input;
  const monthlyBurnWhileListedCents =
    roundCents((balanceAtCompletion * input.loan.rate) / 12) +
    roundCents((cf.landLoanCents * landRate) / 12) +
    roundCents((input.taxRate / 12) * (input.landPriceCents + buildSpentCents)) +
    roundCents((carry.insuranceRate / 12) * input.estimateTotalCents) +
    carry.utilitiesAfterMonthlyCents +
    carry.stagingMonthlyCents +
    carry.upkeepMonthlyCents +
    input.hoaMonthlyCents;

  const maxDomWithoutExtension =
    cf.commitmentCents === 0
      ? null
      : Math.max(
          0,
          Math.floor((times.maturity - times.list) * MONTH_DAYS - input.closingDays + WHOLE_DAY_TOLERANCE),
        );

  return {
    salePriceCents: sale.priceCents,
    totalProjectCostCents,
    buildSpentCents,
    financingCents,
    carryCents,
    sellingCostsCents,
    profitCents,
    marginOnSale: ratio(profitCents, sale.priceCents),
    marginOnCost: ratio(profitCents, totalProjectCostCents),
    peakCashCents,
    returnOnCash: ratio(profitCents, peakCashCents),
    annualizedReturn: irr === null ? null : (1 + irr) ** 12 - 1,
    breakEvenSalePriceCents,
    monthlyBurnWhileListedCents,
    maxDomWithoutExtension,
    monthsLandToClose: times.saleClose,
  };
}

/** Equity paid in each month (as a negative amount, zeros included), then the equity return at the sale closing. */
export function equityFlows(cf: CashFlow): EquityFlow[] {
  const flows: EquityFlow[] = cf.periods.map((p) => ({ t: p.index, cents: 0 - p.equityOutCents }));
  flows.push({ t: cf.times.saleClose, cents: cf.sale.equityReturnCents });
  return flows;
}

/** Net present value of the flows at a monthly rate. */
function npv(flows: readonly EquityFlow[], monthlyRate: number): number {
  return flows.reduce((sum, f) => sum + f.cents / (1 + monthlyRate) ** f.t, 0);
}

/**
 * The monthly rate at which the flows' net present value is zero, found by bisection on −99% to
 * 100% a month. Null when no flow is positive or the value does not change sign over that range
 * (no return, or one too extreme to report).
 */
export function irrMonthly(flows: readonly EquityFlow[]): number | null {
  if (!flows.some((f) => f.cents > 0)) return null;

  let low = IRR_LOW;
  let high = IRR_HIGH;
  const valueAtLow = npv(flows, low);
  const valueAtHigh = npv(flows, high);
  if (!Number.isFinite(valueAtLow) || !Number.isFinite(valueAtHigh)) return null;
  if (valueAtLow === 0) return low;
  if (valueAtHigh === 0) return high;
  if (Math.sign(valueAtLow) === Math.sign(valueAtHigh)) return null;

  const lowSign = Math.sign(valueAtLow);
  for (let i = 0; i < IRR_MAX_ITERATIONS && high - low >= IRR_TOLERANCE; i++) {
    const mid = (low + high) / 2;
    const value = npv(flows, mid);
    if (value === 0) return mid;
    if (Math.sign(value) === lowSign) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * The fewest days on market at which the deal no longer makes a profit, reruning the cash flow for
 * each guess. 0 when it already loses money with no days on market; null when it still profits
 * after three years. Profit never rises with days on market, so bisection finds the first loss.
 */
export function breakEvenDomDays(input: ProFormaInput): number | null {
  const profitAt = (domDays: number): Cents => {
    const scenario = { ...input, domDays };
    return computeMetrics(runCashFlow(scenario), scenario).profitCents;
  };

  if (profitAt(0) <= 0) return 0;
  if (profitAt(MAX_DOM_DAYS) > 0) return null;

  // Invariant: profit(low) > 0 and profit(high) ≤ 0.
  let low = 0;
  let high = MAX_DOM_DAYS;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (profitAt(mid) <= 0) high = mid;
    else low = mid;
  }
  return high;
}
