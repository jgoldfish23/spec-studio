import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES } from "@engine";
import { testSampleComps } from "../../testing/sampleIds";
import { sampleDealInputs } from "../sample";
import { createLocalRepository } from "../local/localRepository";
import { MemoryStorage } from "../local/memoryStorage";
import { DataError } from "../types";
import type { DataErrorKind, DealListResult, Repository, StoredDeal } from "../types";
import { createOfflineRepository, isOfflineRepository, READ_GRACE_MS } from "./offlineRepository";

const SCOPE = "user-a";
const KEY = `spec-studio:outbox:${SCOPE}`;
const ID = "22222222-2222-4222-8222-222222222222";
const ID2 = "33333333-3333-4333-8333-333333333333";
const U0 = "2026-10-31T09:30:00.5+00:00";
const U1 = "2026-10-31T10:00:00.25+00:00";
const U2 = "2026-10-31T11:00:00.75+00:00";
const OFFLINE = "Offline — your changes are saved on this device and will sync.";
const SIGNED_OUT = "Signed out — sign in to sync. Your changes are saved on this device.";
const NOTICE = "Showing what's saved on this device — can't reach the server.";

const deal = (over: Partial<StoredDeal> = {}): StoredDeal => ({
  id: ID,
  name: "Lot",
  status: "analyzing",
  inputs: sampleDealInputs(),
  createdAt: "2026-10-30T12:00:00.123456+00:00",
  updatedAt: U0,
  ...over,
});
const offlineError = () => new DataError("offline", { kind: "offline" });
const signedOutError = () => new DataError("out", { kind: "signedOut" });

type SaveFn = (deal: StoredDeal) => Promise<StoredDeal>;

/** A remote whose saveDeal / getDeal / listDeals are scripted; everything else is a spy. */
function fakeRemote() {
  const remote = {
    saveDeal: vi.fn<SaveFn>(async (d) => ({ ...d, updatedAt: U1 })),
    getDeal: vi.fn<(id: string) => Promise<StoredDeal | null>>(async () => deal()),
    listDeals: vi.fn<() => Promise<DealListResult>>(async () => ({ deals: [deal()], problems: [] })),
    createDeal: vi.fn(async () => deal()),
    deleteDeal: vi.fn(async () => {}),
    resetDeals: vi.fn(async () => {}),
    listComps: vi.fn(async () => []),
    saveComp: vi.fn(async (c) => c),
    deleteComp: vi.fn(async () => {}),
    getCostBook: vi.fn(),
    getMarketSettings: vi.fn(),
    getCompanySettings: vi.fn(),
    saveCompanySettings: vi.fn(async (s) => s),
    saveMarketSettings: vi.fn(async (s) => s),
  };
  return remote;
}

const entries = (storage: Storage, key = KEY) =>
  (JSON.parse(storage.getItem(key) ?? '{"entries":[]}') as { entries: { problem?: string; base: string; seq: number; deal: StoredDeal }[] }).entries;

let storage: MemoryStorage;
let remote: ReturnType<typeof fakeRemote>;
let repo: ReturnType<typeof createOfflineRepository>;
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
  storage = new MemoryStorage();
  remote = fakeRemote();
  repo = createOfflineRepository(remote as unknown as Repository, storage, SCOPE);
});
afterEach(() => vi.restoreAllMocks());

describe("saveDeal", () => {
  it("writes the outbox entry before calling the remote", async () => {
    let seen: unknown[] = [];
    remote.saveDeal.mockImplementation(async (d) => {
      seen = entries(storage);
      return { ...d, updatedAt: U1 };
    });
    await repo.saveDeal(deal({ name: "Renamed" }));
    expect(seen).toHaveLength(1);
    expect((seen[0] as { deal: StoredDeal }).deal.name).toBe("Renamed");
  });

  it("writes the entry synchronously, before its first await", () => {
    remote.saveDeal.mockImplementation(() => new Promise(() => {}));
    void repo.saveDeal(deal());
    expect(entries(storage)).toHaveLength(1);
  });

  it("removes the entry on success and returns the remote's deal", async () => {
    const saved = await repo.saveDeal(deal());
    expect(saved.updatedAt).toBe(U1);
    expect(entries(storage)).toHaveLength(0);
    expect(repo.pending()).toEqual([]);
  });

  it("keeps a newer queued save when an older one succeeds, and rebases it on the server's updatedAt", async () => {
    let release!: (d: StoredDeal) => void;
    remote.saveDeal.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = repo.saveDeal(deal({ name: "One" }));
    remote.saveDeal.mockImplementationOnce(() => new Promise(() => {}));
    void repo.saveDeal(deal({ name: "Two" }));
    release(deal({ name: "One", updatedAt: U1 }));
    await first;
    const left = entries(storage);
    expect(left).toHaveLength(1);
    expect(left[0]?.deal.name).toBe("Two");
    expect(left[0]?.base).toBe(U1);
  });

  it("keeps one entry per deal, with the base of the first unsynced edit", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await expect(repo.saveDeal(deal({ name: "One" }))).rejects.toThrow();
    await expect(repo.saveDeal(deal({ name: "Two", updatedAt: U1 }))).rejects.toThrow();
    const left = entries(storage);
    expect(left).toHaveLength(1);
    expect(left[0]?.deal.name).toBe("Two");
    expect(left[0]?.base).toBe(U0);
    expect(remote.saveDeal.mock.calls[1]?.[0].updatedAt).toBe(U0);
  });

  it("keeps the entry and rethrows offline with the offline copy", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    const error = await repo.saveDeal(deal()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).kind).toBe("offline");
    expect((error as DataError).message).toBe(OFFLINE);
    expect(repo.pending()).toHaveLength(1);
  });

  it("keeps the entry and rethrows signedOut with the signed-out copy", async () => {
    remote.saveDeal.mockRejectedValue(signedOutError());
    const error = await repo.saveDeal(deal()).catch((e: unknown) => e);
    expect((error as DataError).kind).toBe("signedOut");
    expect((error as DataError).message).toBe(SIGNED_OUT);
    expect(repo.pending()).toHaveLength(1);
  });

  it.each(["conflict", "deleted"] as const)("marks the entry %s and rethrows unchanged", async (kind) => {
    const original = new DataError("x", { kind });
    remote.saveDeal.mockRejectedValue(original);
    await expect(repo.saveDeal(deal())).rejects.toBe(original);
    expect(repo.pending()).toEqual([expect.objectContaining({ dealId: ID, problem: kind })]);
  });

  it("carries on to the remote when storage refuses the write, and reports the outbox and the device copy once each", async () => {
    storage.setItem = () => {
      throw new Error("quota");
    };
    await repo.saveDeal(deal());
    await repo.saveDeal(deal());
    expect(remote.saveDeal).toHaveBeenCalledTimes(2);
    const said: string[] = logged.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(said).toHaveLength(2);
    expect(said.filter((m) => m.startsWith("The offline outbox could not be written"))).toHaveLength(1);
    expect(said.filter((m) => m.startsWith("The copy of your data on this device could not be saved"))).toHaveLength(1);
  });

  it("notifies subscribers", async () => {
    const listener = vi.fn();
    repo.subscribe(listener);
    await repo.saveDeal(deal());
    expect(listener).toHaveBeenCalled();
  });
});

