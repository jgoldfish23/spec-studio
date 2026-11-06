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
    await expect(repo.saveDeal(deal({ name: "Two" }))).rejects.toThrow();
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
    await repo.saveDeal(deal({ name: "Local", updatedAt: U0 })).catch(() => {});
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
    remote.saveDeal.mockClear();
    const result = await repo.syncNow();
    expect(result).toEqual({ synced: 2, remaining: 0, stoppedOffline: false });
    expect(remote.saveDeal.mock.calls.map((c) => c[0].id)).toEqual([ID2, ID]);
    expect(remote.saveDeal.mock.calls[0]?.[0].updatedAt).toBe(U0);
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
