import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../local/memoryStorage";
import { sampleDealInputs } from "../sample";
import { DataError } from "../types";
import type { Repository, StoredDeal } from "../types";
import { createOfflineRepository } from "./offlineRepository";
import { useOutboxSync } from "./useOutboxSync";

const SAVED_AT = "2026-11-06T10:00:00.123456+00:00";

const deal = (n: number): StoredDeal => ({
  id: `2222222${n}-2222-4222-8222-222222222222`,
  name: `Deal ${n}`,
  status: "analyzing",
  inputs: sampleDealInputs(),
  createdAt: "2026-11-01T12:00:00.123456+00:00",
  updatedAt: "2026-11-01T12:00:00.123456+00:00",
});

const offline = () =>
  new DataError("Can't reach the server — check your connection.", {
    kind: "offline",
  });

/** An outbox over a server whose `saveDeal` (all a sync calls) is scripted, with `queued` deals already waiting. */
function setup({
  queued = 0,
  reachable = true,
}: { queued?: number; reachable?: boolean } = {}) {
  const saveDeal = vi.fn<Repository["saveDeal"]>(async (d) => ({
    ...d,
    updatedAt: SAVED_AT,
  }));
  if (!reachable) saveDeal.mockRejectedValue(offline());
  const repo = createOfflineRepository(
    { saveDeal } as unknown as Repository,
    new MemoryStorage(),
    "user-a",
  );
  for (let n = 0; n < queued; n++) repo.queue(deal(n));
  const syncNow = vi.spyOn(repo, "syncNow");
  const comeOnline = () =>
    saveDeal.mockImplementation(async (d) => ({ ...d, updatedAt: SAVED_AT }));
  return { repo, saveDeal, syncNow, comeOnline };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useOutboxSync", () => {
  it("syncs on mount, and the count follows the outbox", async () => {
    const { repo, saveDeal, syncNow } = setup({ queued: 2 });
    const view = renderHook(() => useOutboxSync(repo));
    expect(view.result.current.pendingCount).toBe(2);
    expect(syncNow).toHaveBeenCalledTimes(1);
    await advance(0);
    expect(saveDeal).toHaveBeenCalledTimes(2);
    expect(view.result.current.pendingCount).toBe(0);
  });

  it("counts edits queued after mount", async () => {
    const { repo } = setup({ reachable: false });
    const view = renderHook(() => useOutboxSync(repo));
    await advance(0);
    expect(view.result.current.pendingCount).toBe(0);
    act(() => repo.queue(deal(7)));
    expect(view.result.current.pendingCount).toBe(1);
  });

  it("is syncing while a sync runs, and not before or after", async () => {
    const { repo, saveDeal } = setup({ queued: 1 });
    let land!: () => void;
    saveDeal.mockImplementationOnce(
      (d) =>
        new Promise(
          (resolve) => (land = () => resolve({ ...d, updatedAt: SAVED_AT })),
        ),
    );
    const view = renderHook(() => useOutboxSync(repo));
    expect(view.result.current.syncing).toBe(true);
    await advance(0);
    expect(view.result.current.syncing).toBe(true);
    land();
    await advance(0);
    expect(view.result.current.syncing).toBe(false);
    expect(view.result.current.pendingCount).toBe(0);
  });

  it("syncs again when the browser says it is back online", async () => {
    const { repo, syncNow, comeOnline } = setup({
      queued: 2,
      reachable: false,
    });
    const view = renderHook(() => useOutboxSync(repo));
    await advance(0);
    expect(view.result.current.pendingCount).toBe(2);

    comeOnline();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(view.result.current.pendingCount).toBe(0);
  });

  it("tries every 30 s while something waits, on one interval, and stops when nothing does", async () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const { repo, syncNow, comeOnline } = setup({
      queued: 2,
      reachable: false,
    });
    renderHook(() => useOutboxSync(repo));
    await advance(0);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await advance(29_999);
    expect(syncNow).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(syncNow).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(syncNow).toHaveBeenCalledTimes(3);
    // Still the one interval: a run that leaves edits waiting starts no other.
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    comeOnline();
    await advance(30_000);
    expect(syncNow).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(syncNow).toHaveBeenCalledTimes(4);
  });

  it("starts the interval again when a new edit waits", async () => {
    const { repo, syncNow, saveDeal } = setup();
    renderHook(() => useOutboxSync(repo));
    await advance(0);
    expect(vi.getTimerCount()).toBe(0);

    saveDeal.mockRejectedValue(offline());
    act(() => repo.queue(deal(3)));
    expect(vi.getTimerCount()).toBe(1);
    await advance(30_000);
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it("polls nothing when nothing waits", async () => {
    const { repo, syncNow } = setup();
    renderHook(() => useOutboxSync(repo));
    await advance(0);
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("on unmount clears the interval and stops listening for online", async () => {
    const { repo, syncNow } = setup({ queued: 1, reachable: false });
    const view = renderHook(() => useOutboxSync(repo));
    await advance(0);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event("online"));
    await advance(120_000);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("under StrictMode keeps one interval and one online listener", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const { repo, syncNow } = setup({ queued: 1, reachable: false });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const view = renderHook(() => useOutboxSync(repo), { wrapper });
    await advance(0);
    expect(vi.getTimerCount()).toBe(1);
    const listening = () =>
      added.mock.calls.filter(([type]) => type === "online").length -
      removed.mock.calls.filter(([type]) => type === "online").length;
    expect(listening()).toBe(1);

    const before = syncNow.mock.calls.length;
    await advance(30_000);
    expect(syncNow.mock.calls.length - before).toBe(1);
    view.unmount();
    expect(listening()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("follows a new outbox when the repository changes", async () => {
    const first = setup({ queued: 1, reachable: false });
    const second = setup({ queued: 3, reachable: false });
    const view = renderHook(({ repo }) => useOutboxSync(repo), {
      initialProps: { repo: first.repo },
    });
    await advance(0);
    expect(view.result.current.pendingCount).toBe(1);

    view.rerender({ repo: second.repo });
    expect(view.result.current.pendingCount).toBe(3);
    await advance(0);
    expect(second.syncNow).toHaveBeenCalledTimes(1);
    act(() => first.repo.queue(deal(8)));
    expect(view.result.current.pendingCount).toBe(3);
  });

  it("leaves out edits the server refused: not counted, not polled, but named for the owner's choice", async () => {
    const { repo, saveDeal, syncNow } = setup({ queued: 2 });
    saveDeal.mockRejectedValueOnce(new DataError("changed", { kind: "conflict" }));
    const view = renderHook(() => useOutboxSync(repo));
    await advance(0);
    expect(repo.pending()).toHaveLength(1);
    expect(view.result.current.pendingCount).toBe(0);
    expect(view.result.current.refused).toEqual([
      { dealId: deal(0).id, dealName: "Deal 0", problem: "conflict" },
    ]);
    // Nothing a sync can send is waiting, so nothing polls.
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("keeps the same refused list between renders while it does not change", async () => {
    const { repo, saveDeal } = setup({ queued: 1 });
    saveDeal.mockRejectedValueOnce(new DataError("gone", { kind: "deleted" }));
    const view = renderHook(() => useOutboxSync(repo));
    await advance(0);
    const first = view.result.current.refused;
    view.rerender();
    expect(view.result.current.refused).toBe(first);
  });

  describe("asking the browser to keep this site's storage", () => {
    afterEach(() => {
      delete (navigator as { storage?: unknown }).storage;
    });
    const browserWith = (persist: () => Promise<boolean>) =>
      Object.defineProperty(navigator, "storage", { value: { persist }, configurable: true });

    it("asks the first time an edit waits on the device, and only once", async () => {
      const persist = vi.fn(async () => true);
      browserWith(persist);
      const { repo } = setup({ reachable: false });
      renderHook(() => useOutboxSync(repo));
      await advance(0);
      expect(persist).not.toHaveBeenCalled();
      act(() => repo.queue(deal(1)));
      expect(persist).toHaveBeenCalledTimes(1);
      act(() => repo.queue(deal(2)));
      await advance(30_000);
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it("goes on when the browser refuses, or has no way to ask", async () => {
      browserWith(() => Promise.reject(new Error("not allowed")));
      const { repo } = setup({ queued: 1, reachable: false });
      const view = renderHook(() => useOutboxSync(repo));
      await advance(0);
      expect(view.result.current.pendingCount).toBe(1);
      delete (navigator as { storage?: unknown }).storage;
      const other = setup({ queued: 1, reachable: false });
      expect(() => renderHook(() => useOutboxSync(other.repo))).not.toThrow();
    });
  });

  it("reports a sync that throws, against its contract, once", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { repo, syncNow } = setup({ queued: 1 });
    syncNow.mockRejectedValue(new Error("boom"));
    const view = renderHook(() => useOutboxSync(repo));
    await advance(0);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[1]).toEqual(new Error("boom"));
    expect(view.result.current.syncing).toBe(false);
  });
});
