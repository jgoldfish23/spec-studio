import fc from "fast-check";
import type { ProFormaInput } from "../cashflow";

/** A decimal rate from whole basis points, `0` to `maxBps / 10_000`. */
const rate = (maxBps: number) => fc.integer({ min: 0, max: maxBps }).map((bps) => bps / 10_000);
const cents = (min: number, max: number) => fc.integer({ min, max });

/**
 * A realistic pro forma input: sale price $500k-$3M, 0-400 days on market, loan-to-cost 0-0.9,
 * 4-14 build months. Listing early is capped at 3 months, so it never exceeds the build.
 */
export function arbProFormaInput(): fc.Arbitrary<ProFormaInput> {
  const landFinancing = fc.oneof(
    fc.constant({ kind: "cash" as const }),
    fc.record({ kind: fc.constant("loan" as const), ltv: rate(8_000), rate: rate(1_500), points: rate(300) }),
  );
  const costs = fc
    .record({ softCents: cents(0, 15_000_000), hardCents: cents(15_000_000, 250_000_000) })
    .map((c) => ({ ...c, estimateTotalCents: c.softCents + c.hardCents }));

  return fc
    .record({
      landPriceCents: cents(5_000_000, 150_000_000),
      landClosingCents: cents(0, 2_000_000),
      landFinancing,
      preConMonths: fc.integer({ min: 0, max: 6 }),
      buildMonths: fc.integer({ min: 4, max: 14 }),
      listEarlyMonths: fc.integer({ min: 0, max: 3 }),
      closingDays: fc.integer({ min: 0, max: 60 }),
      costs,
      overrunPct: rate(2_000),
      loan: fc.record({
        ltc: rate(9_000),
        rate: rate(1_500),
        points: rate(300),
        drawFeeCents: cents(0, 50_000),
        termMonths: fc.integer({ min: 6, max: 24 }),
        extensionPct: rate(100),
        extensionMonths: fc.integer({ min: 1, max: 6 }),
        interestMode: fc.constantFrom("paid" as const, "capitalized" as const),
      }),
      carry: fc.record({
        insuranceRate: rate(100),
        utilitiesBuildMonthlyCents: cents(0, 50_000),
        utilitiesAfterMonthlyCents: cents(0, 50_000),
        stagingMonthlyCents: cents(0, 150_000),
        upkeepMonthlyCents: cents(0, 50_000),
      }),
      taxRate: rate(200),
      hoaMonthlyCents: cents(0, 50_000),
      selling: fc.record({
        listingPct: rate(300),
        buyerPct: rate(300),
        closingPct: rate(200),
        concessionsCents: cents(0, 2_500_000),
      }),
      salePriceCents: cents(50_000_000, 300_000_000),
      domDays: fc.integer({ min: 0, max: 400 }),
    })
    .map(({ costs: c, ...rest }) => ({ ...rest, ...c }));
}
