export type SaveStatus =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

export interface AutosaverOptions<T> {
  save: (value: T) => Promise<unknown>;
  /** Quiet time after the last `schedule` before the value is saved. */
  delayMs?: number;
  /** How long to wait before trying a failed save again. */
  retryMs?: number;
  onStatus: (status: SaveStatus) => void;
}

export interface Autosaver<T> {
  /** Replaces whatever is waiting with `value` and saves it once `delayMs` pass without another call. */
  schedule(value: T): void;
  /** Saves the waiting value now. Resolves when no save is running or waiting; never rejects (a failure is a status). */
  flush(): Promise<void>;
  /** Cancels what is waiting and silences the status. A save already started, or already asked for by `flush`, finishes. */
  dispose(): void;
}

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)) || "Couldn't save";

/**
 * Saves the newest scheduled value after a quiet spell, one save at a time. An edit made while a save runs is kept as
 * the latest value only and is saved after it, once its own quiet spell is over. A failed save is shown as an error
 * and tried again every `retryMs`, unless a newer value arrives first, which waits the normal `delayMs`.
 */
export function createAutosaver<T>({
  save,
  delayMs = 1000,
  retryMs = 5000,
  onStatus,
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
  let status: SaveStatus = { kind: "saved" };

  function setStatus(next: SaveStatus): void {
    if (disposed) return;
    if (next.kind === status.kind && (next.kind !== "error" || (status.kind === "error" && next.message === status.message))) {
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
        let failure: string | undefined;
        try {
          await save(value);
        } catch (error) {
          failure = messageOf(error);
        }
        // A failed value stays the one to save, unless an edit made during the save replaced it.
        const replaced = dirty;
        if (failure !== undefined && !replaced) dirty = true;
        if (dirty && due) continue;
        if (failure !== undefined) {
          setStatus({ kind: "error", message: failure });
          if (!replaced) startTimer(retryMs);
        } else {
          setStatus(dirty ? { kind: "pending" } : { kind: "saved" });
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
    flush() {
      clearTimer();
      if (dirty) due = true;
      return kick();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
