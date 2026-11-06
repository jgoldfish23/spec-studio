import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleDealInputs } from "../sample";
import { MemoryStorage } from "../local/memoryStorage";
import { DataError } from "../types";
import type { DealListResult, Repository, StoredDeal } from "../types";
import { createOfflineRepository, isOfflineRepository } from "./offlineRepository";

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

type SaveFn = (deal: StoredDeal, options?: { overwrite?: boolean }) => Promise<StoredDeal>;

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
  (JSON.parse(storage.getItem(key) ?? '{"entries":[]}') as { entries: { problem?: string; overwrite?: boolean; base: string; seq: number; deal: StoredDeal }[] }).entries;

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

  it("carries on to the remote when storage refuses the write, and reports once", async () => {
    storage.setItem = () => {
      throw new Error("quota");
    };
    await repo.saveDeal(deal());
    await repo.saveDeal(deal());
    expect(remote.saveDeal).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("passes the overwrite option through", async () => {
    await repo.saveDeal(deal(), { overwrite: true });
    expect(remote.saveDeal.mock.calls[0]?.[1]).toEqual({ overwrite: true });
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
  it("replays a stored overwrite", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal(), { overwrite: true }).catch(() => {});
    remote.saveDeal.mockClear();
    remote.saveDeal.mockImplementation(async (d) => ({ ...d, updatedAt: U1 }));
    await repo.syncNow();
    expect(remote.saveDeal.mock.calls[0]?.[1]).toEqual({ overwrite: true });
  });

  it("carries overwrite forward to a newer save, until a problem clears it", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ name: "One" }), { overwrite: true }).catch(() => {});
    await repo.saveDeal(deal({ name: "Two" })).catch(() => {});
    expect(entries(storage)[0]).toMatchObject({ overwrite: true });
    expect(remote.saveDeal.mock.calls[1]?.[1]).toEqual({ overwrite: true });
    remote.saveDeal.mockRejectedValue(new DataError("c", { kind: "conflict" }));
    await repo.saveDeal(deal({ name: "Three" })).catch(() => {});
    await repo.saveDeal(deal({ name: "Four" })).catch(() => {});
    expect(entries(storage)[0]?.overwrite).toBeUndefined();
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
  it("lists an outbox entry the remote does not have", async () => {
    remote.saveDeal.mockRejectedValue(offlineError());
    await repo.saveDeal(deal({ id: ID2, name: "Only here" })).catch(() => {});
    const list = await repo.listDeals();
    expect(list.deals.map((d) => d.name)).toEqual(["Lot", "Only here"]);
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

  it("drops a rebased entry's overwrite once the overwrite has landed", async () => {
    let release!: (d: StoredDeal) => void;
    remote.saveDeal.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = repo.saveDeal(deal({ name: "Mine" }), { overwrite: true });
    repo.queue(deal({ name: "Later" }));
    expect(entries(storage)[0]).toMatchObject({ overwrite: true });
    release(deal({ updatedAt: U1 }));
    await first;
    const left = entries(storage)[0];
    expect(left).toMatchObject({ base: U1 });
    expect(left?.overwrite).toBeUndefined();
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
