import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { OfflineRepository } from "./offlineRepository";

/** How often edits waiting on this device are tried again while any wait. */
export const SYNC_INTERVAL_MS = 30_000;

export interface OutboxSync {
  /** Edits saved on this device that have not reached the server. */
  pendingCount: number;
  /** True while a sync run is sending them. */
  syncing: boolean;
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
 * every 30 s while any are waiting (one interval, cleared when none wait and on unmount). The outbox has no timers of
 * its own; this is where they live.
 */
export function useOutboxSync(repo: OfflineRepository): OutboxSync {
  const pendingCount = useSyncExternalStore(
    repo.subscribe,
    () => repo.pending().length,
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

  return { pendingCount, syncing };
}
