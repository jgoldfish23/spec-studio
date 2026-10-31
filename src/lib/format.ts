import type { Cents } from "@engine";

/** Shown wherever a figure is missing, so a blank never reads as zero. */
const MISSING = "—";

// One formatter per format, built once. Building an Intl.NumberFormat on every call is slow.
const WHOLE_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DECIMAL_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const percentFormats = new Map<string, Intl.NumberFormat>();

function percentFormat(minDigits: number, maxDigits: number): Intl.NumberFormat {
  const key = `${minDigits}:${maxDigits}`;
  let format = percentFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
      // No separators, so a shown percent reads back through parsePercent.
      useGrouping: false,
    });
    percentFormats.set(key, format);
  }
  return format;
}

/** A value that rounds to zero is "0.0%", never "-0.0%". */
const withoutNegativeZero = (text: string): string => text.replace(/^-(?=0(?:\.0+)?%?$)/, "");

const isMissing = (n: number | null | undefined): n is null | undefined => n == null || !Number.isFinite(n);

// ---------------------------------------------------------------------------------------------------------------
// Formatting

/**
 * Digits of an amount, grouped in thousands, rounded half away from zero. `negative` is false when the amount
 * rounds to zero, so there is never a "-$0".
 */
function moneyDigits(cents: Cents, showCents: boolean): { negative: boolean; digits: string } {
  const magnitude = Math.round(Math.abs(cents));
  if (showCents) {
    const fraction = String(magnitude % 100).padStart(2, "0");
    return {
      negative: cents < 0 && magnitude !== 0,
      digits: `${WHOLE_NUMBER.format(Math.floor(magnitude / 100))}.${fraction}`,
    };
  }
  const dollars = Math.floor(magnitude / 100) + (magnitude % 100 >= 50 ? 1 : 0);
  return { negative: cents < 0 && dollars !== 0, digits: WHOLE_NUMBER.format(dollars) };
}

/** `$1,350,000` (whole dollars, halves away from zero), or `$1,350,000.50` with `{ cents: true }`. "—" if missing. */
export function formatMoney(cents: Cents | null | undefined, opts: { cents?: boolean } = {}): string {
  if (isMissing(cents)) return MISSING;
  const { negative, digits } = moneyDigits(cents, opts.cents === true);
  return `${negative ? "-" : ""}$${digits}`;
}

/** `12.5%` from `0.1253`. "—" if missing. */
export function formatPercent(decimal: number | null | undefined, digits = 1): string {
  if (isMissing(decimal)) return MISSING;
  return withoutNegativeZero(percentFormat(digits, digits).format(decimal));
}

/** Like `formatPercent` with up to `maxDigits` digits and no trailing zeros: `0.1` is "10%", `0.125` is "12.5%". */
export function formatPercentCompact(decimal: number | null | undefined, maxDigits: number): string {
  if (isMissing(decimal)) return MISSING;
  return withoutNegativeZero(percentFormat(0, maxDigits).format(decimal));
}

/** `45 days`, `1 day`. "—" if missing. */
export function formatDays(n: number | null | undefined): string {
  if (isMissing(n)) return MISSING;
  const days = Math.round(n);
  return `${WHOLE_NUMBER.format(days)} ${days === 1 ? "day" : "days"}`;
}

/** `45–90` (an en dash, no unit). "—" if either end is missing. */
export function formatDayRange(low: number | null | undefined, high: number | null | undefined): string {
  if (isMissing(low) || isMissing(high)) return MISSING;
  return `${WHOLE_NUMBER.format(Math.round(low))}–${WHOLE_NUMBER.format(Math.round(high))}`;
}

// The text a form field shows inside its box. No unit symbol: the field draws that beside the box. Every one of
// these reads back through its parser.

/** `1,350,000`, or `1,350,000.50` when the field takes cents. */
export function formatMoneyInput(cents: Cents, allowCents: boolean): string {
  if (isMissing(cents)) return "";
  const { negative, digits } = moneyDigits(cents, allowCents);
  return `${negative ? "-" : ""}${digits}`;
}

