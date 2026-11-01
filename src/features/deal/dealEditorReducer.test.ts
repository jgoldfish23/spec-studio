import { describe, expect, it } from "vitest";
import type { DealInputs } from "@engine";
import { sampleDealInputs } from "../../data/sample";
import { dealEditorReducer, HISTORY_LIMIT, initialEditorState } from "./dealEditorReducer";
import type { EditorState } from "./dealEditorReducer";

const setPrice = (cents: number) => (draft: DealInputs) => {
  draft.lot.priceCents = cents;
};

/** Freezes a value and everything inside it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const start = (): EditorState => initialEditorState(sampleDealInputs());
const price = (state: EditorState): number => state.present.lot.priceCents;

describe("dealEditorReducer", () => {
  it("edit, undo, redo restores each step", () => {
    const original = price(start());
    const s0 = start();
    const s1 = dealEditorReducer(s0, { type: "edit", recipe: setPrice(25_400_000) });
    expect(price(s1)).toBe(25_400_000);
    expect(s1.past).toHaveLength(1);

    const s2 = dealEditorReducer(s1, { type: "undo" });
    expect(price(s2)).toBe(original);
    expect(s2.past).toHaveLength(0);
    expect(s2.future).toHaveLength(1);

    const s3 = dealEditorReducer(s2, { type: "redo" });
    expect(price(s3)).toBe(25_400_000);
    expect(s3.past).toHaveLength(1);
    expect(s3.future).toHaveLength(0);
  });

  it("walks back through several edits one step at a time", () => {
    let state = start();
    const original = price(state);
    for (const cents of [1_000_000, 2_000_000, 3_000_000]) {
      state = dealEditorReducer(state, { type: "edit", recipe: setPrice(cents) });
    }
    state = dealEditorReducer(state, { type: "undo" });
    expect(price(state)).toBe(2_000_000);
    state = dealEditorReducer(state, { type: "undo" });
    expect(price(state)).toBe(1_000_000);
    state = dealEditorReducer(state, { type: "undo" });
    expect(price(state)).toBe(original);
    state = dealEditorReducer(state, { type: "redo" });
    expect(price(state)).toBe(1_000_000);
  });

  it("clears the redo stack when an edit follows an undo", () => {
    let state = start();
    state = dealEditorReducer(state, { type: "edit", recipe: setPrice(1_000_000) });
    state = dealEditorReducer(state, { type: "edit", recipe: setPrice(2_000_000) });
    state = dealEditorReducer(state, { type: "undo" });
    expect(state.future).toHaveLength(1);

    state = dealEditorReducer(state, { type: "edit", recipe: setPrice(9_000_000) });
    expect(state.future).toEqual([]);
    expect(price(state)).toBe(9_000_000);
    // Redo has nothing to redo now: the abandoned 2,000,000 is gone.
    const afterRedo = dealEditorReducer(state, { type: "redo" });
    expect(afterRedo).toBe(state);
  });

  it("keeps at most 100 past states and drops the oldest", () => {
    let state = start();
    const original = price(state);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) {
      state = dealEditorReducer(state, { type: "edit", recipe: setPrice(original + i) });
    }
    expect(HISTORY_LIMIT).toBe(100);
    expect(state.past).toHaveLength(100);
    // 120 edits push 120 states, and the oldest 20 fall off. What stays is the present before edits 21 to 120,
    // so the prices run from original + 20 up to original + 119.
    expect(state.past[0]?.lot.priceCents).toBe(original + 20);
    expect(state.past.at(-1)?.lot.priceCents).toBe(original + 119);
    expect(price(state)).toBe(original + 120);
  });

  it("never mutates the previous state", () => {
    const before = deepFreeze(start());
    const snapshot = structuredClone(before);

    // A write to a frozen object throws in strict mode, so a recipe that reached the old state would fail here.
    const after = dealEditorReducer(before, {
      type: "edit",
      recipe: (draft) => {
        draft.lot.priceCents = 1;
        draft.lot.utilities.water = "available";
        draft.bids.push({ code: "framing", amountCents: 100 } as DealInputs["bids"][number]);
      },
    });

    expect(before).toEqual(snapshot);
    expect(after.present).not.toBe(before.present);
    // The old present moves to the history as the very same object, untouched.
    expect(Object.is(after.past.at(-1), before.present)).toBe(true);
    expect(after.past.at(-1)).toEqual(snapshot.present);
    // Every branch is a copy: nothing is shared with the state it came from, touched or not.
    expect(after.present.house).toEqual(before.present.house);
    expect(Object.is(after.present.house, before.present.house)).toBe(false);
    expect(Object.is(after.present.timeline, before.present.timeline)).toBe(false);
  });

  it("returns the same state when an edit changes nothing", () => {
    const state = start();
    expect(dealEditorReducer(state, { type: "edit", recipe: () => undefined })).toBe(state);
    expect(dealEditorReducer(state, { type: "edit", recipe: setPrice(price(state)) })).toBe(state);
    // An edit that is undone inside the same recipe is no change either.
    const touched = dealEditorReducer(state, {
      type: "edit",
      recipe: (draft) => {
        const original = draft.lot.priceCents;
        draft.lot.priceCents = 5;
        draft.lot.priceCents = original;
      },
    });
    expect(touched).toBe(state);
  });

  it("returns the same state for an undo or redo with nothing to go to", () => {
    const state = start();
    expect(dealEditorReducer(state, { type: "undo" })).toBe(state);
    expect(dealEditorReducer(state, { type: "redo" })).toBe(state);
  });

  it("reset replaces the inputs and clears the history", () => {
    let state = start();
    state = dealEditorReducer(state, { type: "edit", recipe: setPrice(1_000_000) });
    state = dealEditorReducer(state, { type: "edit", recipe: setPrice(2_000_000) });
    state = dealEditorReducer(state, { type: "undo" });
    expect(state.past).toHaveLength(1);
    expect(state.future).toHaveLength(1);

    const fresh = sampleDealInputs();
    fresh.lot.priceCents = 7_700_000;
    const reset = dealEditorReducer(state, { type: "reset", inputs: fresh });
    expect(reset).toEqual({ present: fresh, past: [], future: [] });
  });
});
