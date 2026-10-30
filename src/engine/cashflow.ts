import { MONTH_DAYS } from "./dates";
import type { Carry, ConstructionLoan, DealInputs, Lot, Selling } from "./deal";
import type { Estimate } from "./estimate";
import { roundCents, type Cents } from "./money";

/** What varies between scenarios: the sale price, days on market, and the cost overrun. */
export type ScenarioInputs = { priceCents: Cents; domDays: number; overrunPct: number };

/** Everything the monthly cash flow needs, flattened from a deal, its estimate, and one scenario. */
export type ProFormaInput = {
  landPriceCents: Cents;
  landClosingCents: Cents;
  landFinancing: Lot["financing"];
  preConMonths: number;
  buildMonths: number;
  listEarlyMonths: number;
  closingDays: number;
  /** Estimate lines in division `soft`. */
  softCents: Cents;
  /** Estimate total less soft costs, so it includes contingency. */
  hardCents: Cents;
  estimateTotalCents: Cents;
  /** Decimal, applied to soft and hard costs alike. */
  overrunPct: number;
  loan: ConstructionLoan;
  carry: Carry;
  /** Annual property tax rate. */
  taxRate: number;
  hoaMonthlyCents: Cents;
  selling: Selling;
  salePriceCents: Cents;
  domDays: number;
};

/** One month of the schedule, `index` months after land close. */
export type Period = {
  index: number;
  /** Soft costs (period 0) plus this month's hard-cost draw. */
  spendCents: Cents;
  equitySpendCents: Cents;
  loanDrawCents: Cents;
  drawFeeCents: Cents;
  /** Construction-loan points only; land-loan points are part of the land purchase in period 0. */
  pointsCents: Cents;
  /** Construction interest, whether paid or capitalized. */
  interestCents: Cents;
  landLoanInterestCents: Cents;
  extensionFeeCents: Cents;
  taxCents: Cents;
  insuranceCents: Cents;
  utilitiesCents: Cents;
  stagingCents: Cents;
  upkeepCents: Cents;
  hoaCents: Cents;
  /** Everything equity pays this month (period 0 includes the land purchase). */
  equityOutCents: Cents;
  /** Construction-loan balance after this month's draw and any capitalized interest. */
  loanBalanceEndCents: Cents;
  cumulativeEquityCents: Cents;
};

/** Months from land close; fractional where days on market or closing days fall mid-month. */
export type CashFlowTimes = {
  buildStart: number;
  completion: number;
  list: number;
  contract: number;
  saleClose: number;
  maturity: number;
};

export type Sale = {
  priceCents: Cents;
  commissionsCents: Cents;
  closingCents: Cents;
  concessionsCents: Cents;
  netCents: Cents;
  /** Construction draws, capitalized interest, and the land loan. */
  loanPayoffCents: Cents;
  equityReturnCents: Cents;
};

export type CashFlow = {
  /** Periods 0 … ceil(saleClose) − 1; the sale is booked on the last one. */
  periods: Period[];
  times: CashFlowTimes;
  commitmentCents: Cents;
  landLoanCents: Cents;
  loanDrawnCents: Cents;
  capitalizedInterestCents: Cents;
  extensions: number;
  sale: Sale;
};

/** Flattens a deal, its estimate, and one scenario into the cash flow's input. */
export function buildProFormaInput(d: DealInputs, e: Estimate, s: ScenarioInputs): ProFormaInput {
  const softCents = e.lines.filter((l) => l.division === "soft").reduce((sum, l) => sum + l.totalCents, 0);
  return {
    landPriceCents: d.lot.priceCents,
    landClosingCents: d.lot.closingCents,
    landFinancing: { ...d.lot.financing },
    preConMonths: d.timeline.preConMonths,
    buildMonths: d.timeline.buildMonths,
    listEarlyMonths: d.timeline.listEarlyMonths,
    closingDays: d.timeline.closingDays,
    softCents,
    hardCents: e.totalCents - softCents,
    estimateTotalCents: e.totalCents,
    overrunPct: s.overrunPct,
    loan: { ...d.loan },
    carry: { ...d.carry },
    taxRate: d.lot.propertyTaxRate,
    hoaMonthlyCents: d.lot.hoaMonthlyCents,
    selling: { ...d.selling },
    salePriceCents: s.priceCents,
    domDays: s.domDays,
  };
}

