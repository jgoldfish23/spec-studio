import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { evaluateDeal } from "@engine";
import type { DealEvaluation, DealInputs, EngineContext } from "@engine";
import { queryKeys, useDeal, useEngineContext, useRepository } from "../../data/queries";
import { DataError } from "../../data/types";
import type { StoredDeal } from "../../data/types";
import { createAutosaver } from "./autosaver";
import type { Autosaver, SaveStatus } from "./autosaver";
import { dealEditorReducer, initialEditorState } from "./dealEditorReducer";
import type { EditorAction, EditorState } from "./dealEditorReducer";
import { reportLostSave } from "./lostSaves";

/** How long after the last change the deal is evaluated again. */
export const EVALUATE_DELAY_MS = 150;

const SAVED: SaveStatus = { kind: "saved" };

export interface DealEditor {
  status: "loading" | "notFound" | "error" | "ready";
  /** Set when `status` is `"error"`. */
  error?: DataError;
  /** The deal as the owner sees it now: the latest name and inputs on top of what was last stored. Set when ready. */
  deal?: StoredDeal;
  /** The inputs being edited. Set when ready. */
  inputs?: DealInputs;
  /** The deal evaluated, up to 150 ms behind `inputs` while edits are coming in. Set when ready. */
  evaluation?: DealEvaluation;
  /** The inputs `evaluation` is of: `inputs` as they were when the deal was last evaluated. Set when ready. */
  evaluatedInputs?: DealInputs;
  /** What the engine was given besides the deal. Set when ready. */
  context?: EngineContext;
  edit(recipe: (draft: DealInputs) => void): void;
  /** Trims the name and keeps it. Returns false, changing nothing, when nothing is left or the deal is not loaded. */
  rename(name: string): boolean;
  undo(): void;
  redo(): void;
  /**
   * Gives up the save that is waiting (and any retry), for a deal that is about to be deleted: without it, the
   * autosave would write the deal back, or the editor's last save on the way out would. A save already running
   * finishes. Edits made after the call are saved as usual.
   */
  discardChanges(): void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
}

/** The reducer before any deal has loaded: it has no state, and a `reset` gives it one. */
function editorReducer(state: EditorState | null, action: EditorAction): EditorState | null {
  if (state === null) return action.type === "reset" ? initialEditorState(action.inputs) : null;
  return dealEditorReducer(state, action);
}

function toDataError(error: Error): DataError {
  return error instanceof DataError ? error : new DataError(error.message, { cause: error });
}

/**
 * The editor behind every step screen of one deal. It loads the deal once, keeps the owner's edits with an undo
 * history, evaluates the deal 150 ms after the last change, and saves 1 s after it (and again every 5 s while a
 * save keeps failing). Leaving the page saves what is waiting.
 */
