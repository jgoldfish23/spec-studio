import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { evaluateDeal, failedEvaluation } from "@engine";
import type { DealEvaluation, DealInputs, EngineContext } from "@engine";
import { queryKeys, useDeal, useEngineContext, useRepository } from "../../data/queries";
import { isOfflineRepository } from "../../data/offline/offlineRepository";
import { DataError } from "../../data/types";
import type { StoredDeal } from "../../data/types";
import { errorMessage } from "../../lib/errorMessage";
import { inputHash } from "../../lib/inputHash";
import { createAutosaver, needsChoice } from "./autosaver";
import type { Autosaver, SaveFailureReason, SaveStatus } from "./autosaver";
import { dealEditorReducer, initialEditorState } from "./dealEditorReducer";
import type { EditorAction, EditorState } from "./dealEditorReducer";
import { reportLostSave } from "./lostSaves";

/** How long after the last change the deal is evaluated again. */
export const EVALUATE_DELAY_MS = 150;

const SAVED: SaveStatus = { kind: "saved" };

/** Failures whose edits are safe in the outbox on this device: closing the page loses nothing, so it need not ask. */
const SAFE_ON_DEVICE: readonly SaveFailureReason[] = ["offline", "signedOut"];

/** Failures that retrying cannot fix: they wait for the owner's choice (or the next edit). */
const NEEDS_A_CHOICE = (error: unknown): boolean => error instanceof DataError && needsChoice(error.kind);

/** What a failed evaluation's items say: the deal could not be worked out, which is not something the owner left out. */
const FAILED_EVALUATION = "Couldn't calculate this deal";

/** Why the engine could not evaluate the deal as it is now: the exception's message and a hash of the inputs it was given. */
export interface EvaluationError {
  message: string;
  inputHash: string;
}

/** One evaluation of the deal: the engine's answer, or, when the engine threw, a stand-in and what went wrong. */
interface Outcome {
  evaluation: DealEvaluation;
  error?: EvaluationError;
  thrown?: unknown;
}

export interface DealEditor {
  status: "loading" | "notFound" | "error" | "ready";
  /** Set when `status` is `"error"`. */
  error?: DataError;
  /**
   * True when the error is the deal's own record not reading back (or having no region): the one failure that deleting
   * the deal can fix. A failure to reach the server, or to read what the deal needs besides itself (its comps, cost
   * book, settings), is not.
   */
  recordUnreadable?: boolean;
  /** The deal as the owner sees it now: the latest name and inputs on top of what was last stored. Set when ready. */
  deal?: StoredDeal;
  /** The inputs being edited. Set when ready. */
  inputs?: DealInputs;
  /**
   * The deal evaluated, up to 150 ms behind `inputs` while edits are coming in. Set when ready. When the engine threw,
   * it is `failedEvaluation` (every step incomplete) and `evaluationError` says what happened.
   */
  evaluation?: DealEvaluation;
  /** Set when ready and the engine threw on the inputs `evaluation` is of (a bug, spec §8). */
  evaluationError?: EvaluationError;
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
  /**
   * Starts saving what is waiting now, without waiting for the autosave's second: for a page that is closing. With an
   * outbox, the newest edit is also written to it first, since a save already running would otherwise hold it back.
   */
  saveNow(): void;
  /** True while `loadTheirs` or `saveAsNewDeal` runs: edits, undo and redo do nothing until it is over. */
  busy: boolean;
  /**
   * After a conflict: saves this device's version on top of the version the conflict found stored. It is still checked
   * like any save, so a change made elsewhere after that version is a conflict again, never overwritten.
   */
  keepMine(): void;
  /** After a conflict: drops this device's changes (and its outbox entry) and shows what is stored. */
  loadTheirs(): Promise<void>;
  /** After a deletion elsewhere: gives up what is waiting, here and in the outbox, for "Discard my changes". */
  discardDeletedDeal(): void;
  /** After a deletion elsewhere: stores the deal as it is now under a new id, and returns the id. */
  saveAsNewDeal(): Promise<string>;
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
 * save keeps failing). Leaving the deal, or hiding or closing the page, saves what is waiting. If the engine throws,
 * the editor stays ready with `failedEvaluation` and says why in `evaluationError`.
 */
