import { useParams } from "react-router";
import { DealCrashBoundary } from "./DealCrashBoundary";
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
 * the id changes). An engine exception never reaches this far: the editor catches it and the layout says "Couldn't
 * calculate" with the deal still usable. The boundary here is for a bug in drawing the deal's frame; the editor's last
 * save on the way out still stores what was waiting, and the rest of the app keeps working.
 */
export function DealRoute() {
  const { dealId = "" } = useParams();
  return (
    <DealCrashBoundary key={dealId}>
      <DealEditorHost key={dealId} dealId={dealId} />
    </DealCrashBoundary>
  );
}