export function useDealEditor(dealId: string): DealEditor {
  const repository = useRepository();
  const queryClient = useQueryClient();
  const dealQuery = useDeal(dealId);
  const stored = dealQuery.data ?? undefined;
  /** A successful read that is not about to be replaced by a refetch (an old cache entry is refetched on mount). */
  const settled = dealQuery.isSuccess && !dealQuery.isFetching;

  const [editor, dispatch] = useReducer(editorReducer, null);
  /** The deal the editor was seeded from, and the name it carries (the name is not part of the undo history). */
  const [seed, setSeed] = useState<{ dealId: string; name: string } | null>(null);
  /** The inputs the current evaluation is of. */
  const [evaluated, setEvaluated] = useState<DealInputs | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(SAVED);

  // Seed once per deal id, from the first settled read. A later read of the same deal (a refetch, a cache update
  // after a save) must never replace what the owner has changed since.
  if (settled && stored !== undefined && seed?.dealId !== dealId) {
    setSeed({ dealId, name: stored.name });
    dispatch({ type: "reset", inputs: stored.inputs });
    setEvaluated(stored.inputs);
    setSaveStatus(SAVED);
  }

  const seeded = seed?.dealId === dealId && editor !== null;
  const present = seeded ? editor.present : undefined;
  const name = seeded ? seed.name : undefined;

  const region = present?.lot.region;
  const engine = useEngineContext(region);
  const context = engine.data;

  // Evaluate straight away when the context arrives, and again 150 ms after the inputs last changed.
  useEffect(() => {
    if (present === undefined || present === evaluated) return;
    const timer = setTimeout(() => setEvaluated(present), EVALUATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [present, evaluated]);
  const evaluation = useMemo(
    () => (evaluated !== null && context !== undefined ? evaluateDeal(evaluated, context) : undefined),
    [evaluated, context],
  );

  // One autosaver per deal. Leaving the deal (or the page) saves what is waiting, without waiting for the answer.
  const autosaver = useRef<Autosaver<StoredDeal> | null>(null);
  useEffect(() => {
    const instance = createAutosaver<StoredDeal>({
      save: async (deal) => {
        const saved = await repository.saveDeal(deal);
        queryClient.setQueryData(queryKeys.deal(saved.id), saved);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deals });
        return saved;
      },
      onStatus: setSaveStatus,
      // The last save on the way out failed and nothing will retry it: the owner must be told, not left with "saved".
      onAbandoned: (deal, message) => {
        console.error(`Couldn't save deal ${deal.id}:`, message);
        reportLostSave({ dealId: deal.id, dealName: deal.name, message });
      },
    });
    autosaver.current = instance;
    return () => {
      autosaver.current = null;
      void instance.flush();
      instance.dispose();
    };
  }, [dealId, repository, queryClient]);

  const deal = useMemo<StoredDeal | undefined>(
    () => (stored !== undefined && present !== undefined && name !== undefined ? { ...stored, name, inputs: present } : undefined),
    [stored, present, name],
  );

  // Every change to the inputs or the name after the first load is saved. The first run for a deal is its baseline.
  const lastSeen = useRef<{ dealId: string; inputs: DealInputs; name: string } | null>(null);
  useEffect(() => {
    if (deal === undefined) return;
    const last = lastSeen.current;
    lastSeen.current = { dealId: deal.id, inputs: deal.inputs, name: deal.name };
    const changed = last !== null && last.dealId === deal.id && (last.inputs !== deal.inputs || last.name !== deal.name);
    if (changed) autosaver.current?.schedule(deal);
  }, [deal]);

  // A deal that was deleted elsewhere while it is open: the editor must not write it back, and is no longer ready.
  const missing = dealQuery.isSuccess && dealQuery.data === null;
  const deletedElsewhere = seeded && missing;
  /** Seeded and still there: the editor can be used. */
  const live = seeded && !missing;
  useEffect(() => {
    if (deletedElsewhere) autosaver.current?.discard();
  }, [deletedElsewhere]);

  const edit = useCallback((recipe: (draft: DealInputs) => void) => dispatch({ type: "edit", recipe }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const discardChanges = useCallback(() => autosaver.current?.discard(), []);
  const rename = useCallback(
    (newName: string): boolean => {
      const trimmed = newName.trim();
      if (trimmed === "" || !live) return false;
      setSeed((current) => (current === null || current.name === trimmed ? current : { ...current, name: trimmed }));
      return true;
    },
    [live],
  );

  // Once seeded, the editor owns the deal: a later failed or empty read of it is not the editor's problem. The
  // context is different: if it fails, the evaluation can no longer be trusted.
  const failure = (seeded ? null : dealQuery.error) ?? engine.error;
  const noRegion = region === "";
  const error = useMemo(() => {
    if (failure) return toDataError(failure);
    if (noRegion) {
      return new DataError("This deal has no region, so its prices and comps cannot be loaded.", {
        recordId: dealId,
        path: "inputs.lot.region",
      });
    }
    return undefined;
  }, [failure, noRegion, dealId]);

  let status: DealEditor["status"] = "loading";
  if (error) status = "error";
  else if (missing) status = "notFound";
  else if (seeded && context !== undefined && evaluation !== undefined) status = "ready";
  const isReady = status === "ready";

  return useMemo<DealEditor>(
    () => ({
      status,
      error,
      deal: isReady ? deal : undefined,
      inputs: isReady ? present : undefined,
      evaluation: isReady ? evaluation : undefined,
      evaluatedInputs: isReady ? (evaluated ?? undefined) : undefined,
      context: isReady ? context : undefined,
      edit,
      rename,
      undo,
      redo,
      discardChanges,
      canUndo: live && editor.past.length > 0,
      canRedo: live && editor.future.length > 0,
      saveStatus,
    }),
    [status, error, isReady, deal, present, evaluation, evaluated, context, edit, rename, undo, redo, discardChanges, live, editor, saveStatus],
  );
}
