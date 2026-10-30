/** Money is always integer cents. Never store or pass floating dollars. */
export type Cents = number;

/** Absorbs float noise so values that are mathematically .5 round away from zero. */
const ROUNDING_EPSILON = 1e-6;

/** Rounds to the nearest integer, halves away from zero (never returns negative zero). */
export function roundCents(x: number): Cents {
  const magnitude = Math.floor(Math.abs(x) + 0.5 + ROUNDING_EPSILON);
  if (magnitude === 0) return 0;
  return x < 0 ? -magnitude : magnitude;
}

/** Multiplies an amount by a decimal rate (`0.05` = 5%) and rounds the result to cents. */
export function mulRate(c: Cents, rate: number): Cents {
  return roundCents(c * rate);
}

/** Sums already-rounded cent amounts. */
export function sumCents(xs: readonly Cents[]): Cents {
  return xs.reduce((total, x) => total + x, 0);
}

/** Converts dollars to integer cents. */
export function dollars(d: number): Cents {
  return roundCents(d * 100);
}

/** Formats cents as whole dollars (rounded half away from zero), e.g. `$35,048` or `−$19,000` (U+2212). */
export function formatUsd(c: Cents): string {
  const whole = roundCents(c / 100);
  const digits = Math.abs(whole)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return whole < 0 ? `−$${digits}` : `$${digits}`;
}
