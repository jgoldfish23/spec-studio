import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DealEditorContext, useDealEditorContext } from "./DealEditorContext";
import type { DealEditor } from "./useDealEditor";

const editor: DealEditor = {
  status: "loading",
  edit: () => undefined,
  rename: () => false,
  undo: () => undefined,
  redo: () => undefined,
  discardChanges: () => undefined,
  canUndo: false,
  canRedo: false,
  saveStatus: { kind: "saved" },
};

describe("useDealEditorContext", () => {
  it("returns the editor it is provided", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DealEditorContext.Provider value={editor}>{children}</DealEditorContext.Provider>
    );
    const { result } = renderHook(() => useDealEditorContext(), { wrapper });
    expect(result.current).toBe(editor);
  });

  it("says what is missing when there is no provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useDealEditorContext())).toThrow(/DealEditorContext/);
    spy.mockRestore();
  });
});