export function useDealEditor(dealId: string): DealEditor {
  const repository = useRepository();
  const queryClient = useQueryClient();
  const dealQuery = useDeal(dealId);
  const stored = dealQuery.data ?? undefined;
  /** A successful read that is not about to be replaced by a refetch (an old cache entry is refetched on mount). */
  const settled = dealQuery.isSuccess && !dealQuery.isFetching;

  const [editor, dispatch] = useReducer(editorReducer, null);
  /** The deal the editor was seeded from and the name it carries (the name is not part of the undo history), with the `updatedAt` it was read at. */
  const [seed, setSeed] = useState<{ dealId: string; name: string; updatedAt: string } | null>(null);
  /** The inputs the current evaluation is of. */
  const [evaluated, setEvaluated] = useState<DealInputs | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(SAVED);
  /** `loadTheirs` or `saveAsNewDeal` is running: the editor ignores edits so none can slip in behind the choice. */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const statusRef = useRef<SaveStatus>(SAVED);
  useEffect(() => {
    statusRef.current = saveStatus;
  }, [saveStatus]);
  /** Why the last save failed, until one works: edits made, saving or waiting in the meantime are still at risk. */
  const [failedWith, setFailedWith] = useState<SaveFailureReason | null>(null);
  /**
   * The `updatedAt` the next save of each deal is made from (a late save of one deal must not touch another's): the one the editor was seeded with, then the one each save returned.
   * A save is checked against the stored `updatedAt`, and the deal an edit was scheduled with may be older than the
   * last save (it was built while that save ran), so every save is stamped from here, not from the deal's own copy.
   */
  const baseline = useRef(new Map<string, string>());
  /** Per deal, the stored `updatedAt` the last conflict found: the version "Keep mine" saves on top of. */
  const theirs = useRef(new Map<string, string>());

  // Seed once per deal id, from the first settled read. A later read of the same deal (a refetch, a cache update
  // after a save) must never replace what the owner has changed since.
  if (settled && stored !== undefined && seed?.dealId !== dealId) {
    setSeed({ dealId, name: stored.name, updatedAt: stored.updatedAt });
    dispatch({ type: "reset", inputs: stored.inputs });
    setEvaluated(stored.inputs);
    setSaveStatus(SAVED);
    setFailedWith(null);
  }

  const seedId = seed?.dealId;
  const seedStamp = seed?.updatedAt;
  useEffect(() => {
    if (seedId !== undefined && seedStamp !== undefined) baseline.current.set(seedId, seedStamp);
  }, [seedId, seedStamp]);

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
  // An engine that throws must not take the deal down with it: the frame, the tabs, undo and every field stay usable,
  // and the owner is told "Couldn't calculate" until an undo or another change gives inputs the engine can work out.
  const outcome = useMemo<Outcome | undefined>(() => {
    if (evaluated === null || context === undefined) return undefined;
    try {
      return { evaluation: evaluateDeal(evaluated, context) };
    } catch (thrown) {
      return {
        evaluation: failedEvaluation(FAILED_EVALUATION),
        error: { message: errorMessage(thrown), inputHash: inputHash(evaluated) },
        thrown,
      };
    }
  }, [evaluated, context]);
  const evaluation = outcome?.evaluation;
  const evaluationError = outcome?.error;

  // The console hears about each failure once: the same inputs failing again (after an undo and a redo) add nothing.
  const reported = useRef(new Set<string>());
  useEffect(() => {
    if (outcome?.error === undefined || reported.current.has(outcome.error.inputHash)) return;
    reported.current.add(outcome.error.inputHash);
    console.error(`Couldn't calculate deal ${dealId} (input hash ${outcome.error.inputHash}):`, outcome.thrown);
  }, [outcome, dealId]);

  /**
   * Saves what is waiting now. A save already running keeps the autosaver from starting the newest value, and a closing
   * page gets no later turn, so with an outbox the newest value is first written to it (synchronously, no network
   * call), stamped with the editor's baseline for the deal, as a save would be.
   */
  const flushNow = useCallback(
    (instance: Autosaver<StoredDeal>) => {
      // While a version is being chosen, what is waiting is the old device's: it must not reach the outbox or the store.
      if (busyRef.current) return;
      const waiting = instance.pending();
      if (waiting !== undefined && isOfflineRepository(repository)) {
        repository.queue({ ...waiting, updatedAt: baseline.current.get(waiting.id) ?? waiting.updatedAt });
      }
      void instance.flush();
    },
    [repository],
  );

  // One autosaver per deal. Leaving the deal (or the page) saves what is waiting, without waiting for the answer.
  const autosaver = useRef<Autosaver<StoredDeal> | null>(null);
  useEffect(() => {
    const instance = createAutosaver<StoredDeal>({
      save: async (deal) => {
        const from = baseline.current.get(deal.id) ?? deal.updatedAt;
        let saved: StoredDeal;
        try {
          saved = await repository.saveDeal({ ...deal, updatedAt: from });
        } catch (error) {
          if (error instanceof DataError && error.kind === "conflict" && error.storedUpdatedAt !== undefined) {
            theirs.current.set(deal.id, error.storedUpdatedAt);
          }
          throw error;
        }
        baseline.current.set(saved.id, saved.updatedAt);
        queryClient.setQueryData(queryKeys.deal(saved.id), saved);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deals });
        return saved;
      },
      shouldRetry: (error) => !NEEDS_A_CHOICE(error),
      onStatus: (reported) => {
        // Without an outbox, offline and signed-out edits are not safe on the device: they are failures like any other.
        const status: SaveStatus =
          reported.kind === "error" && SAFE_ON_DEVICE.includes(reported.reason) && !isOfflineRepository(repository)
            ? { ...reported, reason: "failed" }
            : reported;
        setSaveStatus(status);
        if (status.kind === "error") setFailedWith(status.reason);
        else if (status.kind === "saved") setFailedWith(null);
      },
      // The last save on the way out failed and nothing will retry it: the owner must be told, not left with "saved".
      onAbandoned: (deal, message, reason) => {
        // With an outbox, an offline or signed-out edit is on the device and will sync: nothing was lost.
        if (SAFE_ON_DEVICE.includes(reason) && isOfflineRepository(repository)) return;
        console.error(`Couldn't save deal ${deal.id}:`, message);
        reportLostSave({ dealId: deal.id, dealName: deal.name, message });
      },
    });
    autosaver.current = instance;
    // A page that is closed, reloaded or hidden may never run another timer, so whatever is waiting is saved now. The
    // autosaver starts the save inside this call (the repository's `saveDeal` runs before `flush` returns), which is
    // all a closing page is given. If a save is already running, that one and then the newest value are what can be
    // done. (`beforeunload` is only for asking, below, while saves are failing.)
    const saveNow = () => flushNow(instance);
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      autosaver.current = null;
      flushNow(instance);
      instance.dispose();
    };
  }, [dealId, repository, queryClient, flushNow]);

  // While saves keep failing, closing the page would lose what is not saved: the browser asks first. That holds through
  // the edits, waits and retries in between failures (the status is then pending or saving, not error), until a save
  // works.
  const savesFailing = failedWith !== null && !SAFE_ON_DEVICE.includes(failedWith);
  useEffect(() => {
    if (!savesFailing) return;
    const askFirst = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only when this is set.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", askFirst);
    return () => window.removeEventListener("beforeunload", askFirst);
  }, [savesFailing]);

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

  // A deal opened from its outbox entry (after an offline reload, or one the server refused) holds an edit the server
  // does not have. It is sent again through the normal path, once per autosaver, so the status says what really
  // happens to it (the offline or signed-out note, the choice to make, or Saved once it lands) and Keep mine, Load
  // their version and Save as a new deal have a value to act on.
  const resent = useRef(new WeakSet<Autosaver<StoredDeal>>());
  useEffect(() => {
    const instance = autosaver.current;
    if (!seeded || deal === undefined || instance === null || resent.current.has(instance)) return;
    resent.current.add(instance);
    if (!isOfflineRepository(repository) || instance.pending() !== undefined) return;
    if (repository.pending().some((save) => save.dealId === deal.id)) instance.schedule(deal);
  }, [seeded, deal, repository]);

  // A deal that was deleted elsewhere while it is open: the editor must not write it back, and is no longer ready.
  const missing = dealQuery.isSuccess && dealQuery.data === null;
  const deletedElsewhere = seeded && missing;
  /** Seeded and still there: the editor can be used. */
  const live = seeded && !missing;
  useEffect(() => {
    if (deletedElsewhere) autosaver.current?.discard();
  }, [deletedElsewhere]);

  const edit = useCallback((recipe: (draft: DealInputs) => void) => {
    if (!busyRef.current) dispatch({ type: "edit", recipe });
  }, []);
  const undo = useCallback(() => {
    if (!busyRef.current) dispatch({ type: "undo" });
  }, []);
  const redo = useCallback(() => {
    if (!busyRef.current) dispatch({ type: "redo" });
  }, []);
  const discardChanges = useCallback(() => autosaver.current?.discard(), []);
  const saveNow = useCallback(() => {
    if (autosaver.current) flushNow(autosaver.current);
  }, [flushNow]);
  const keepMine = useCallback(() => {
    const instance = autosaver.current;
    if (instance === null) return;
    const stamp = theirs.current.get(dealId);
    if (stamp !== undefined) {
      // Mine, on top of the version the owner was shown as theirs: the next save is made from it, and so is the
      // outbox's entry, which would otherwise go on carrying the stamp from before the conflict.
      baseline.current.set(dealId, stamp);
      const waiting = instance.pending();
      if (waiting !== undefined && isOfflineRepository(repository)) {
        repository.queue({ ...waiting, updatedAt: stamp }, { rebase: true });
      }
    }
    void instance.flush();
  }, [repository, dealId]);

  /** The deal as the owner sees it, for the actions that need its latest name and inputs. */
  const latestDeal = useRef<StoredDeal | undefined>(undefined);
  useEffect(() => {
    latestDeal.current = deal;
  }, [deal]);

  /** Runs `action` with edits blocked, so nothing typed meanwhile can be saved over the version being chosen. */
  const whileBusy = useCallback(async <R,>(action: () => Promise<R>): Promise<R> => {
    busyRef.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const loadTheirs = useCallback(
    () =>
      whileBusy(async () => {
        const previous = statusRef.current;
        const outbox = isOfflineRepository(repository) ? repository : null;
        let fresh: StoredDeal | null;
        try {
          // From the server only: this device's outbox and copy of the deal are the owner's own version, not theirs.
          fresh = outbox ? await outbox.getDeal(dealId, { fromServer: true }) : await repository.getDeal(dealId);
        } catch (error) {
          // Nothing was loaded, and nothing was dropped: the local edits and their outbox entry are still the owner's,
          // and the choice is still theirs to make.
          setSaveStatus(previous);
          if (previous.kind === "error") setFailedWith(previous.reason);
          throw error;
        }
        // Theirs is in: what waits here (and anything queued while the read was on its way) is the old copy.
        autosaver.current?.discard();
        outbox?.discardPending(dealId);
        queryClient.setQueryData(queryKeys.deal(dealId), fresh);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deals });
        if (fresh === null) return;
        baseline.current.set(dealId, fresh.updatedAt);
        // What was just loaded is not an edit: it must not be scheduled for saving.
        lastSeen.current = { dealId, inputs: fresh.inputs, name: fresh.name };
        setSeed({ dealId, name: fresh.name, updatedAt: fresh.updatedAt });
        dispatch({ type: "reset", inputs: fresh.inputs });
        setEvaluated(fresh.inputs);
        setSaveStatus(SAVED);
        setFailedWith(null);
      }),
    [repository, queryClient, dealId, whileBusy],
  );

  const saveAsNewDeal = useCallback(
    () =>
      whileBusy(async () => {
        const current = latestDeal.current;
        if (current === undefined) throw new DataError("The deal isn't loaded yet.", { kind: "failed", recordId: dealId });
        const created = await repository.createDeal({ name: current.name, inputs: current.inputs });
        // Nothing may be written to the deleted deal again.
        autosaver.current?.discard();
        if (isOfflineRepository(repository)) repository.discardPending(dealId);
        queryClient.setQueryData(queryKeys.deal(created.id), created);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deals });
        return created.id;
      }),
    [repository, queryClient, dealId, whileBusy],
  );

  const discardDeletedDeal = useCallback(() => {
    autosaver.current?.discard();
    // Nothing was deleted on this device, so its outbox entry would otherwise try again.
    if (isOfflineRepository(repository)) repository.discardPending(dealId);
  }, [repository, dealId]);

  const rename = useCallback(
    (newName: string): boolean => {
      const trimmed = newName.trim();
      if (trimmed === "" || !live || busyRef.current) return false;
      setSeed((current) => (current === null || current.name === trimmed ? current : { ...current, name: trimmed }));
      return true;
    },
    [live],
  );

  // Once seeded, the editor owns the deal: a later failed or empty read of it is not the editor's problem. The
  // context is different: if it fails, the evaluation can no longer be trusted.
  const dealFailure = seeded ? null : dealQuery.error;
  const failure = dealFailure ?? engine.error;
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
  // Only the deal's own read can show the record is bad (the editor makes any other thrown value a DataError too).
  const recordUnreadable =
    status === "error" &&
    ((dealFailure instanceof DataError && dealFailure.kind === "unreadable") || (!failure && noRegion));

  return useMemo<DealEditor>(
    () => ({
      status,
      error,
      recordUnreadable,
      deal: isReady ? deal : undefined,
      inputs: isReady ? present : undefined,
      evaluation: isReady ? evaluation : undefined,
      evaluationError: isReady ? evaluationError : undefined,
      evaluatedInputs: isReady ? (evaluated ?? undefined) : undefined,
      context: isReady ? context : undefined,
      edit,
      rename,
      undo,
      redo,
      discardChanges,
      saveNow,
      busy,
      keepMine,
      loadTheirs,
      saveAsNewDeal,
      discardDeletedDeal,
      canUndo: live && editor.past.length > 0,
      canRedo: live && editor.future.length > 0,
      saveStatus,
    }),
    [
      status,
      error,
      recordUnreadable,
      isReady,
      deal,
      present,
      evaluation,
      evaluationError,
      evaluated,
      context,
      edit,
      rename,
      undo,
      redo,
      discardChanges,
      saveNow,
      busy,
      keepMine,
      loadTheirs,
      saveAsNewDeal,
      discardDeletedDeal,
      live,
      editor,
      saveStatus,
    ],
  );
}
