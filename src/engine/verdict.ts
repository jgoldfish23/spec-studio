import type { Rules } from "./deal";
import type { Metrics } from "./metrics";
import type { MissingItem } from "./result";

export type VerdictKind = "incomplete" | "go" | "marginal" | "nogo";

/** One rule, judged: its actual value (null when it cannot be computed) against the company threshold. */
export type RuleCheck = {
  rule: "marginOnSale" | "annualizedReturn" | "downsideProfit";
  pass: boolean;
  actual: number | null;
  threshold: number;
};

export type Verdict = {
  kind: VerdictKind;
  /** Every rule with its pass/fail and actual value; empty when the verdict is incomplete. */
  checks: RuleCheck[];
  /** Present when the base days on market run past what the construction loan allows without an extension. */
  loanWarning?: { maxDomWithoutExtension: number; baseDomDays: number };
  /** Present only on an incomplete verdict: what is needed before the deal can be judged. */
  missing?: MissingItem[];
};

/**
 * Judges a deal against the rules (spec §5.8). The margin and annualized return rules use the base scenario,
 * the downside rule uses the downside scenario's profit. A null annualized return fails its rule.
 * Never returns "incomplete"; that is `incompleteVerdict`.
 */
export function evaluateVerdict(base: Metrics, downside: Metrics, rules: Rules, baseDomDays: number): Verdict {
  const checks: RuleCheck[] = [
    {
      rule: "marginOnSale",
      pass: base.marginOnSale >= rules.minMarginOnSale,
      actual: base.marginOnSale,
      threshold: rules.minMarginOnSale,
    },
    {
      rule: "annualizedReturn",
      pass: base.annualizedReturn !== null && base.annualizedReturn >= rules.minAnnualizedReturn,
      actual: base.annualizedReturn,
      threshold: rules.minAnnualizedReturn,
    },
    {
      rule: "downsideProfit",
      pass: downside.profitCents >= rules.minDownsideProfitCents,
      actual: downside.profitCents,
      threshold: rules.minDownsideProfitCents,
    },
  ];

  const failed = checks.filter((c) => !c.pass);
  const downsideFailed = failed.some((c) => c.rule === "downsideProfit");

  let kind: VerdictKind;
  if (base.profitCents <= 0 || downsideFailed || failed.length >= 2) kind = "nogo";
  else if (failed.length === 0) kind = "go";
  else kind = "marginal";

  const verdict: Verdict = { kind, checks };
  if (base.maxDomWithoutExtension !== null && baseDomDays > base.maxDomWithoutExtension) {
    verdict.loanWarning = { maxDomWithoutExtension: base.maxDomWithoutExtension, baseDomDays };
  }
  return verdict;
}

/** The verdict when required inputs are missing: no checks, just what is needed. */
export function incompleteVerdict(missing: MissingItem[]): Verdict {
  return { kind: "incomplete", checks: [], missing };
}