describe("getDeal", () => {
  it("returns the outbox copy with the base updatedAt", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "First", updatedAt: U0 })).catch(() => {});
    await repo.saveDeal(deal({ name: "Local", updatedAt: U1 })).catch(() => {});
    const got = await repo.getDeal(ID);
    expect(got?.name).toBe("Local");
    expect(got?.updatedAt).toBe(U0);
  });

  it("goes to the remote when there is no entry", async () => {
    expect((await repo.getDeal(ID))?.name).toBe("Lot");
  });

  it("rethrows offline when the remote is offline and there is no entry", async () => {
    remote.getDeal.mockRejectedValue(offlineError());
    await expect(repo.getDeal(ID)).rejects.toMatchObject({ kind: "offline" });
  });

  it("returns the entry when the remote is offline", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    remote.getDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "Local" })).catch(() => {});
    expect((await repo.getDeal(ID))?.name).toBe("Local");
  });
});

describe("listDeals", () => {
  it("replaces remote rows with outbox copies", async () => {
    remote.listDeals.mockResolvedValue({ deals: [deal(), deal({ id: ID2, name: "Other" })], problems: [] });
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "Renamed" })).catch(() => {});
    const list = await repo.listDeals();
    expect(list.deals.map((d) => d.name)).toEqual(["Renamed", "Other"]);
    expect(list.notice).toBeUndefined();
  });

  it("gives the entries and a notice when the remote is offline", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "Renamed" })).catch(() => {});
    remote.listDeals.mockRejectedValue(offlineError());
    const list = await repo.listDeals();
    expect(list.deals.map((d) => d.name)).toEqual(["Renamed"]);
    expect(list.problems).toEqual([]);
    expect(list.notice).toBe(NOTICE);
  });

  it("rethrows offline when there are no entries", async () => {
    remote.listDeals.mockRejectedValue(offlineError());
    await expect(repo.listDeals()).rejects.toMatchObject({ kind: "offline" });
  });
});

describe("syncNow", () => {
  async function queue(...names: [string, string][]) {
    remote.saveDeal.mockRejectedValue(offlineError());
    for (const [id, name] of names) await repo.saveDeal(deal({ id, name })).catch(() => {});
    remote.saveDeal.mockImplementation(async (d) => ({ ...d, updatedAt: U2 }));
  }

  it("replays oldest first through the base updatedAt", async () => {
    await queue([ID2, "B"], [ID, "A"]);
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ id: ID2, name: "B2", updatedAt: U1 })).catch(() => {});
    remote.saveDeal.mockImplementation(async (d) => ({ ...d, updatedAt: U2 }));
    remote.saveDeal.mockClear();
    const result = await repo.syncNow();
    expect(result).toEqual({ synced: 2, remaining: 0, stoppedOffline: false });
    expect(remote.saveDeal.mock.calls.map((c) => c[0].id)).toEqual([ID, ID2]);
    expect(remote.saveDeal.mock.calls.find((c) => c[0].id === ID2)?.[0]).toMatchObject({ name: "B2", updatedAt: U0 });
    expect(remote.saveDeal.mock.calls.find((c) => c[0].id === ID)?.[0].updatedAt).toBe(U0);
    expect(repo.pending()).toEqual([]);
  });

  it.each([offlineError, signedOutError])("stops at the first offline or signedOut", async (make) => {
    await queue([ID2, "B"], [ID, "A"]);
    remote.saveDeal.mockClear();
    remote.saveDeal.mockRejectedValueOnce(make());
    const result = await repo.syncNow();
    expect(result).toEqual({ synced: 0, remaining: 2, stoppedOffline: true });
    expect(remote.saveDeal).toHaveBeenCalledTimes(1);
  });

  it("marks conflict and deleted entries and goes on, never retrying them", async () => {
    await queue([ID2, "B"], [ID, "A"]);
    remote.saveDeal.mockClear();
    remote.saveDeal.mockRejectedValueOnce(new DataError("c", { kind: "conflict" }));
    const result = await repo.syncNow();
    expect(result).toEqual({ synced: 1, remaining: 1, stoppedOffline: false });
    expect(repo.pending()).toEqual([expect.objectContaining({ dealId: ID2, problem: "conflict" })]);
    remote.saveDeal.mockClear();
    expect(await repo.syncNow()).toEqual({ synced: 0, remaining: 1, stoppedOffline: false });
    expect(remote.saveDeal).not.toHaveBeenCalled();
  });

  it("notifies subscribers after changes", async () => {
    await queue([ID, "A"]);
    const listener = vi.fn();
    repo.subscribe(listener);
    await repo.syncNow();
    expect(listener).toHaveBeenCalled();
  });

  it("does not double-save on two concurrent calls", async () => {
    await queue([ID, "A"]);
    remote.saveDeal.mockClear();
    const [a, b] = await Promise.all([repo.syncNow(), repo.syncNow()]);
    expect(remote.saveDeal).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});

