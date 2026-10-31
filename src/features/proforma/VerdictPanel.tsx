import { useId } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { LeverResult, Verdict, VerdictKind } from "@engine";
import { formatMoney, formatPercent } from "../../lib/format";
import { VerdictChip } from "../../ui/VerdictChip";
import { stepForMissing, topNeeds } from "../deal/summary";
import { checkLine, loanWarningText, verdictHeadline } from "./verdictText";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-spruce underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";

/** The panel's edge takes the verdict's own tint, so the panel reads as the verdict before any word is read. */
const EDGE: Record<VerdictKind, string> = {
  go: "border-[#B9DEC7]",
  marginal: "border-[#F0D9A8]",
  nogo: "border-[#F2C2BE]",
  incomplete: "border-line",
};

type Tone = "pass" | "fail" | "warn";

const TONES: Record<Tone, string> = {
  pass: "bg-go-bg text-go",
  fail: "bg-no-go-bg text-no-go",
  warn: "bg-marginal-bg text-marginal",
};

const MARKS: Record<Tone, ReactNode> = {
  pass: <path d="M3 7.5 6 10l5-6" />,
  fail: <path d="m4 4 6 6M10 4l-6 6" />,
  warn: <path d="M7 3v5M7 10.5v.5" />,
};

/** A round badge with a mark in it. With a `name` the mark is a picture that says what it means; without, it is decoration. */
function Badge({ tone, name }: { tone: Tone; name?: string }) {
  return (
    <span className={`mt-px flex size-[22px] flex-none items-center justify-center rounded-full ${TONES[tone]}`}>
      <svg
        role={name === undefined ? undefined : "img"}
        aria-label={name}
        aria-hidden={name === undefined ? true : undefined}
        width="12"
        height="12"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {MARKS[tone]}
      </svg>
    </span>
  );
}

const LEVER_NAMES: Record<LeverResult["lever"], string> = {
  lotPrice: "Lot price",
  salePrice: "Sale price",
  buildCost: "Build cost",
};

/** What one lever has to be for a Go, in a sentence; a lever that cannot get there alone says so. */
function leverText(lever: LeverResult): string {
  if (!lever.reachable) return "Not reachable with this alone";
  const value = formatMoney(lever.valueCents);
  switch (lever.lever) {
    case "lotPrice":
      return `Buy the lot for ${value} (${formatMoney(lever.deltaCents)})`;
    case "salePrice":
      return `Sell for ${value} (${formatPercent(lever.deltaPct, 1, { signed: true })})`;
    case "buildCost":
      return `Build for ${value} (${formatMoney(lever.deltaCents)}, ${formatPercent(lever.deltaPct, 1, { signed: true })})`;
  }
}

/** The engine's goal-seek answers, one row for each thing that alone would make the deal a Go. */
function GoalSeek({ levers }: { levers: readonly LeverResult[] }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 border-t border-[#DCE5E1] bg-[#F1F6F4] p-5 sm:p-6 lg:border-t-0 lg:border-l"
    >
      <h2 id={titleId} className="m-0 text-[15px] font-bold text-spruce">
        What would make it a Go
      </h2>
      <p className="m-0 text-[13px] text-[#33403A]">Any one of these on its own gets it to a Go:</p>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {levers.map((lever) => (
          <li key={lever.lever} className="flex flex-col gap-0.5 rounded-[10px] bg-surface px-3.5 py-3 text-sm">
            <span className="text-xs text-muted">{LEVER_NAMES[lever.lever]}</span>
            {lever.reachable ? <strong>{leverText(lever)}</strong> : <span className="text-muted">{leverText(lever)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface VerdictPanelProps {
  dealId: string;
  verdict: Verdict;
  /** The engine's goal-seek answers; null unless the verdict is marginal or no-go. */
  goalSeek: readonly LeverResult[] | null;
}

/**
 * The payoff of the whole deal: the verdict as a large chip with a sentence, a line for each of the owner's rules with
 * a pass or fail mark, the loan heads-up when the base case pays extension fees, and (for a deal that is not a Go) what
 * alone would make it one. While the deal cannot be judged it lists what is missing, each item linked to its step.
 */
export function VerdictPanel({ dealId, verdict, goalSeek }: VerdictPanelProps) {
  const showGoalSeek = goalSeek !== null && verdict.kind !== "go";
  // Several steps can report the same thing; the owner needs to hear it once.
  const needs = verdict.kind === "incomplete" ? topNeeds(verdict.missing, Number.POSITIVE_INFINITY).shown : [];
  return (
    <section
      aria-label="Verdict"
      className={`grid overflow-hidden rounded-xl border bg-surface ${EDGE[verdict.kind]} ${
        showGoalSeek ? "lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]" : ""
      }`}
    >
      <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <VerdictChip kind={verdict.kind} size="lg" />
          <p className="m-0 text-[15px] text-[#33403A]">{verdictHeadline(verdict.kind)}</p>
        </div>

        {verdict.checks.length > 0 ? (
          <ul aria-label="Rule checks" className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px]">
            {verdict.checks.map((check) => (
              <li key={check.rule} className="flex items-start gap-2.5">
                <Badge tone={check.pass ? "pass" : "fail"} name={check.pass ? "Passes" : "Fails"} />
                <span>{checkLine(check)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {needs.length > 0 ? (
          <ul aria-label="What is missing" className="m-0 flex list-none flex-col gap-1 p-0 text-[15px]">
            {needs.map((item) => (
              <li key={item.message} className="flex items-center gap-2.5">
                <Badge tone="warn" />
                <Link to={`/deals/${dealId}/${stepForMissing(item)}`} className={LINK}>
                  {item.message}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {verdict.loanWarning ? (
          <p className="m-0 flex items-start gap-2.5 text-[15px]">
            <Badge tone="warn" />
            <span>{loanWarningText(verdict.loanWarning)}</span>
          </p>
        ) : null}
      </div>
      {showGoalSeek ? <GoalSeek levers={goalSeek} /> : null}
    </section>
  );
}
