import type { ISODate } from "@engine";

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/**
 * Today's calendar date where the owner is, as `YYYY-MM-DD`. It is the local date, not the UTC date: a builder in
 * Utah at 8 pm should not be handed tomorrow. This is the one place app code reads the clock; the engine is given
 * the date and never looks for it.
 */
export function todayIso(): ISODate {
  const now = new Date();
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}
