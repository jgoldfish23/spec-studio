import { useParams } from "react-router";
import { useDeal } from "../../data/queries";
import { CalcErrorBoundary } from "../../ui/CalcErrorBoundary";
import { DealEditorContext } from "./DealEditorContext";
import { DealLayout } from "./DealLayout";
import { useDealEditor } from "./useDealEditor";

/** Opens one deal: its editor, shared with the layout and the step screens under it. */
function DealEditorHost({ dealId }: { dealId: string }) {
  const editor = useDealEditor(dealId);
  return (
    <DealEditorContext.Provider value={editor}>
      <DealLayout dealId={dealId} />
    </DealEditorContext.Provider>
  );
}

/**
 * The route element for `/deals/:dealId`. Every deal gets its own editor (the editor does not reset its state when
 * the id changes), and the editor sits inside a boundary: if the engine throws while the editor evaluates the deal,
 * the screen says "Couldn't calculate", the editor's last save on the way out still stores what was waiting, and the
 * rest of the app keeps working.
 */
export function DealRoute() {
  const { dealId = "" } = useParams();
  const stored = useDeal(dealId).data;
  return (
    <CalcErrorBoundary key={dealId} input={stored?.inputs ?? dealId}>
      <DealEditorHost key={dealId} dealId={dealId} />
    </CalcErrorBoundary>
  );
}
