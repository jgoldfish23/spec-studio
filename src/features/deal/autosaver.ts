import { DataError } from "../../data/types";
import type { DataErrorKind } from "../../data/types";

/** Why a save failed: the `DataError` kind, or `"unknown"` for any other failure. */
export type SaveFailureReason = DataErrorKind | "unknown";

export type SaveStatus =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "error"; message: string; reason: SaveFailureReason };

export interface SaveOptions {
  /** Skip the conflict check: the owner chose to keep this version. */
  overwrite?: boolean;
}

export interface AutosaverOptions<T> {
  save: (value: T, options?: SaveOptions) => Promise<unknown>;
  /** Whether a failed save is tried again on its own after `retryMs`. Default: always. A later edit tries again either way. */
  shouldRetry?: (error: unknown) => boolean;
  /** Quiet time after the last `schedule` before the value is saved. */
  delayMs?: number;
  /** How long to wait before trying a failed save again. */
  retryMs?: number;
  onStatus: (status: SaveStatus) => void;
  /**
   * Called once with the newest unsaved value when a save fails after `dispose()`. A disposed autosaver shows no
   * status and arms no retry, so this is the only way the owner of the value learns that it never reached the store.
   */
  onAbandoned?: (value: T, message: string, reason: SaveFailureReason) => void;
}

export interface Autosaver<T> {
  /** Replaces whatever is waiting with `value` and saves it once `delayMs` pass without another call. */
  schedule(value: T): void;
  /** Saves the waiting value now. Resolves when no save is running or waiting; never rejects (a failure is a status). */
  flush(options?: SaveOptions): Promise<void>;
  /** The value that is waiting to be saved (or that failed and is still unsaved), if any. */
  pending(): T | undefined;
  /** Cancels what is waiting and silences the status. A save already started, or already asked for by `flush`, finishes. */
  dispose(): void;
  /**
   * Drops the waiting value, any delay and any retry, because the value must not be saved (its deal is gone). A save
   * already running is not cancelled, and if it fails it is not retried. Safe to call again and again.
   */
  discard(): void;
}

/** Failures that retrying cannot fix: they wait for the owner to choose a version. */
export const needsChoice = (reason: SaveFailureReason): boolean => reason === "conflict" || reason === "deleted";

const reasonOf = (error: unknown): SaveFailureReason => (error instanceof DataError ? error.kind : "unknown");

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)) || "Couldn't save";

/**
 * Saves the newest scheduled value after a quiet spell, one save at a time. An edit made while a save runs is kept as
 * the latest value only and is saved after it, once its own quiet spell is over. A failed save is shown as an error
 * and tried again every `retryMs`, unless a newer value arrives first, which waits the normal `delayMs`.
 */
export function createAutosaver<T>({
  save,
  shouldRetry = () => true,
  delayMs = 1000,
  retryMs = 5000,
  onStatus,
  onAbandoned,
}: AutosaverOptions<T>): Autosaver<T> {
  let latest: T | undefined;
  /** A value is waiting to be saved: `latest` has not been saved yet. */
  let dirty = false;
  /** The wait for the waiting value is over (or `flush` asked), so it may be saved as soon as nothing else is. */
  let due = false;
  let running = false;
  let current: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** Counts `discard` calls, so a save that was running during one knows its value was given up. */
  let discards = 0;
  /** The next save skips the conflict check (set by `flush({ overwrite })`). */
  let overwriteNext = false;
  let status: SaveStatus = { kind: "saved" };

  function setStatus(next: SaveStatus): void {
    if (disposed) return;
    if (next.kind === status.kind && (next.kind !== "error" || (status.kind === "error" && next.message === status.message && next.reason === status.reason))) {
      return;
    }
    status = next;
    onStatus(next);
  }

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function startTimer(ms: number): void {
    clearTimer();
    if (disposed) return;
    timer = setTimeout(() => {
      timer = undefined;
      due = true;
      void kick();
    }, ms);
  }

  async function drain(): Promise<void> {
    try {
      while (dirty && due) {
        const value = latest as T;
        dirty = false;
        due = false;
        setStatus({ kind: "saving" });
        const discardsBefore = discards;
        const options = overwriteNext ? { overwrite: true } : undefined;
        overwriteNext = false;
        let failure: string | undefined;
        let reason: SaveFailureReason = "unknown";
        let retry = true;
        try {
          await save(value, options);
        } catch (error) {
          failure = messageOf(error);
          reason = reasonOf(error);
          retry = shouldRetry(error);
        }
        // A value given up during its own save is not retried, and its failure is no longer news.
        if (discards !== discardsBefore) failure = undefined;
        // A failed value stays the one to save, unless an edit made during the save replaced it.
        const replaced = dirty;
        if (failure !== undefined && !replaced) dirty = true;
        if (dirty && due) continue;
        if (failure === undefined) {
          setStatus(dirty ? { kind: "pending" } : { kind: "saved" });
        } else if (disposed) {
          // Nothing will retry this: hand the newest unsaved value to whoever owns it.
          dirty = false;
          onAbandoned?.(latest as T, failure, reason);
        } else {
          setStatus({ kind: "error", message: failure, reason });
          if (!replaced && retry) startTimer(retryMs);
        }
      }
    } finally {
      running = false;
    }
  }

  function kick(): Promise<void> {
    if (running) return current;
    running = true;
    current = drain();
    return current;
  }

  return {
    schedule(value) {
      if (disposed) return;
      latest = value;
      dirty = true;
      due = false;
      setStatus(running ? { kind: "saving" } : { kind: "pending" });
      startTimer(delayMs);
    },
    pending() {
      return dirty ? latest : undefined;
    },
    flush(options) {
      clearTimer();
      if (dirty) {
        due = true;
        if (options?.overwrite) overwriteNext = true;
      }
      return kick();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
    discard() {
      discards++;
      dirty = false;
      due = false;
      overwriteNext = false;
      clearTimer();
      // With a save running, its end reports the status; otherwise nothing is left waiting or failing.
      if (!running) setStatus({ kind: "saved" });
    },
  };
}