describe("more sync behaviour", () => {
  it("queue with rebase puts the entry on the deal's own updatedAt (Keep mine), and later saves keep it", async () => {
    remote.saveDeal.mockRejectedValue(new DataError("c", { kind: "conflict", storedUpdatedAt: U2 }));
    await repo.saveDeal(deal({ name: "Mine" })).catch(() => {});
    expect(entries(storage)[0]).toMatchObject({ base: U0, problem: "conflict" });
    repo.queue(deal({ name: "Mine", updatedAt: U2 }), { rebase: true });
    expect(entries(storage)[0]?.base).toBe(U2);
    expect(entries(storage)[0]?.problem).toBeUndefined();
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "Mine, and more", updatedAt: U2 })).catch(() => {});
    expect(entries(storage)[0]?.base).toBe(U2);
    expect(remote.saveDeal.mock.calls.at(-1)?.[0].updatedAt).toBe(U2);
  });

  it("never sends a save that skips the conflict check: a change elsewhere after Keep mine is a conflict again", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    repo.queue(deal({ name: "Mine", updatedAt: U1 }), { rebase: true });
    remote.saveDeal.mockClear();
    remote.saveDeal.mockRejectedValue(new DataError("c", { kind: "conflict", storedUpdatedAt: U2 }));
    await repo.syncNow();
    expect(remote.saveDeal).toHaveBeenCalledTimes(1);
    expect(remote.saveDeal.mock.calls[0]).toEqual([expect.objectContaining({ name: "Mine", updatedAt: U1 })]);
    expect(repo.pending()).toEqual([expect.objectContaining({ dealId: ID, problem: "conflict" })]);
  });

  it("skips a deal that saveDeal has in flight", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal()).catch(() => {});
    remote.saveDeal.mockClear();
    remote.saveDeal.mockImplementation(() => new Promise(() => {}));
    void repo.saveDeal(deal({ name: "Typing" }));
    remote.saveDeal.mockClear();
    expect(await repo.syncNow()).toEqual({ synced: 0, remaining: 1, stoppedOffline: false });
    expect(remote.saveDeal).not.toHaveBeenCalled();
  });

  it("skips an entry replaced or discarded mid-run", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ id: ID2, name: "B" })).catch(() => {});
    await repo.saveDeal(deal({ name: "A" })).catch(() => {});
    remote.saveDeal.mockClear();
    remote.saveDeal.mockImplementationOnce(async (d) => {
      repo.discardPending(ID);
      return { ...d, updatedAt: U1 };
    });
    const result = await repo.syncNow();
    expect(result.synced).toBe(1);
    expect(remote.saveDeal).toHaveBeenCalledTimes(1);
  });

  it("does not rebase an entry another tab wrote", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "Mine" })).catch(() => {});
    let release!: (d: StoredDeal) => void;
    remote.saveDeal.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const sync = repo.syncNow();
    const other = createOfflineRepository(remote as unknown as Repository, storage, SCOPE);
    other.queue(deal({ name: "Theirs" }));
    release(deal({ updatedAt: U1 }));
    await sync;
    expect(entries(storage)[0]).toMatchObject({ base: U0 });
    expect(entries(storage)[0]?.deal.name).toBe("Theirs");
  });

  it("does not false-conflict on an edit made after a background sync (path A)", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "C" })).catch(() => {});
    remote.saveDeal.mockImplementation(async (d) => ({ ...d, updatedAt: U1 }));
    await repo.syncNow();
    remote.saveDeal.mockClear();
    await repo.saveDeal(deal({ name: "C2", updatedAt: U0 }));
    expect(remote.saveDeal.mock.calls[0]?.[0].updatedAt).toBe(U1);
  });

  it("waits for a running replay of the same deal before sending (path B)", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "C" })).catch(() => {});
    let release!: (d: StoredDeal) => void;
    remote.saveDeal.mockClear();
    remote.saveDeal.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    remote.saveDeal.mockImplementation(async (d) => ({ ...d, updatedAt: U2 }));
    const sync = repo.syncNow();
    const typing = repo.saveDeal(deal({ name: "C2", updatedAt: U0 }));
    await Promise.resolve();
    expect(remote.saveDeal).toHaveBeenCalledTimes(1);
    release(deal({ name: "C", updatedAt: U1 }));
    await sync;
    await typing;
    expect(remote.saveDeal).toHaveBeenCalledTimes(2);
    expect(remote.saveDeal.mock.calls[1]?.[0]).toMatchObject({ name: "C2", updatedAt: U1 });
    expect(repo.pending()).toEqual([]);
  });
});

describe("queue", () => {
  it("writes synchronously without calling the remote, and syncNow replays it", async () => {
    repo.queue(deal({ name: "Closing" }));
    expect(entries(storage)).toHaveLength(1);
    expect(remote.saveDeal).not.toHaveBeenCalled();
    expect(await repo.syncNow()).toEqual({ synced: 1, remaining: 0, stoppedOffline: false });
    expect(remote.saveDeal.mock.calls[0]?.[0].name).toBe("Closing");
  });
});

