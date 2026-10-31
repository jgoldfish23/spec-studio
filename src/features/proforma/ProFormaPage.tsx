import { useState } from "react";
import type { DealEvaluation, DealInputs, ScenarioName } from "@engine";
import { useDealEditorContext } from "../deal/DealEditorContext";
import type { Edit } from "../deal/stepShared";
import { FOCUS_RING } from "../deal/stepShared";
import { CarryingCard } from "./CarryingCard";
import { CashFlowCard } from "./CashFlowCard";
import { FinancingCard } from "./FinancingCard";
import { ProfitGridCard } from "./ProfitGridCard";
import { RulesCard } from "./RulesCard";
import { ScenariosCard } from "./ScenariosCard";
import { SellingCard } from "./SellingCard";
import { TimelineCard } from "./TimelineCard";
import { VerdictPanel } from "./VerdictPanel";

/** What stands in for the scenarios, timeline, grid and month by month table while the engine cannot work them out. */
function NumbersWait() {
  return (
    <p className="m-0 rounded-xl border border-dashed border-[#B8BEB9] bg-surface px-5 py-4 text-sm text-muted">
      The numbers appear once the missing details are filled in.
    </p>
  );
}

/** The disabled button for the lender's PDF, which comes later. */
function LenderPackage() {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        disabled
        className={`inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-[#DCDFD9] bg-paper px-3.5 text-sm font-semibold text-muted ${FOCUS_RING}`}
      >
        Lender package (PDF)
        <span className="rounded border border-[#B8BEB9] px-1.5 py-px text-[11px] font-medium">Later</span>
      </button>
    </div>
  );
}

interface ProFormaScreenProps {
  dealId: string;
  inputs: DealInputs;
  /** The inputs `evaluation` is of, which can be a moment behind `inputs` while edits are coming in. */
  evaluatedInputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

function ProFormaScreen({ dealId, inputs, evaluatedInputs, evaluation, edit }: ProFormaScreenProps) {
  const [scenario, setScenario] = useState<ScenarioName>("base");
  const { scenarios, grid } = evaluation;
  // The numbers are the evaluation's, so everything computed reads the inputs the evaluation was worked out from.
  const result = scenarios.status === "ok" ? scenarios.value[scenario] : null;
  const baseResult = scenarios.status === "ok" ? scenarios.value.base : null;
  const landClose = evaluatedInputs.timeline.landClose;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Pro forma</h1>
      <VerdictPanel dealId={dealId} verdict={evaluation.verdict} goalSeek={evaluation.goalSeek} />

      {result !== null && baseResult !== null ? (
        <>
          <ScenariosCard scenario={scenario} onScenario={setScenario} result={result} inputs={evaluatedInputs} />
          <TimelineCard scenario={scenario} result={result} landClose={landClose} />
          {grid !== null ? (
            <ProfitGridCard
              grid={grid}
              basePriceCents={baseResult.metrics.salePriceCents}
              breakEvenDomDays={evaluation.breakEvenDomDays}
            />
          ) : null}
        </>
      ) : (
        <NumbersWait />
      )}

      <div className="flex flex-col gap-4">
        <h2 className="m-0 text-[17px] font-bold">Assumptions</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <FinancingCard inputs={inputs} evaluation={evaluation} edit={edit} />
          </div>
          <SellingCard inputs={inputs} evaluation={evaluation} edit={edit} />
          <CarryingCard inputs={inputs} evaluation={evaluation} edit={edit} />
          <div className="lg:col-span-2">
            <RulesCard rules={inputs.rules} />
          </div>
        </div>
      </div>

      {result !== null ? <CashFlowCard result={result} landClose={landClose} /> : null}
      <LenderPackage />
    </div>
  );
}

/**
 * Step 5 of 5: the pro forma, where the owner sees whether the deal makes money and why. The verdict against the
 * owner's rules and what would make it a Go; the scenario of their choice as a waterfall, headline figures, a timeline
 * and a month by month schedule; the profit grid; and the loan, selling and carrying assumptions, which are edited here.
 * Every figure is the engine's.
 */
export function ProFormaPage() {
  const { status, deal, inputs, evaluatedInputs, evaluation, edit } = useDealEditorContext();
  // The layout draws the loading, not-found and error states; this screen is only ever shown for a ready deal.
  if (status !== "ready" || deal === undefined || inputs === undefined || evaluatedInputs === undefined || evaluation === undefined) {
    return null;
  }
  return <ProFormaScreen dealId={deal.id} inputs={inputs} evaluatedInputs={evaluatedInputs} evaluation={evaluation} edit={edit} />;
}
