import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver } from "./autosaver";
import type { SaveStatus } from "./autosaver";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** An autosaver over a fake store. Each save is recorded; `gates` can hold the next saves open until the test lets go. */
function setup(options: { delayMs?: number; retryMs?: number } = {}) {
  const calls: number[] = [];
  const statuses: SaveStatus[] = [];
  const gates: Deferred[] = [];
  let stored: number | undefined;
  let running = 0;
  let maxRunning = 0;
  const failWith: unknown[] = [];

  const saver = createAutosaver<number>({
    ...options,
    save: async (value) => {
      calls.push(value);
      running++;
      maxRunning = Math.max(maxRunning, running);
      try {
        const gate = gates.shift();
        if (gate) await gate.promise;
        if (failWith.length > 0) throw failWith.shift();
        stored = value;
      } finally {
        running--;
      }
    },
    onStatus: (status) => statuses.push(status),
  });

  return {
    saver,
    calls,
    statuses,
    gates,
    failWith,
    stored: () => stored,
    maxRunning: () => maxRunning,
    kinds: () => statuses.map((s) => s.kind),
  };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("createAutosaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once, 1,000 ms after a single schedule", async () => {
    const t = setup();
    t.saver.schedule(1);
    expect(t.statuses).toEqual([{ kind: "pending" }]);

    await advance(999);
    expect(t.calls).toEqual([]);
    await advance(1);
    expect(t.calls).toEqual([1]);
    expect(t.stored()).toBe(1);
    expect(t.statuses).toEqual([{ kind: "pending" }, { kind: "saving" }, { kind: "saved" }]);

    await advance(60_000);
    expect(t.calls).toEqual([1]);
  });

  it("saves once with the last value when schedules arrive 200 ms apart", async () => {
    const t = setup();
    t.saver.schedule(1);
    await advance(200);
    t.saver.schedule(2);
    await advance(200);
    t.saver.schedule(3);

    // 1,000 ms after the first or second schedule: nothing yet, each new edit pushed the save back.
    await advance(999);
    expect(t.calls).toEqual([]);
    await advance(1);
    expect(t.calls).toEqual([3]);
    expect(t.stored()).toBe(3);
  });

  it("saves an edit made during a save once, after it, with the newest value", async () => {
    const t = setup();
    const first = deferred();
    t.gates.push(first);

    t.saver.schedule(1);
    await advance(1000);
    expect(t.calls).toEqual([1]);

    t.saver.schedule(2);
    t.saver.schedule(3);
    // Plenty of time passes, but the first save has not finished: no second save runs beside it.
    await advance(5000);
    expect(t.calls).toEqual([1]);
    expect(t.stored()).toBeUndefined();

    first.resolve();
    await advance(0);
    expect(t.calls).toEqual([1, 3]);
    expect(t.stored()).toBe(3);
    expect(t.maxRunning()).toBe(1);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });

    await advance(60_000);
    expect(t.calls).toEqual([1, 3]);
  });

  it("still waits for the edit's own delay when the first save finishes sooner", async () => {
    const t = setup();
    const first = deferred();
    t.gates.push(first);

    t.saver.schedule(1);
    await advance(1000);
    await advance(300);
    t.saver.schedule(2);
    first.resolve();
    await advance(0);
    // The first save is done, but the edit is only 0 ms old.
    expect(t.calls).toEqual([1]);
    expect(t.statuses.at(-1)).toEqual({ kind: "pending" });

    await advance(999);
    expect(t.calls).toEqual([1]);
    await advance(1);
    expect(t.calls).toEqual([1, 2]);
    expect(t.stored()).toBe(2);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
  });

  it("shows the error, retries after 5,000 ms, then reaches saved", async () => {
    const t = setup();
    t.failWith.push(new Error("Couldn't save — browser storage is full"));

    t.saver.schedule(7);
    await advance(1000);
    expect(t.calls).toEqual([7]);
    expect(t.statuses.at(-1)).toEqual({ kind: "error", message: "Couldn't save — browser storage is full" });
    expect(t.stored()).toBeUndefined();

    await advance(4999);
    expect(t.calls).toEqual([7]);
    await advance(1);
    expect(t.calls).toEqual([7, 7]);
    expect(t.stored()).toBe(7);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
    expect(t.kinds()).toEqual(["pending", "saving", "error", "saving", "saved"]);
  });

  it("keeps retrying every 5,000 ms until a save works", async () => {
    const t = setup();
    t.failWith.push(new Error("down"), new Error("still down"));

    t.saver.schedule(1);
    await advance(1000);
    expect(t.statuses.at(-1)).toEqual({ kind: "error", message: "down" });
    await advance(5000);
    expect(t.calls).toEqual([1, 1]);
    expect(t.statuses.at(-1)).toEqual({ kind: "error", message: "still down" });
    await advance(5000);
    expect(t.calls).toEqual([1, 1, 1]);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
  });

  it("describes a rejection that is not an Error by its text", async () => {
    const t = setup();
    t.failWith.push("quota");
    t.saver.schedule(1);
    await advance(1000);
    expect(t.statuses.at(-1)).toEqual({ kind: "error", message: "quota" });
  });

  it("replaces a failed value with a newer edit, which waits the normal 1,000 ms, not the retry delay", async () => {
    const t = setup();
    t.failWith.push(new Error("down"));
    t.saver.schedule(1);
    await advance(1000);
    expect(t.statuses.at(-1)?.kind).toBe("error");

    await advance(2000);
    t.saver.schedule(2);
    expect(t.statuses.at(-1)).toEqual({ kind: "pending" });
    await advance(999);
    expect(t.calls).toEqual([1]);
    await advance(1);
    expect(t.calls).toEqual([1, 2]);
    expect(t.stored()).toBe(2);

    // The old retry timer is gone: nothing re-saves the abandoned value.
    await advance(60_000);
    expect(t.calls).toEqual([1, 2]);
  });

  it("does not lose an edit made while a save is failing", async () => {
    const t = setup();
    const first = deferred();
    t.gates.push(first);

    t.saver.schedule(1);
    await advance(1000);
    t.saver.schedule(2);
    first.reject(new Error("down"));
    await advance(0);
    expect(t.statuses.at(-1)).toEqual({ kind: "error", message: "down" });

    await advance(1000);
    expect(t.calls).toEqual([1, 2]);
    expect(t.stored()).toBe(2);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
    await advance(60_000);
    expect(t.calls).toEqual([1, 2]);
  });

  it("flush saves a pending value immediately", async () => {
    const t = setup();
    t.saver.schedule(4);
    await t.saver.flush();
    expect(t.calls).toEqual([4]);
    expect(t.stored()).toBe(4);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });

    // The delay timer was cancelled, so the value is not saved a second time.
    await advance(60_000);
    expect(t.calls).toEqual([4]);
  });

  it("flush with nothing pending saves nothing", async () => {
    const t = setup();
    await t.saver.flush();
    expect(t.calls).toEqual([]);
    expect(t.statuses).toEqual([]);
  });

  it("flush waits for a running save and then saves the newest value", async () => {
    const t = setup();
    const first = deferred();
    t.gates.push(first);
    t.saver.schedule(1);
    await advance(1000);
    t.saver.schedule(2);

    let done = false;
    const flushed = t.saver.flush().then(() => {
      done = true;
    });
    await advance(0);
    expect(done).toBe(false);
    expect(t.calls).toEqual([1]);

    first.resolve();
    await flushed;
    expect(t.calls).toEqual([1, 2]);
    expect(t.stored()).toBe(2);
    expect(t.maxRunning()).toBe(1);
  });

  it("flush retries a failed value right away", async () => {
    const t = setup();
    t.failWith.push(new Error("down"));
    t.saver.schedule(1);
    await advance(1000);
    expect(t.statuses.at(-1)?.kind).toBe("error");

    await t.saver.flush();
    expect(t.calls).toEqual([1, 1]);
    expect(t.stored()).toBe(1);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
  });

  it("flush does not reject when the save fails; the failure is reported as a status", async () => {
    const t = setup();
    t.failWith.push(new Error("down"));
    t.saver.schedule(1);
    await expect(t.saver.flush()).resolves.toBeUndefined();
    expect(t.statuses.at(-1)).toEqual({ kind: "error", message: "down" });
  });

  it("dispose cancels a pending save and goes quiet", async () => {
    const t = setup();
    t.saver.schedule(1);
    t.saver.dispose();
    const before = t.statuses.length;
    await advance(60_000);
    expect(t.calls).toEqual([]);
    t.saver.schedule(2);
    await advance(60_000);
    expect(t.calls).toEqual([]);
    expect(t.statuses).toHaveLength(before);
  });

  it("flush then dispose, without waiting, still saves the pending value", async () => {
    const t = setup();
    t.saver.schedule(1);
    void t.saver.flush();
    t.saver.dispose();
    await advance(0);
    expect(t.calls).toEqual([1]);
    expect(t.stored()).toBe(1);
  });

  it("flush then dispose, without waiting, still saves the newest value after a running save", async () => {
    const t = setup();
    const first = deferred();
    t.gates.push(first);
    t.saver.schedule(1);
    await advance(1000);
    t.saver.schedule(2);

    void t.saver.flush();
    t.saver.dispose();
    first.resolve();
    await advance(0);
    expect(t.calls).toEqual([1, 2]);
    expect(t.stored()).toBe(2);
    expect(t.maxRunning()).toBe(1);
  });

  it("does not retry a failed save after dispose", async () => {
    const t = setup();
    t.failWith.push(new Error("down"));
    t.saver.schedule(1);
    void t.saver.flush();
    t.saver.dispose();
    await advance(60_000);
    expect(t.calls).toEqual([1]);
  });

  it("uses the delays it is given", async () => {
    const t = setup({ delayMs: 50, retryMs: 70 });
    t.failWith.push(new Error("down"));
    t.saver.schedule(1);
    await advance(50);
    expect(t.calls).toEqual([1]);
    await advance(69);
    expect(t.calls).toEqual([1]);
    await advance(1);
    expect(t.calls).toEqual([1, 1]);
  });
});