describe("deleting and resetting", () => {
  it("drops the deal's entry once the remote has deleted it", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal()).catch(() => {});
    remote.listDeals.mockResolvedValue({ deals: [], problems: [] });
    await repo.deleteDeal(ID);
    expect((await repo.listDeals()).deals).toEqual([]);
    expect(repo.pending()).toEqual([]);
  });

  it("clears every entry on reset", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal()).catch(() => {});
    await repo.saveDeal(deal({ id: ID2 })).catch(() => {});
    remote.listDeals.mockResolvedValue({ deals: [], problems: [] });
    await repo.resetDeals();
    expect((await repo.listDeals()).deals).toEqual([]);
  });

  it("keeps the entry when the delete is offline", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal()).catch(() => {});
    remote.deleteDeal.mockRejectedValue(offlineError());
    await expect(repo.deleteDeal(ID)).rejects.toMatchObject({ kind: "offline" });
    expect(repo.pending()).toHaveLength(1);
  });
});

describe("robustness", () => {
  it("does not list an outbox entry the server's list does not have: the server says that deal is gone", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ id: ID2, name: "Only here" })).catch(() => {});
    const list = await repo.listDeals();
    expect(list.deals.map((d) => d.name)).toEqual(["Lot"]);
    // The edit itself is kept, for the owner's choice once a sync hears the deal was deleted.
    expect(repo.pending().map((p) => p.dealName)).toEqual(["Only here"]);
  });

  it("does not list a deal whose edit the server refused because it was deleted, even from the device's copy", async () => {
    remote.listDeals.mockResolvedValue({ deals: [deal(), deal({ id: ID2, name: "Other" })], problems: [] });
    await repo.listDeals();
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ id: ID2, name: "Other, edited" })).catch(() => {});
    remote.saveDeal.mockRejectedValue(new DataError("gone", { kind: "deleted" }));
    await repo.syncNow();
    expect(repo.pending()).toEqual([expect.objectContaining({ dealId: ID2, problem: "deleted" })]);
    remote.listDeals.mockRejectedValue(offlineError());
    const list = await repo.listDeals();
    expect(list.deals.map((d) => d.name)).toEqual(["Lot"]);
    expect(list.notice).toBe(NOTICE);
  });

  it("reports a throwing getItem once", () => {
    storage.getItem = () => {
      throw new Error("blocked");
    };
    expect(repo.pending()).toEqual([]);
    expect(repo.pending()).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("does not let a throwing listener stop the save", async () => {
    repo.subscribe(() => {
      throw new Error("boom");
    });
    await expect(repo.saveDeal(deal())).resolves.toBeDefined();
    expect(remote.saveDeal).toHaveBeenCalled();
  });
});

describe("round 2", () => {
  /** Starts a sync whose replay of the deal hangs until released, with a save of the deal waiting on it. */
  async function waitingOnReplay() {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "E1" })).catch(() => {});
    let settle!: (result: () => Promise<StoredDeal>) => void;
    remote.saveDeal.mockImplementationOnce(() => new Promise((resolve, reject) => (settle = (f) => f().then(resolve, reject))));
    const sync = repo.syncNow();
    const waiting = repo.saveDeal(deal({ name: "C2" }));
    return { sync, waiting, settle };
  }

  it("returns the replaced entry's base when a newer save replaced the waiting one", async () => {
    const { sync, waiting, settle } = await waitingOnReplay();
    repo.queue(deal({ name: "C3" }));
    settle(async () => deal({ updatedAt: U1 }));
    await sync;
    const returned = await waiting;
    expect(returned.updatedAt).toBe(U1);
    expect(entries(storage)[0]?.base).toBe(U1);
  });

  it("returns the replay's own stamp when the entry was discarded after a successful replay", async () => {
    const { sync, waiting, settle } = await waitingOnReplay();
    remote.saveDeal.mockClear();
    settle(async () => {
      repo.discardPending(ID);
      return deal({ updatedAt: U1 });
    });
    await sync;
    expect((await waiting).updatedAt).toBe(U1);
    expect(remote.saveDeal).not.toHaveBeenCalled();
  });

  it("returns the deal unchanged when the entry was discarded and the replay failed", async () => {
    const { sync, waiting, settle } = await waitingOnReplay();
    settle(async () => {
      repo.discardPending(ID);
      throw offlineError();
    });
    await sync;
    expect((await waiting).updatedAt).toBe(U0);
  });

  it("does not conflict with itself after a discard cleared an old stamp (probe)", async () => {
    remote.saveDeal.mockImplementationOnce(async (d) => ({ ...d, updatedAt: U1 }));
    await repo.saveDeal(deal({ updatedAt: U0 }));
    // "Load their version": the editor now stands on U5.
    repo.discardPending(ID);
    const U5 = "2026-11-01T00:00:00+00:00";
    remote.saveDeal.mockRejectedValueOnce(offlineError());
    await repo.saveDeal(deal({ name: "E1", updatedAt: U5 })).catch(() => {});
    let fail!: (e: unknown) => void;
    remote.saveDeal.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    const sync = repo.syncNow();
    const waiting = repo.saveDeal(deal({ name: "C2", updatedAt: U5 }));
    repo.queue(deal({ name: "C3", updatedAt: U5 }));
    fail(offlineError());
    await sync;
    const returned = await waiting;
    expect(returned.updatedAt).toBe(U5);
    remote.saveDeal.mockClear();
    remote.saveDeal.mockImplementation(async (d) => ({ ...d, updatedAt: U2 }));
    await repo.saveDeal(deal({ name: "C4", updatedAt: returned.updatedAt }));
    expect(remote.saveDeal.mock.calls[0]?.[0].updatedAt).toBe(U5);
  });

  it("does not rebase another tab's entry even when seq numbers collide", async () => {
    const other = createOfflineRepository(remote as unknown as Repository, storage, SCOPE);
    let release!: (d: StoredDeal) => void;
    remote.saveDeal.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const mine = repo.saveDeal(deal({ name: "Mine" })); // seq 1, written by repo
    storage.removeItem(KEY); // storage emptied, so the other tab's seq restarts too
    other.queue(deal({ name: "Theirs" })); // seq 1 as well
    release(deal({ updatedAt: U1 }));
    await mine;
    const left = entries(storage);
    expect(left).toHaveLength(1);
    expect(left[0]?.deal.name).toBe("Theirs");
    expect(left[0]?.base).toBe(U0);
  });
});

