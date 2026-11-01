import type { ISODate } from "@engine";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const LONGEST_RELATIVE_DAYS = 30;
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * When something last changed, as the owner would say it: "Today", "Yesterday", "3 days ago", and past 30 days a
 * short date such as "Sep 12, 2026". Days are calendar days where the owner is: the local date of `updatedAt`
 * against `today`. A timestamp from the future reads "Today". "—" when either date cannot be read.
 */
export function relativeDay(updatedAt: string, today: ISODate): string {
  const then = new Date(updatedAt);
  const match = DATE.exec(today);
  if (Number.isNaN(then.getTime()) || match === null) return "—";
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "—";

  const todayMs = Date.UTC(Number(match[1]), month - 1, day);
  const thenMs = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const days = Math.round((todayMs - thenMs) / MS_PER_DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= LONGEST_RELATIVE_DAYS) return `${days} days ago`;
  return SHORT_DATE.format(then);
}
