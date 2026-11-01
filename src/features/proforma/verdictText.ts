import type { RuleCheck, Verdict, VerdictKind } from "@engine";
import { formatMoney, formatPercent } from "../../lib/format";

const HEADLINES: Record<VerdictKind, string> = {
  go: "Passes all your rules.",
  marginal: "Makes money, but misses one of your rules.",
  nogo: "Doesn't pass your rules.",
  incomplete: "Needs a few more details.",
};

/** The sentence beside the verdict chip. */
export function verdictHeadline(kind: VerdictKind): string {
  return HEADLINES[kind];
}

const RULE_NAMES: Record<RuleCheck["rule"], string> = {
  marginOnSale: "Margin",
  annualizedReturn: "Annualized return",
  downsideProfit: "Downside profit",
};

/**
 * One rule judged, in a line: "Margin 12.5% — your rule is 15.0% or better". A rule that passes says how, a rule that
 * fails says what the rule asks for, and a rule with no value says so (an annualized return is not always defined).
 */
export function checkLine({ rule, pass, actual, threshold }: RuleCheck): string {
  const name = RULE_NAMES[rule];
  if (actual === null) return `${name} — can't be computed`;
  const show = rule === "downsideProfit" ? formatMoney : (n: number) => formatPercent(n, 1);
  const rest = pass
    ? rule === "downsideProfit"
      ? `passes your ${show(threshold)} rule`
      : `${actual > threshold ? "beats" : "meets"} your ${show(threshold)} rule`
    : `your rule is ${show(threshold)} or better`;
  return `${name} ${show(actual)} — ${rest}`;
}

const days = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The loan heads-up. It names how many days the house can take to get under contract before the loan needs an
 * extension, when there is room at all; the extension fees it counts are already in the numbers.
 */
export function loanWarningText({
  maxDomWithoutExtension,
  baseDomDays,
  extensions,
}: NonNullable<Verdict["loanWarning"]>): string {
  if (maxDomWithoutExtension === null || maxDomWithoutExtension <= 0) {
    return "Loan heads-up: the loan term ends before the sale closes, so extension fees apply.";
  }
  const fees = extensions === 1 ? "1 extension fee is" : `${extensions} extension fees are`;
  return (
    `Loan heads-up: to avoid an extension it must go under contract within ${days(maxDomWithoutExtension)} ` +
    `(typical here is ${Math.round(baseDomDays)}). ${fees} already in the numbers.`
  );
}