describe("discardPending", () => {
  it("removes the entry and notifies", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal()).catch(() => {});
    const listener = vi.fn();
    repo.subscribe(listener);
    repo.discardPending(ID);
    expect(repo.pending()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("storage", () => {
  it("isolates scopes", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal()).catch(() => {});
    const other = createOfflineRepository(remote as unknown as Repository, storage, "user-b");
    expect(other.pending()).toEqual([]);
    expect(await other.syncNow()).toEqual({ synced: 0, remaining: 0, stoppedOffline: false });
    expect(entries(storage, "spec-studio:outbox:user-b")).toEqual([]);
    expect(repo.pending()).toHaveLength(1);
  });

  it("treats an unreadable value as empty and reports once", () => {
    storage.setItem(KEY, "{not json");
    expect(repo.pending()).toEqual([]);
    expect(repo.pending()).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("passes everything else straight through", async () => {
    await repo.deleteDeal(ID);
    await repo.listComps("utah-north");
    await repo.getCompanySettings();
    expect(remote.deleteDeal).toHaveBeenCalledWith(ID);
    expect(remote.listComps).toHaveBeenCalledWith("utah-north");
    expect(remote.getCompanySettings).toHaveBeenCalled();
    expect(isOfflineRepository(repo)).toBe(true);
    expect(isOfflineRepository(remote as unknown as Repository)).toBe(false);
  });
});

describe("the device copy of reads", () => {
  const REGION = "utah-north";
  const CACHE = "spec-studio:cache:user-a:";

  /** A real server (a local repository) behind a network the test can cut, as each kind of failure. */
  function online() {
    const server = createLocalRepository(new MemoryStorage());
    const network: { down: DataErrorKind | null } = { down: null };
    const reached = {} as Record<string, unknown>;
    for (const name of Object.keys(server)) {
      // Looked up at call time, so a test can spy on the server after this is made.
      reached[name] = async (...args: unknown[]) => {
        if (network.down) throw new DataError("down", { kind: network.down });
        return (server as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!(...args);
      };
    }
    const device = new MemoryStorage();
    const outbox = createOfflineRepository(reached as unknown as Repository, device, SCOPE);
    return { server, network, device, outbox };
  }
  const cacheKeys = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? "").filter((k) => k.startsWith(CACHE));

  async function seeded() {
    const world = online();
    for (const comp of testSampleComps()) await world.server.saveComp(comp);
    const first = await world.server.createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    const second = await world.server.createDeal({ name: "Oak Hollow", inputs: sampleDealInputs() });
    return { ...world, first, second };
  }

  it("serves each read's last good copy when the server can't be reached", async () => {
    const { outbox, network, first } = await seeded();
    const live = {
      deals: await outbox.listDeals(),
      deal: await outbox.getDeal(first.id),
      comps: await outbox.listComps(REGION),
      costBook: await outbox.getCostBook(REGION),
      market: await outbox.getMarketSettings(REGION),
      company: await outbox.getCompanySettings(),
    };
    network.down = "offline";
    const list = await outbox.listDeals();
    expect(list.deals).toEqual(live.deals.deals);
    expect(list.notice).toBe(NOTICE);
    expect(await outbox.getDeal(first.id)).toEqual(live.deal);
    expect(await outbox.listComps(REGION)).toEqual(live.comps);
    expect(await outbox.getCostBook(REGION)).toEqual(live.costBook);
    expect(await outbox.getMarketSettings(REGION)).toEqual(live.market);
    expect(await outbox.getCompanySettings()).toEqual(live.company);
  });

  it.each(["signedOut", "failed"] as const)("never stands in for a %s failure", async (kind) => {
    const { outbox, network, first } = await seeded();
    await outbox.listDeals();
    await outbox.getDeal(first.id);
    await outbox.listComps(REGION);
    await outbox.getCompanySettings();
    network.down = kind;
    await expect(outbox.listDeals()).rejects.toMatchObject({ kind });
    await expect(outbox.getDeal(first.id)).rejects.toMatchObject({ kind });
    await expect(outbox.listComps(REGION)).rejects.toMatchObject({ kind });
    await expect(outbox.getCompanySettings()).rejects.toMatchObject({ kind });
  });

  it("reads from the server only when asked: no outbox copy, no device copy", async () => {
    const { outbox, network, first } = await seeded();
    await outbox.getDeal(first.id);
    network.down = "offline";
    await outbox.saveDeal({ ...first, name: "Mine, waiting" }).catch(() => {});
    expect((await outbox.getDeal(first.id))?.name).toBe("Mine, waiting");
    await expect(outbox.getDeal(first.id, { fromServer: true })).rejects.toMatchObject({ kind: "offline" });
    network.down = null;
    expect((await outbox.getDeal(first.id, { fromServer: true }))?.name).toBe("Maple Street");
    expect(outbox.pending()).toHaveLength(1);
  });

  it("with no copy, fails offline as before", async () => {
    const { outbox, network, first } = await seeded();
    network.down = "offline";
    await expect(outbox.getDeal(first.id)).rejects.toMatchObject({ kind: "offline" });
    await expect(outbox.listComps(REGION)).rejects.toMatchObject({ kind: "offline" });
    await expect(outbox.getCostBook(REGION)).rejects.toMatchObject({ kind: "offline" });
  });

  it("lets the outbox win over the copy, for the deal and its row in the list", async () => {
    const { outbox, network, first, second } = await seeded();
    await outbox.listDeals();
    await outbox.getDeal(first.id);
    network.down = "offline";
    await outbox.saveDeal({ ...first, name: "Maple Street, renamed" }).catch(() => {});
    const unlisted = { ...first, id: "33333333-3333-4333-8333-333333333333", name: "Made offline" };
    outbox.queue(unlisted);
    expect((await outbox.getDeal(first.id))?.name).toBe("Maple Street, renamed");
    const list = await outbox.listDeals();
    expect(list.deals.map((d) => d.name).sort()).toEqual(["Made offline", "Maple Street, renamed", "Oak Hollow"]);
    expect(list.deals.find((d) => d.id === second.id)?.name).toBe("Oak Hollow");
    expect(list.notice).toBe(NOTICE);
  });

  describe("stays in step with writes, so going offline right after one still opens", () => {
    it("saveDeal and createDeal", async () => {
      const { outbox, network, first } = await seeded();
      await outbox.listDeals();
      const saved = await outbox.saveDeal({ ...first, name: "Saved online" });
      const created = await outbox.createDeal({ name: "Created online", inputs: sampleDealInputs() });
      network.down = "offline";
      expect(await outbox.getDeal(first.id)).toEqual(saved);
      expect(await outbox.getDeal(created.id)).toEqual(created);
      const names = (await outbox.listDeals()).deals.map((d) => d.name);
      expect(names).toContain("Saved online");
      expect(names).toContain("Created online");
      expect(names).not.toContain("Maple Street");
    });

    it("a sync replay", async () => {
      const { outbox, network, first } = await seeded();
      await outbox.listDeals();
      network.down = "offline";
      await outbox.saveDeal({ ...first, name: "Synced later" }).catch(() => {});
      network.down = null;
      await outbox.syncNow();
      network.down = "offline";
      expect(outbox.pending()).toEqual([]);
      expect((await outbox.getDeal(first.id))?.name).toBe("Synced later");
    });

    it("deleteDeal and resetDeals", async () => {
      const { outbox, network, first, second } = await seeded();
      await outbox.listDeals();
      await outbox.getDeal(first.id);
      await outbox.deleteDeal(first.id);
      network.down = "offline";
      await expect(outbox.getDeal(first.id)).rejects.toMatchObject({ kind: "offline" });
      expect((await outbox.listDeals()).deals.map((d) => d.id)).toEqual([second.id]);
      network.down = null;
      await outbox.resetDeals();
      network.down = "offline";
      expect((await outbox.listDeals()).deals).toEqual([]);
    });

    it("saveComp and deleteComp", async () => {
      const { outbox, network } = await seeded();
      const before = await outbox.listComps(REGION);
      const [first, second] = before;
      await outbox.saveComp({ ...first!, address: "1 Changed Street" });
      await outbox.deleteComp(second!.id);
      network.down = "offline";
      const copied = await outbox.listComps(REGION);
      expect(copied).toHaveLength(before.length - 1);
      expect(copied.find((c) => c.id === first!.id)?.address).toBe("1 Changed Street");
      expect(copied.some((c) => c.id === second!.id)).toBe(false);
    });

    it("saveCompanySettings and saveMarketSettings", async () => {
      const { outbox, network } = await seeded();
      await outbox.getCompanySettings();
      await outbox.getMarketSettings(REGION);
      const company = { rules: DEFAULT_RULES, contingencyPct: 0.07 };
      const market = { ...DEFAULT_MARKET_SETTINGS, marketCondition: "slow" as const };
      await outbox.saveCompanySettings(company);
      await outbox.saveMarketSettings(market);
      network.down = "offline";
      expect(await outbox.getCompanySettings()).toEqual(company);
      expect((await outbox.getMarketSettings(REGION)).marketCondition).toBe("slow");
    });
  });

  it("ignores a copy that does not read back, and says so once", async () => {
    const { outbox, network, device } = await seeded();
    await outbox.listComps(REGION);
    device.setItem(`${CACHE}comps:${REGION}`, JSON.stringify({ version: 1, comps: [{ id: 3 }] }));
    network.down = "offline";
    await expect(outbox.listComps(REGION)).rejects.toMatchObject({ kind: "offline" });
    await expect(outbox.listComps(REGION)).rejects.toMatchObject({ kind: "offline" });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("still answers from the server when the device is full, and says so once", async () => {
    class Full extends MemoryStorage {
      override setItem(key: string, value: string): void {
        if (key.startsWith(CACHE)) throw new DOMException("full", "QuotaExceededError");
        super.setItem(key, value);
      }
    }
    const server = createLocalRepository(new MemoryStorage());
    for (const comp of testSampleComps()) await server.saveComp(comp);
    const outbox = createOfflineRepository(server, new Full(), SCOPE);
    expect(await outbox.listComps(REGION)).toHaveLength(testSampleComps().length);
    expect(await outbox.getCostBook(REGION)).toEqual(await server.getCostBook(REGION));
    expect(logged).toHaveBeenCalledTimes(1);
  });

  describe("a read that lands after a newer write keeps the newer value", () => {
    /** Holds `method`'s next answer until the returned release is called. */
    function held<K extends keyof Repository>(server: Repository, method: K) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const real = (server[method] as (...args: unknown[]) => Promise<unknown>).bind(server);
      vi.spyOn(server, method).mockImplementationOnce((async (...args: unknown[]) => {
        const answer = await real(...args);
        await gate;
        return answer;
      }) as never);
      return release;
    }

    it("for comps", async () => {
      const { outbox, network, server } = await seeded();
      const [first] = await outbox.listComps(REGION);
      const release = held(server, "listComps");
      const reading = outbox.listComps(REGION);
      await outbox.saveComp({ ...first!, address: "1 Saved After" });
      release();
      await reading;
      network.down = "offline";
      expect((await outbox.listComps(REGION)).find((c) => c.id === first!.id)?.address).toBe("1 Saved After");
    });

    it("for the deals", async () => {
      const { outbox, network, server } = await seeded();
      await outbox.listDeals();
      const release = held(server, "listDeals");
      const reading = outbox.listDeals();
      const created = await outbox.createDeal({ name: "Made meanwhile", inputs: sampleDealInputs() });
      release();
      await reading;
      network.down = "offline";
      expect((await outbox.listDeals()).deals.map((d) => d.id)).toContain(created.id);
    });

    it("for the company settings", async () => {
      const { outbox, network, server } = await seeded();
      await outbox.getCompanySettings();
      const release = held(server, "getCompanySettings");
      const reading = outbox.getCompanySettings();
      await outbox.saveCompanySettings({ rules: DEFAULT_RULES, contingencyPct: 0.09 });
      release();
      await reading;
      network.down = "offline";
      expect((await outbox.getCompanySettings()).contingencyPct).toBe(0.09);
    });
  });

  it("puts the outbox first on a full device: the copy goes, and the edit is kept", async () => {
    /** A store with a size limit, as a browser's is. */
    class Limited extends MemoryStorage {
      limit = Infinity;
      used(): number {
        let total = 0;
        for (let i = 0; i < this.length; i++) {
          const k = this.key(i) ?? "";
          total += k.length + (this.getItem(k) ?? "").length;
        }
        return total;
      }
      override setItem(k: string, value: string): void {
        const before = this.getItem(k);
        const grows = k.length + value.length - (before === null ? 0 : k.length + before.length);
        if (this.used() + grows > this.limit) throw new DOMException("full", "QuotaExceededError");
        super.setItem(k, value);
      }
    }
    const server = createLocalRepository(new MemoryStorage());
    const first = await server.createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    const device = new Limited();
    const network: { down: DataErrorKind | null } = { down: null };
    const remote = {
      ...server,
      saveDeal: async (d: StoredDeal) => {
        if (network.down) throw new DataError("down", { kind: network.down });
        return server.saveDeal(d);
      },
    } as Repository;
    const outbox = createOfflineRepository(remote, device, SCOPE);
    await outbox.getCostBook(REGION);
    expect(cacheKeys(device)).toEqual([`${CACHE}costBook:${REGION}`]);
    // The device is now full: an outbox entry fits only once the copy is gone.
    device.limit = device.used() + 100;
    network.down = "offline";
    await outbox.saveDeal({ ...first, name: "Edited on a full device" }).catch(() => {});
    expect(outbox.pending().map((p) => p.dealName)).toEqual(["Edited on a full device"]);
    expect(cacheKeys(device)).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("stopDeviceCopy keeps the copy as it is and adds nothing more", async () => {
    const { outbox, network, device } = await seeded();
    await outbox.listDeals();
    const kept = cacheKeys(device);
    outbox.stopDeviceCopy();
    await outbox.listComps(REGION);
    await outbox.getCompanySettings();
    expect(cacheKeys(device)).toEqual(kept);
    network.down = "offline";
    expect((await outbox.listDeals()).deals.length).toBeGreaterThan(0);
  });

  it("forgetDeviceCopy removes this owner's copy and nothing else, the outbox included", async () => {
    const { outbox, network, device, first } = await seeded();
    await outbox.listDeals();
    await outbox.listComps(REGION);
    network.down = "offline";
    await outbox.saveDeal({ ...first, name: "Waiting" }).catch(() => {});
    expect(cacheKeys(device).length).toBeGreaterThan(0);

    outbox.forgetDeviceCopy();
    expect(cacheKeys(device)).toEqual([]);
    expect(outbox.pending().map((p) => p.dealName)).toEqual(["Waiting"]);
    await expect(outbox.listComps(REGION)).rejects.toMatchObject({ kind: "offline" });
  });

  it("serves one owner's copy to that owner only", async () => {
    const { outbox, network, device, server } = await seeded();
    await outbox.listDeals();
    await outbox.listComps(REGION);
    network.down = "offline";
    const other = createOfflineRepository(
      { ...server, listDeals: () => Promise.reject(new DataError("down", { kind: "offline" })) },
      device,
      "user-b",
    );
    await expect(other.listDeals()).rejects.toMatchObject({ kind: "offline" });
  });
});

describe("reads while the server is slow or the browser is offline", () => {
  const REGION = "utah-north";

  /** A server whose reads wait until the test answers them, over a device that already holds a copy of them. */
  async function slowServer() {
    const server = createLocalRepository(new MemoryStorage());
    for (const comp of testSampleComps()) await server.saveComp(comp);
    const maple = await server.createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    const device = new MemoryStorage();
    const outbox = createOfflineRepository(server, device, SCOPE);
    // Read once online, so the device holds a copy of each.
    await outbox.listDeals();
    await outbox.getDeal(maple.id);
    await outbox.listComps(REGION);
    const gates: (() => void)[] = [];
    const hold = <K extends keyof Repository>(method: K) => {
      const real = (server[method] as (...args: unknown[]) => Promise<unknown>).bind(server);
      vi.spyOn(server, method).mockImplementation((async (...args: unknown[]) => {
        await new Promise<void>((resolve) => gates.push(resolve));
        return real(...args);
      }) as never);
    };
    const answer = async () => {
      for (const open of gates.splice(0)) open();
      for (let turn = 0; turn < 5; turn += 1) await vi.advanceTimersByTimeAsync(0);
    };
    return { server, device, outbox, maple, hold, answer };
  }

  /** The browser reports no network (`navigator.onLine` is false). These tests run in Node, which has no such flag. */
  const browserSaysOffline = () => vi.stubGlobal("navigator", { onLine: false });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("answers from the copy once the grace is up, then keeps the server's late answer and tells its listeners", async () => {
    const { server, outbox, maple, hold, answer } = await slowServer();
    await server.saveDeal({ ...maple, name: "Maple Street, renamed elsewhere" });
    hold("listDeals");
    const heard = vi.fn();
    outbox.onRefreshed(heard);
    let list: DealListResult | undefined;
    void outbox.listDeals().then((answered) => (list = answered));

    await vi.advanceTimersByTimeAsync(READ_GRACE_MS - 1);
    expect(list).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(list?.deals.map((d) => d.name)).toEqual(["Maple Street"]);
    expect(list?.notice).toBe(NOTICE);
    expect(heard).not.toHaveBeenCalled();

    await answer();
    expect(heard).toHaveBeenCalledTimes(1);
    const refreshed = heard.mock.calls[0]?.[0] as { read: string; value: DealListResult };
    expect(refreshed.read).toBe("deals");
    expect(refreshed.value.deals.map((d) => d.name)).toEqual(["Maple Street, renamed elsewhere"]);
    expect(refreshed.value.notice).toBeUndefined();
    // The copy now holds the server's answer.
    vi.mocked(server.listDeals).mockRejectedValue(offlineError());
    expect((await outbox.listDeals()).deals.map((d) => d.name)).toEqual(["Maple Street, renamed elsewhere"]);
  });

  it("answers from the copy at once when the browser says it is offline, and still lets the server read finish", async () => {
    const { outbox, maple, hold, answer } = await slowServer();
    hold("listComps");
    hold("getDeal");
    browserSaysOffline();
    const heard = vi.fn();
    outbox.onRefreshed(heard);
    let comps: unknown;
    let found: StoredDeal | null | undefined;
    void outbox.listComps(REGION).then((answered) => (comps = answered));
    void outbox.getDeal(maple.id).then((answered) => (found = answered));
    await vi.advanceTimersByTimeAsync(0);
    expect(comps).toHaveLength(testSampleComps().length);
    expect(found?.name).toBe("Maple Street");

    await answer();
    expect(heard.mock.calls.map(([refreshed]) => (refreshed as { read: string }).read).sort()).toEqual(["comps", "deal"]);
    expect(heard.mock.calls.find(([r]) => (r as { read: string }).read === "comps")?.[0]).toMatchObject({ region: REGION });
    expect(heard.mock.calls.find(([r]) => (r as { read: string }).read === "deal")?.[0]).toMatchObject({ id: maple.id });
  });

  it("with no copy, waits for the server however long it takes", async () => {
    const { outbox, hold, answer } = await slowServer();
    hold("getMarketSettings");
    browserSaysOffline();
    let settings: unknown;
    void outbox.getMarketSettings(REGION).then((answered) => (settings = answered));
    await vi.advanceTimersByTimeAsync(10 * READ_GRACE_MS);
    expect(settings).toBeUndefined();
    await answer();
    expect(settings).toMatchObject({ region: REGION });
  });

  it("takes a server answer that comes within the grace, tells no one, and leaves no timer", async () => {
    const { outbox, maple } = await slowServer();
    const heard = vi.fn();
    outbox.onRefreshed(heard);
    const timers = vi.getTimerCount();
    expect((await outbox.getDeal(maple.id))?.name).toBe("Maple Street");
    expect((await outbox.listDeals()).notice).toBeUndefined();
    await vi.advanceTimersByTimeAsync(READ_GRACE_MS);
    expect(heard).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(timers);
  });

  it("never races a read from the server only (Load their version)", async () => {
    const { outbox, maple, hold, answer } = await slowServer();
    hold("getDeal");
    browserSaysOffline();
    let found: StoredDeal | null | undefined;
    void outbox.getDeal(maple.id, { fromServer: true }).then((answered) => (found = answered));
    await vi.advanceTimersByTimeAsync(10 * READ_GRACE_MS);
    expect(found).toBeUndefined();
    await answer();
    expect(found?.id).toBe(maple.id);
  });

  it("tells no one of a late list when the copy was written meanwhile: that write is newer", async () => {
    const { outbox, hold, answer } = await slowServer();
    hold("listDeals");
    browserSaysOffline();
    const heard = vi.fn();
    outbox.onRefreshed(heard);
    await outbox.listDeals();
    const created = await outbox.createDeal({ name: "Made meanwhile", inputs: sampleDealInputs() });
    await answer();
    expect(heard).not.toHaveBeenCalled();
    browserSaysOffline();
    expect((await outbox.listDeals()).deals.map((d) => d.id)).toContain(created.id);
  });

  it("tells no one of a late deal that has an edit waiting: the outbox's copy is the owner's", async () => {
    const { outbox, maple, hold, answer } = await slowServer();
    hold("getDeal");
    browserSaysOffline();
    const heard = vi.fn();
    outbox.onRefreshed(heard);
    await outbox.getDeal(maple.id);
    outbox.queue({ ...maple, name: "Edited meanwhile" });
    await answer();
    expect(heard).not.toHaveBeenCalled();
  });

  it("tells no one when the late answer is that the deal is gone: the owner's open copy is left to the save to settle", async () => {
    const { server, outbox, maple, hold, answer } = await slowServer();
    await server.deleteDeal(maple.id);
    hold("getDeal");
    browserSaysOffline();
    const heard = vi.fn();
    outbox.onRefreshed(heard);
    expect((await outbox.getDeal(maple.id))?.name).toBe("Maple Street");
    await answer();
    expect(heard).not.toHaveBeenCalled();
  });
});
