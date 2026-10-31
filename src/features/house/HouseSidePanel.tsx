import { useId } from "react";
import type { Cents, DealEvaluation, DealInputs } from "@engine";
import { formatMoney } from "../../lib/format";
import { Card } from "../../ui/Card";
import { NextStepLink } from "../deal/NextStepLink";
import { summarize } from "../deal/summary";
import { TIER_NAMES } from "./shared";
import { takeoffRows } from "./takeoff";
import type { EstimateChange } from "./useEstimateChange";

/** "Change from last edit: +$12,300", with the engine's minus sign for a drop. Null when there is nothing honest to say. */
function changeText(change: EstimateChange | null): string | null {
  if (change === null || change.before === null || change.after === null) return null;
  const difference = change.after - change.before;
  const amount = formatMoney(difference);
  // Under 50 cents the whole-dollar figure is $0, and "+$0" would say there was a change.
  if (difference === 0 || amount === "$0") return "Change from last edit: no change";
  return `Change from last edit: ${difference > 0 ? "+" : ""}${amount}`;
}

function BuildEstimate({
  inputs,
  evaluation,
  change,
}: {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  change: EstimateChange | null;
}) {
  const titleId = useId();
  const { estimate } = evaluation;
  const total: Cents | null = estimate.status === "ok" ? estimate.value.totalCents : null;
  const perSf: Cents | null = estimate.status === "ok" ? estimate.value.costPerFinishedSfCents : null;
  const tier = (TIER_NAMES as Record<string, string | undefined>)[inputs.house.finishes.houseTier];
  const changed = changeText(change);
  const { salePriceCents } = summarize(evaluation);
  return (
    <section
      aria-labelledby={titleId}
      aria-live="polite"
      className="flex flex-col gap-3 rounded-xl bg-spruce-dark p-5 text-paper"
    >
      <h2 id={titleId} className="m-0 text-sm font-semibold text-nav-text">
        Build estimate
      </h2>
      <div className="text-[32px] font-bold tracking-[-0.02em]">{formatMoney(total)}</div>
      <div className="text-sm text-nav-text">{`${formatMoney(perSf)} per finished sf${tier ? ` · ${tier} finishes` : ""}`}</div>
      {changed ? <div className="border-t border-[#2E433B] pt-3 text-sm text-[#E9D9C8]">{changed}</div> : null}
      {salePriceCents !== null ? (
        <p className="m-0 text-xs leading-normal text-[#A9B6B0]">
          {`Sale price holds at ${formatMoney(salePriceCents)} — your comps aren't tagged by finish level yet, so no premium is guessed.`}
        </p>
      ) : null}
    </section>
  );
}

function LiveTakeoff({ evaluation }: { evaluation: DealEvaluation }) {
  const { quantities } = evaluation;
  return (
    <Card title="Live takeoff" actions={<span className="text-xs text-muted">from your description</span>}>
      {quantities.status === "ok" ? (
        <dl className="m-0 flex flex-col">
          {takeoffRows(quantities.value).map((row) => (
            <div
              key={row.key}
              title={row.explain}
              className="flex justify-between gap-3 border-b border-[#EEF0EC] py-[7px] text-sm last:border-b-0"
            >
              <dt className="text-muted">{row.label}</dt>
              <dd className="m-0 text-right font-bold">
                <span>{row.value}</span>
                <span className="sr-only">{row.explain}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-sm text-muted">Fill in the house to see the takeoff.</p>
      )}
      <p className="m-0 text-xs leading-normal text-muted">Phase 2: these come from your drawn floor plan.</p>
    </Card>
  );
}

interface HouseSidePanelProps {
  dealId: string;
  /** The inputs the evaluation is of. */
  inputs: DealInputs;
  evaluation: DealEvaluation;
  change: EstimateChange | null;
}

/** The build estimate and how the last edit moved it, the takeoff behind it, and the way on. */
export function HouseSidePanel({ dealId, inputs, evaluation, change }: HouseSidePanelProps) {
  return (
    <aside aria-label="About this house" className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
      <BuildEstimate inputs={inputs} evaluation={evaluation} change={change} />
      <LiveTakeoff evaluation={evaluation} />
      <NextStepLink to={`/deals/${dealId}/estimate`}>Next: review the estimate →</NextStepLink>
    </aside>
  );
}