/** Share of the hard cost drawn in each build month: a sine curve, small at both ends, summing to 1. */
export function drawWeights(buildMonths: number): number[] {
  const sines = Array.from({ length: buildMonths }, (_, i) => Math.sin((Math.PI * (i + 0.5)) / buildMonths));
  const total = sines.reduce((sum, s) => sum + s, 0);
  return sines.map((s) => s / total);
}

/** Hard-cost draw per build month; the last draw takes the remainder so draws sum exactly. */
function hardDraws(hardActual: Cents, buildMonths: number): Cents[] {
  const weights = drawWeights(buildMonths);
  let earlier = 0;
  return weights.map((w, i) => {
    const draw = i < weights.length - 1 ? roundCents(hardActual * w) : hardActual - earlier;
    earlier += draw;
    return draw;
  });
}

/** How much of month `k` (the interval [k, k + 1)) falls inside [a, b]. */
function overlap(k: number, a: number, b: number): number {
  return Math.max(0, Math.min(k + 1, b) - Math.max(k, a));
}

function timesFor(input: ProFormaInput): CashFlowTimes {
  const buildStart = input.preConMonths;
  const completion = buildStart + input.buildMonths;
  const list = completion - input.listEarlyMonths;
  const contract = list + input.domDays / MONTH_DAYS;
  const saleClose = Math.max(contract + input.closingDays / MONTH_DAYS, completion);
  return { buildStart, completion, list, contract, saleClose, maturity: buildStart + input.loan.termMonths };
}

/**
 * The monthly cash flow (plan Reference, steps 1-11): spend funded equity first, then the
 * construction loan; loan fees and interest; land-loan interest; extensions; carry; and the sale.
 * Every amount is rounded to the cent where it is computed. Assumes a valid deal, in particular
 * `loan.extensionMonths ≥ 1` and `buildMonths ≥ 1`.
 */
