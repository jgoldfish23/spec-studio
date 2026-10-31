import type { DealEvaluation, DealInputs } from "@engine";
import { BlockedNote } from "../deal/BlockedNote";
import { useDealEditorContext } from "../deal/DealEditorContext";
import { fieldError } from "../deal/fieldErrors";
import { NextStepLink } from "../deal/NextStepLink";
import { estimateBlocker } from "../deal/summary";
import { CostLinesCard } from "./CostLinesCard";
import type { Edit } from "../deal/stepShared";
import { BidsNextCard, BuildEstimateCard, ConfidenceCard } from "./SummaryCards";

interface EstimateScreenProps {
  dealId: string;
  inputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

function EstimateScreen({ dealId, inputs, evaluation, edit }: EstimateScreenProps) {
  const estimate = evaluation.estimate.status === "ok" ? evaluation.estimate.value : null;
  // A problem with the deal (on this step or another) stops the estimate: every card says what to fix, not that prices
  // are missing.
  const blocker = estimateBlocker(evaluation);
  const blocked = blocker ? <BlockedNote dealId={dealId} item={blocker} /> : undefined;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Estimate</h1>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
        <BuildEstimateCard
          estimate={estimate}
          contingencyPct={inputs.contingencyPct}
          houseTier={inputs.house.finishes.houseTier}
          contingencyError={fieldError(evaluation, "contingencyPct")}
          onContingencyChange={(rate) => edit((draft) => void (draft.contingencyPct = rate))}
        />
        <ConfidenceCard estimate={estimate} blocked={blocked} />
        <BidsNextCard estimate={estimate} blocked={blocked} />
      </div>
      <CostLinesCard dealId={dealId} evaluation={evaluation} edit={edit} blocked={blocked} />
      <div className="flex justify-end">
        <NextStepLink to={`/deals/${dealId}/market`}>Next: check the market →</NextStepLink>
      </div>
    </div>
  );
}

/**
 * Step 3 of 5: the estimate. The build estimate with its contingency, how much of it rests on real bids, the lines
 * still worth bidding, and every cost line by division with where its price came from. Bids are added, changed and
 * removed here and go into the deal through the editor; every figure is the engine's.
 */
export function EstimatePage() {
  const { status, deal, inputs, evaluation, edit } = useDealEditorContext();
  // The layout draws the loading, not-found and error states; this screen is only ever shown for a ready deal.
  if (status !== "ready" || deal === undefined || inputs === undefined || evaluation === undefined) return null;
  return <EstimateScreen dealId={deal.id} inputs={inputs} evaluation={evaluation} edit={edit} />;
}
