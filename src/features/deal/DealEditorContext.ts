import { createContext, useContext } from "react";
import type { DealEditor } from "./useDealEditor";

/** The open deal's editor, for the step screens under it. The deal page provides the value of `useDealEditor`. */
export const DealEditorContext = createContext<DealEditor | null>(null);

export function useDealEditorContext(): DealEditor {
  const editor = useContext(DealEditorContext);
  if (editor === null) throw new Error("useDealEditorContext must be used inside a <DealEditorContext.Provider>.");
  return editor;
}
