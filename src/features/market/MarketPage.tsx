import { useMemo } from "react";
import type { DealEvaluation, DealInputs, EngineContext } from "@engine";
import { useDealEditorContext } from "../deal/DealEditorContext";
import { NextStepLink } from "../deal/NextStepLink";
import type { Edit } from "../estimate/shared";
import { CompsCard } from "./CompsCard";
import { DomCard } from "./DomCard";
import { listingMonthOf } from "./marketFormat";
import { OverridesCard } from "./OverridesCard";
import { PriceCard } from "./PriceCard";

interface MarketScreenProps {
  dealId: string;
  inputs: DealInputs;
  /** The inputs `evaluation` is of, which can be a moment behind `inputs` while edits are coming in. */
  evaluatedInputs: DealInputs;
  evaluation: DealEvaluation;
  context: EngineContext;
  edit: Edit;
}

function MarketScreen({ dealId, inputs, evaluatedInputs, evaluation, context, edit }: MarketScreenProps) {
  // The month comes from the inputs the estimate was worked out on, and only once it was: an estimate means the deal
  // was valid, so its timeline can be read. An estimate that is not there has no month to name.
  const listMonth = useMemo(
    () => (evaluation.dom.status === "ok" ? listingMonthOf(evaluatedInputs.timeline) : null),
    [evaluation, evaluatedInputs],
  );
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Market</h1>
      <OverridesCard inputs={inputs} evaluation={evaluation} edit={edit} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-4">
        <PriceCard price={evaluation.price} />
        <DomCard dom={evaluation.dom} listMonth={listMonth} />
      </div>
      <p className="m-0 text-sm text-muted">
        Market condition: Normal · seasonality and condition settings arrive with Settings (later).
      </p>
      <CompsCard inputs={inputs} evaluation={evaluation} context={context} edit={edit} />
      <div className="flex justify-end">
        <NextStepLink to={`/deals/${dealId}/proforma`}>Next: see the pro forma →</NextStepLink>
      </div>
    </div>
  );
}

/**
 * Step 4 of 5: the market. The owner's own base price, days on market and planned list price; the sale price and days
 * on market the comps point to; and the comps themselves, which are added, edited and deleted here and chosen in or
 * out for this deal. Every figure is the engine's.
 */
export function MarketPage() {
  const { status, deal, inputs, evaluatedInputs, evaluation, context, edit } = useDealEditorContext();
  // The layout draws the loading, not-found and error states; this screen is only ever shown for a ready deal.
  if (
    status !== "ready" ||
    deal === undefined ||
    inputs === undefined ||
    evaluatedInputs === undefined ||
    evaluation === undefined ||
    context === undefined
  ) {
    return null;
  }
  return (
    <MarketScreen
      dealId={deal.id}
      inputs={inputs}
      evaluatedInputs={evaluatedInputs}
      evaluation={evaluation}
      context={context}
      edit={edit}
    />
  );
}