/** `9.00` from `0.09` with two digits. */
export function formatPercentInput(decimal: number, digits: number): string {
  if (isMissing(decimal)) return "";
  return withoutNegativeZero(percentFormat(digits, digits).format(decimal)).replace(/%$/, "");
}

/** `3,800` or `2.5`. */
export function formatNumberInput(n: number): string {
  if (isMissing(n)) return "";
  return DECIMAL_NUMBER.format(n);
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing. Each parser returns null for anything it does not fully understand. None returns NaN, Infinity or -0.

/** Digits, either plain (`1350000`) or correctly grouped in thousands (`1,350,000`). Not `1,35,0000`. */
const WHOLE_DIGITS = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;
const DOLLARS = new RegExp(String.raw`^\$?(${WHOLE_DIGITS})?(?:\.(\d+))?$`);
const NUMBER = new RegExp(String.raw`^(-)?(${WHOLE_DIGITS})?(?:\.(\d+))?$`);
const PERCENT = /^(-)?(\d+)?(?:\.(\d+))?\s*%?$/;

const ONLY_ZEROS = /^0*$/;

/** Dollars typed as text to integer cents: `1,350,000` or `$1350000.50` (with `allowCents`). */
export function parseDollars(text: string, opts: { allowCents: boolean }): Cents | null {
  const match = DOLLARS.exec(text.trim());
  if (match === null) return null;
  const [, whole, fraction] = match;
  // The pattern lets both parts be absent, which would match "" and "$".
  if (whole === undefined && fraction === undefined) return null;

  let fractionCents = 0;
  if (fraction !== undefined) {
    if (opts.allowCents) {
      if (fraction.length > 2) return null;
      fractionCents = Number(fraction.padEnd(2, "0"));
    } else if (!ONLY_ZEROS.test(fraction)) {
      return null;
    }
  }

  // Cents come from the digits, never from a float times 100: 0.29 * 100 is 28.999999999999996.
  const dollars = Number((whole ?? "0").replaceAll(",", ""));
  if (!Number.isSafeInteger(dollars)) return null;
  const cents = dollars * 100 + fractionCents;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** A percent typed as text to a decimal: `9` is `0.09`, `9.5%` is `0.095`. A leading `-` is allowed. */
export function parsePercent(text: string): number | null {
  const match = PERCENT.exec(text.trim());
  if (match === null) return null;
  const [, sign, whole, fraction] = match;
  if (whole === undefined && fraction === undefined) return null;

  // Move the decimal point two places in the text, so 7.1 is exactly the literal 0.071 (7.1 / 100 is not).
  const padded = (whole ?? "0").padStart(2, "0");
  const decimal = Number(`${padded.slice(0, -2) || "0"}.${padded.slice(-2)}${fraction ?? ""}`);
  if (!Number.isFinite(decimal)) return null;
  if (decimal === 0) return 0; // never -0
  return sign === undefined ? decimal : -decimal;
}

/** A plain number typed as text: `3,800`, `2.5`, `-4`. With `integer`, a fraction is refused (`4.0` is still 4). */
export function parseNumber(text: string, opts: { integer: boolean }): number | null {
  const match = NUMBER.exec(text.trim());
  if (match === null) return null;
  const [, sign, whole, fraction] = match;
  if (whole === undefined && fraction === undefined) return null;

  let digits = (whole ?? "0").replaceAll(",", "");
  if (fraction !== undefined) {
    if (opts.integer) {
      if (!ONLY_ZEROS.test(fraction)) return null;
    } else {
      digits += `.${fraction}`;
    }
  }
  const n = Number(digits);
  if (!Number.isFinite(n) || (opts.integer && !Number.isSafeInteger(n))) return null;
  if (n === 0) return 0; // never -0
  return sign === undefined ? n : -n;
}
