import { useState } from "react";
import type { Cents, DealInputs } from "@engine";

/** The estimate total before and after the most recent edit. Either is null when the estimate was incomplete. */
export interface EstimateChange {
  before: Cents | null;
  after: Cents | null;
}

interface Tracked {
  /** The inputs the total is of. */
  inputs: DealInputs;
  total: Cents | null;
  change: EstimateChange | null;
}

/**
 * How the estimate total moved with the most recent edit, or null before any edit. `inputs` is what the current
 * evaluation is of (the editor's `evaluatedInputs`) and `total` is the estimate total in it. The inputs the screen
 * opens with are the starting point, not an edit; a later set of inputs (an edit, an undo, a redo) is one edit,
 * however many keystrokes went into it.
 */
export function useEstimateChange(inputs: DealInputs, total: Cents | null): EstimateChange | null {
  const [tracked, setTracked] = useState<Tracked>({ inputs, total, change: null });
  // Adjusting state while rendering (React's way to follow a prop without an effect, which would draw a stale frame).
  if (tracked.inputs !== inputs) {
    setTracked({ inputs, total, change: { before: tracked.total, after: total } });
  } else if (tracked.total !== total) {
    // The same deal priced differently (new prices came in), which is not an edit: only the starting point moves.
    setTracked({ ...tracked, total });
  }
  return tracked.change;
}