export function runCashFlow(input: ProFormaInput): CashFlow {
  const { loan, carry, selling } = input;
  const times = timesFor(input);
  const { buildStart, completion, list, contract, saleClose, maturity } = times;
  const periodCount = Math.ceil(saleClose);

  const softActual = roundCents(input.softCents * (1 + input.overrunPct));
  const hardActual = roundCents(input.hardCents * (1 + input.overrunPct));
  const draws = hardDraws(hardActual, input.buildMonths);

  const commitment = roundCents(loan.ltc * input.estimateTotalCents);
  const equityRequired = input.estimateTotalCents - commitment;
  const constructionPoints = commitment > 0 ? roundCents(loan.points * commitment) : 0;
  const capitalize = loan.interestMode === "capitalized";

  const financing = input.landFinancing;
  const landLoan = financing.kind === "loan" ? roundCents(financing.ltv * input.landPriceCents) : 0;
  const landPoints = financing.kind === "loan" ? roundCents(financing.points * landLoan) : 0;
  const landRate = financing.kind === "loan" ? financing.rate : 0;
  const landPurchase = input.landPriceCents - landLoan + input.landClosingCents + landPoints;

  const extensions =
    commitment > 0 && saleClose > maturity ? Math.ceil((saleClose - maturity) / loan.extensionMonths) : 0;
  const extensionFee = roundCents(loan.extensionPct * commitment);
  // Extension j's fee is paid in the month that extension begins.
  const extensionPeriods = Array.from({ length: extensions }, (_, j) =>
    Math.floor(maturity + j * loan.extensionMonths),
  );

  const periods: Period[] = [];
  let spentBefore = 0;
  let drawn = 0;
  let balance = 0;
  let capitalized = 0;
  let cumulativeEquity = 0;

  for (let k = 0; k < periodCount; k++) {
    // Funding, equity first: equity covers spend until the equity requirement is met, the loan
    // covers the rest up to its commitment, and equity covers anything beyond that.
    const spend = (k === 0 ? softActual : 0) + (draws[k - buildStart] ?? 0);
    let equitySpend = Math.min(spend, Math.max(0, equityRequired - spentBefore));
    const loanDraw = Math.min(spend - equitySpend, commitment - drawn);
    equitySpend += spend - equitySpend - loanDraw;
    spentBefore += spend;
    drawn += loanDraw;

    // Draws land at period end, so interest accrues on the balance at the start of the period.
    const interest = roundCents(((balance * loan.rate) / 12) * overlap(k, buildStart, saleClose));
    const capitalizedInterest = capitalize ? interest : 0;
    capitalized += capitalizedInterest;
    balance += loanDraw + capitalizedInterest;

    const pointsCents = k === buildStart ? constructionPoints : 0;
    const drawFeeCents = loanDraw > 0 ? loan.drawFeeCents : 0;
    const landLoanInterestCents = roundCents(((landLoan * landRate) / 12) * overlap(k, 0, saleClose));
    const extensionFeeCents = extensionPeriods.filter((p) => p === k).length * extensionFee;

    const taxCents = roundCents((input.taxRate / 12) * (input.landPriceCents + spentBefore) * overlap(k, 0, saleClose));
    const insuranceCents = roundCents(
      (carry.insuranceRate / 12) * input.estimateTotalCents * overlap(k, buildStart, saleClose),
    );
    const utilitiesCents = roundCents(
      carry.utilitiesBuildMonthlyCents * overlap(k, buildStart, completion) +
        carry.utilitiesAfterMonthlyCents * overlap(k, completion, saleClose),
    );
    const stagingCents = roundCents(carry.stagingMonthlyCents * overlap(k, list, contract));
    const upkeepCents = roundCents(carry.upkeepMonthlyCents * overlap(k, completion, saleClose));
    const hoaCents = roundCents(input.hoaMonthlyCents * overlap(k, 0, saleClose));

    const equityOutCents =
      (k === 0 ? landPurchase : 0) +
      equitySpend +
      pointsCents +
      drawFeeCents +
      (interest - capitalizedInterest) +
      landLoanInterestCents +
      extensionFeeCents +
      taxCents +
      insuranceCents +
      utilitiesCents +
      stagingCents +
      upkeepCents +
      hoaCents;
    cumulativeEquity += equityOutCents;

    periods.push({
      index: k,
      spendCents: spend,
      equitySpendCents: equitySpend,
      loanDrawCents: loanDraw,
      drawFeeCents,
      pointsCents,
      interestCents: interest,
      landLoanInterestCents,
      extensionFeeCents,
      taxCents,
      insuranceCents,
      utilitiesCents,
      stagingCents,
      upkeepCents,
      hoaCents,
      equityOutCents,
      loanBalanceEndCents: balance,
      cumulativeEquityCents: cumulativeEquity,
    });
  }

  const price = input.salePriceCents;
  const commissionsCents = roundCents(price * (selling.listingPct + selling.buyerPct));
  const closingCents = roundCents(price * selling.closingPct);
  const netCents = price - commissionsCents - closingCents - selling.concessionsCents;
  const loanPayoffCents = drawn + capitalized + landLoan;

  return {
    periods,
    times,
    commitmentCents: commitment,
    landLoanCents: landLoan,
    loanDrawnCents: drawn,
    capitalizedInterestCents: capitalized,
    extensions,
    sale: {
      priceCents: price,
      commissionsCents,
      closingCents,
      concessionsCents: selling.concessionsCents,
      netCents,
      loanPayoffCents,
      equityReturnCents: netCents - loanPayoffCents,
    },
  };
}
