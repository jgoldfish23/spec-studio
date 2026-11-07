import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { OfflineRepository, PendingSave } from "./offlineRepository";

/** How often edits waiting on this device are tried again while any wait. */
export const SYNC_INTERVAL_MS = 30_000;

/** A deal whose waiting edit the server refused: it changed or went elsewhere, and the owner must choose. */
export type RefusedSave = Required<Pick<PendingSave, "dealId" | "dealName" | "problem">>;

export interface OutboxSync {
  /** Edits saved on this device that a sync can still send: not the ones the server refused. */
  pendingCount: number;
  /** The deals whose edit the server refused, oldest first. A sync never sends them again by itself. */
  refused: RefusedSave[];
  /** True while a sync run is sending them. */
  syncing: boolean;
}

/** The refused edits as one string, so the store's snapshot is the same value until they change. */
const refusedOf = (repo: OfflineRepository): string =>
  JSON.stringify(
    repo
      .pending()
      .filter((save) => save.problem !== undefined)
      .map(({ dealId, dealName, problem }) => ({ dealId, dealName, problem })),
  );

/**
 * Asks the browser to keep this site's storage, best effort. Safari can clear a site's storage, unsynced edits included,
 * after 7 days without a visit; a site that asked (and a home-screen app) is kept. A browser that cannot ask, or says
 * no, changes nothing.
 */
function askToKeepStorage(): void {
  try {
    const storage = globalThis.navigator?.storage;
    if (typeof storage?.persist !== "function") return;
    storage.persist().catch(() => {});
  } catch {
    // Best effort.
  }
}

/** The sync runs one hook has started and not yet seen finish, as a store `useSyncExternalStore` can follow. */
function createRunCount() {
  let count = 0;
  const listeners = new Set<() => void>();
  const set = (next: number) => {
    count = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => count,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    track(run: Promise<unknown>): Promise<unknown> {
      set(count + 1);
      return run.finally(() => set(count - 1));
    },
  };
}

/**
 * Sends the edits waiting in `repo`'s outbox: once on mount, again whenever the browser says it is back online, and
 * every 30 s while any a sync can send are waiting (one interval, cleared when none wait and on unmount). An edit the
 * server refused is not polled for: it waits for the owner's choice, and is listed in `refused`. The outbox has no
 * timers of its own; this is where they live.
 */
export function useOutboxSync(repo: OfflineRepository): OutboxSync {
  const pendingCount = useSyncExternalStore(
    repo.subscribe,
    () => repo.pending().filter((save) => save.problem === undefined).length,
  );
  const refusedText = useSyncExternalStore(repo.subscribe, () =>
    refusedOf(repo),
  );
  const refused = useMemo(
    () => JSON.parse(refusedText) as RefusedSave[],
    [refusedText],
  );
  const [runs] = useState(createRunCount);
  const syncing = useSyncExternalStore(runs.subscribe, runs.get) > 0;
  const reported = useRef(false);

  const sync = useCallback(() => {
    // `syncNow` is single-flight: a call while a run is going joins it.
    runs.track(repo.syncNow()).catch((error: unknown) => {
      // It never throws by contract; if it does, say so once rather than on every 30 s try.
      if (reported.current) return;
      reported.current = true;
      console.error("Syncing the offline outbox failed unexpectedly.", error);
    });
  }, [repo, runs]);

  useEffect(() => {
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [sync]);

  const waiting = pendingCount > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(sync, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, sync]);

  // The first time an edit waits on this device, the browser is asked to keep it.
  const askedToKeep = useRef(false);
  const holdsWork = waiting || refused.length > 0;
  useEffect(() => {
    if (!holdsWork || askedToKeep.current) return;
    askedToKeep.current = true;
    askToKeepStorage();
  }, [holdsWork]);

  return { pendingCount, refused, syncing };
}
