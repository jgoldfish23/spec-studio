/**
 * The largest value the deal's schema accepts for each kind of number a field can reach. A figure past these is a
 * typing slip (an extra zero or two), never a spec home, and an absurd figure would only send the engine on a search it
 * cannot finish, so it is a validation issue instead. The app's fields take their `max` from here, so a field and the
 * engine's check always agree.
 */
export const LIMITS = {
  /** Every money amount, in cents: $100 million. */
  moneyCents: 10_000_000_000,
  /** Every area of the house and its site, in square feet; also the footprint's width and depth, in feet. */
  areaSf: 50_000,
  ceilingFt: 30,
  roofPitchPer12: 24,
  acres: 1_000,
  frontageFt: 10_000,
  fenceLf: 10_000,
  garageBays: 10,
  /** Bedrooms, full and half baths, and fireplaces, each. */
  rooms: 20,
  /** A share of the exterior, in percent. */
  exteriorPct: 100,
  /** Every rate, as a decimal: 1 is 100%. */
  rate: 1,
  loanToCost: 0.95,
  preConMonths: 36,
  buildMonths: 36,
  loanTermMonths: 60,
  extensionMonths: 12,
  closingDays: 180,
  /** The owner's own days on market: three years. */
  domDays: 1_095,
} as const;

/** "1,000" for 1000: a limit as a message writes it, without reaching for the runtime's locale. */
export function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
