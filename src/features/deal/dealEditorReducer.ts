import type { DealInputs } from "@engine";

/** How many steps back the owner can undo. */
export const HISTORY_LIMIT = 100;

export interface EditorState {
  present: DealInputs;
  /** Oldest first; the last entry is what undo goes back to. */
  past: DealInputs[];
  /** Nearest first; the first entry is what redo goes forward to. */
  future: DealInputs[];
}

export type EditorAction =
  | { type: "edit"; recipe: (draft: DealInputs) => void }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; inputs: DealInputs };

/** An editor on `inputs` with no history. */
export function initialEditorState(inputs: DealInputs): EditorState {
  return { present: inputs, past: [], future: [] };
}

// Inputs are plain JSON (numbers, strings, booleans, arrays and objects), so their JSON text says whether two are the same.
const sameInputs = (a: DealInputs, b: DealInputs): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The deal editor's state machine. Every state it returns is a new object, never an old one changed in place; an
 * action that changes nothing returns the state it was given, so a caller can tell that nothing happened.
 */
export function dealEditorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edit": {
      // The recipe works on a copy, so it can never reach the state that undo will restore.
      const next = structuredClone(state.present);
      action.recipe(next);
      if (sameInputs(next, state.present)) return state;
      return { present: next, past: [...state.past, state.present].slice(-HISTORY_LIMIT), future: [] };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (previous === undefined) return state;
      return { present: previous, past: state.past.slice(0, -1), future: [state.present, ...state.future] };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (next === undefined) return state;
      return { present: next, past: [...state.past, state.present], future: rest };
    }
    case "reset":
      return initialEditorState(action.inputs);
  }
}
