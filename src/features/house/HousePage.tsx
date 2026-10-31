import { useMemo } from "react";
import type { DealEvaluation, DealInputs, EngineContext } from "@engine";
import { useDealEditorContext } from "../deal/DealEditorContext";
import { estimateBlocker } from "../deal/summary";
import { ExteriorCard } from "./ExteriorCard";
import { ExtrasCard } from "./ExtrasCard";
import { FinishesCard } from "./FinishesCard";
import { FootprintCard } from "./FootprintCard";
import { HouseSidePanel } from "./HouseSidePanel";
import { SizeCard } from "./SizeCard";
import { StartFromCard } from "./StartFromCard";
import type { Edit } from "./shared";
import { tierPreview } from "./tierPreview";
import { useEstimateChange } from "./useEstimateChange";

interface HouseScreenProps {
  dealId: string;
  inputs: DealInputs;
  /** The inputs `evaluation` is of, which trail `inputs` by up to 150 ms. */
  evaluatedInputs: DealInputs;
  evaluation: DealEvaluation;
  context: EngineContext;
  edit: Edit;
}

function HouseScreen({ dealId, inputs, evaluatedInputs, evaluation, context, edit }: HouseScreenProps) {
  const { house } = inputs;
  // The three tiers are priced once per evaluation (two engine runs: the current tier's is the evaluation itself),
  // never per keystroke or per draw. They are of the evaluated deal, so they and the build estimate agree.
  const previews = useMemo(
    () => tierPreview(evaluatedInputs, context, { tier: evaluatedInputs.house.finishes.houseTier, evaluation }),
    [evaluatedInputs, evaluation, context],
  );
  const total = evaluation.estimate.status === "ok" ? evaluation.estimate.value.totalCents : null;
  const change = useEstimateChange(evaluatedInputs, total);
  // A problem on another step stops the estimate; the house's own problems show under its boxes.
  const blocker = estimateBlocker(evaluation, "house");
  return (
    <div className="flex flex-wrap items-start gap-6">
      <h1 className="sr-only">House</h1>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
        <StartFromCard house={house} evaluation={evaluation} edit={edit} />
        <SizeCard house={house} evaluation={evaluation} edit={edit} />
        <FootprintCard house={house} evaluation={evaluation} edit={edit} />
        <ExteriorCard house={house} evaluation={evaluation} edit={edit} />
        <FinishesCard house={house} evaluation={evaluation} edit={edit} previews={previews} dealId={dealId} blocker={blocker} />
        <ExtrasCard house={house} evaluation={evaluation} edit={edit} />
      </div>
      <HouseSidePanel dealId={dealId} inputs={evaluatedInputs} evaluation={evaluation} change={change} blocker={blocker} />
    </div>
  );
}

/**
 * Step 2 of 5: the house. Six cards of fields on the left (where the house comes from, its size and levels, the
 * footprint, roof and rooms, the exterior mix, the finishes, and the extras outside), and on the right the build
 * estimate, the takeoff it comes from, and the way on. Every field writes the deal through the editor; the messages
 * under the fields are the engine's own.
 */
export function HousePage() {
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
    <HouseScreen
      dealId={deal.id}
      inputs={inputs}
      evaluatedInputs={evaluatedInputs}
      evaluation={evaluation}
      context={context}
      edit={edit}
    />
  );
}
