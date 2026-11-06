import { DataError } from "../types";
import type { DealListResult, Repository, StoredDeal } from "../types";

/** One deal waiting on this device to reach the server. `problem` is set when the server refused it. */
export interface PendingSave {
  dealId: string;
  dealName: string;
  queuedAt: string;
  problem?: "conflict" | "deleted";
}

export interface SyncResult {
  synced: number;
  remaining: number;
  /** The run stopped because the server could not be reached or the owner is signed out. */
  stoppedOffline: boolean;
}

/** A `Repository` whose deal saves are kept on the device until the server has them. */
export interface OfflineRepository extends Repository {
  pending(): PendingSave[];
  subscribe(listener: () => void): () => void;
  syncNow(): Promise<SyncResult>;
  /** Gives up the waiting save of a deal (the owner chose the server's version). */
  discardPending(dealId: string): void;
}

export function isOfflineRepository(repository: Repository): repository is OfflineRepository {
  const candidate = repository as Partial<OfflineRepository>;
  return (
    typeof candidate.pending === "function" &&
    typeof candidate.subscribe === "function" &&
    typeof candidate.syncNow === "function" &&
    typeof candidate.discardPending === "function"
  );
}

const OFFLINE = "Offline — your changes are saved on this device and will sync.";
const SIGNED_OUT = "Signed out — sign in to sync. Your changes are saved on this device.";
const LIST_NOTICE = "Showing what's saved on this device — can't reach the server.";

interface Entry {
  /** Monotonic: tells one queued save from the next, and orders the replay. */
  seq: number;
  queuedAt: string;
  /** The `updatedAt` the server had when the first unsynced edit began. */
  base: string;
  deal: StoredDeal;
  overwrite?: boolean;
  problem?: "conflict" | "deleted";
}

const isEntry = (value: unknown): value is Entry => {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<Entry>;
  const d = e.deal as Partial<StoredDeal> | undefined;
  return (
    typeof e.seq === "number" &&
    typeof e.queuedAt === "string" &&
    typeof e.base === "string" &&
    typeof d === "object" &&
    d !== null &&
    typeof d.id === "string" &&
    typeof d.name === "string"
  );
};

/**
 * Wraps `remote` so every deal save lands in a per-user outbox in `storage` before the network call. The outbox is
 * best effort: if the browser refuses the write, the save still goes to the server.
 */
export function createOfflineRepository(remote: Repository, storage: Storage, scope: string): OfflineRepository {
  const key = `spec-studio:outbox:${scope}`;
  const listeners = new Set<() => void>();
  let reportedUnreadable = false;
  let reportedWrite = false;
  let lastSeq = 0;
  let lastQueuedMs = 0;
  let running: Promise<SyncResult> | null = null;
  /** Deals with a save in flight from `saveDeal`, which a sync run leaves to it. */
  const inFlight = new Map<string, number>();

  function read(): Entry[] {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return [];
    }
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as { entries?: unknown };
      if (!Array.isArray(parsed.entries)) throw new Error("no entries");
      return parsed.entries.filter(isEntry).sort((a, b) => a.seq - b.seq);
    } catch (error) {
      if (!reportedUnreadable) {
        reportedUnreadable = true;
        console.error("The offline outbox could not be read; treating it as empty.", error);
      }
      return [];
    }
  }

  function write(entries: Entry[]): void {
    try {
      if (entries.length === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify({ version: 1, entries }));
    } catch (error) {
      if (!reportedWrite) {
        reportedWrite = true;
        console.error("The offline outbox could not be written; edits are only sent to the server.", error);
      }
    }
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  /** Applies `change` to the stored entries and writes them back. */
  function update(change: (entries: Entry[]) => Entry[]): void {
    write(change(read()));
    notify();
  }

  function succeeded(entry: Entry, saved: StoredDeal): void {
    update((entries) =>
      entries.flatMap((e) => {
        if (e.deal.id !== entry.deal.id) return [e];
        if (e.seq === entry.seq) return [];
        // A newer save is waiting: the server now holds `saved`, so that is what the newer one is based on.
        return [{ ...e, base: saved.updatedAt }];
      }),
    );
  }

  function failed(entry: Entry, error: unknown): void {
    if (error instanceof DataError && (error.kind === "conflict" || error.kind === "deleted")) {
      const problem = error.kind;
      update((entries) => entries.map((e) => (e.seq === entry.seq ? { ...e, problem } : e)));
    }
  }

  const toPending = (e: Entry): PendingSave => ({
    dealId: e.deal.id,
    dealName: e.deal.name,
    queuedAt: e.queuedAt,
    ...(e.problem ? { problem: e.problem } : {}),
  });
  const localCopy = (e: Entry): StoredDeal => ({ ...e.deal, updatedAt: e.base });

  async function saveDeal(deal: StoredDeal, options?: { overwrite?: boolean }): Promise<StoredDeal> {
    // Everything up to the remote call is synchronous: a page that closes right now has still kept the edit.
    const entries = read();
    const previous = entries.find((e) => e.deal.id === deal.id);
    lastSeq = Math.max(lastSeq, ...entries.map((e) => e.seq)) + 1;
    lastQueuedMs = Math.max(Date.now(), lastQueuedMs + 1);
    const entry: Entry = {
      seq: lastSeq,
      queuedAt: new Date(lastQueuedMs).toISOString(),
      base: previous?.base ?? deal.updatedAt,
      deal,
      ...(options?.overwrite ? { overwrite: true } : {}),
    };
    write([...entries.filter((e) => e.deal.id !== deal.id), entry]);
    notify();

    inFlight.set(deal.id, entry.seq);
    try {
      const saved = await remote.saveDeal({ ...deal, updatedAt: entry.base }, options);
      succeeded(entry, saved);
      return saved;
    } catch (error) {
      failed(entry, error);
      if (error instanceof DataError && error.kind === "offline") {
        throw new DataError(OFFLINE, { kind: "offline", recordId: error.recordId ?? deal.id, cause: error });
      }
      if (error instanceof DataError && error.kind === "signedOut") {
        throw new DataError(SIGNED_OUT, { kind: "signedOut", recordId: error.recordId ?? deal.id, cause: error });
      }
      throw error;
    } finally {
      if (inFlight.get(deal.id) === entry.seq) inFlight.delete(deal.id);
    }
  }

  async function run(): Promise<SyncResult> {
    let synced = 0;
    let stoppedOffline = false;
    for (const entry of read()) {
      if (entry.problem || inFlight.has(entry.deal.id)) continue;
      try {
        const saved = await remote.saveDeal(
          { ...entry.deal, updatedAt: entry.base },
          entry.overwrite ? { overwrite: true } : undefined,
        );
        succeeded(entry, saved);
        synced += 1;
      } catch (error) {
        failed(entry, error);
        if (error instanceof DataError && (error.kind === "offline" || error.kind === "signedOut")) {
          stoppedOffline = true;
          break;
        }
      }
    }
    return { synced, remaining: read().length, stoppedOffline };
  }

  return {
    pending: () => read().map(toPending),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    syncNow() {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
    discardPending(dealId) {
      if (!read().some((e) => e.deal.id === dealId)) return;
      update((entries) => entries.filter((e) => e.deal.id !== dealId));
    },
    saveDeal,
    async getDeal(id) {
      const entry = read().find((e) => e.deal.id === id);
      return entry ? localCopy(entry) : remote.getDeal(id);
    },
    async listDeals(): Promise<DealListResult> {
      const entries = read();
      let list: DealListResult;
      try {
        list = await remote.listDeals();
      } catch (error) {
        if (error instanceof DataError && error.kind === "offline" && entries.length > 0) {
          return { deals: entries.map(localCopy), problems: [], notice: LIST_NOTICE };
        }
        throw error;
      }
      // Read again: a save may have been queued while the list was on its way.
      const current = read();
      if (current.length === 0) return list;
      const byId = new Map(current.map((e) => [e.deal.id, e]));
      const seen = new Set<string>();
      const deals = list.deals.map((d) => {
        const e = byId.get(d.id);
        if (e) seen.add(d.id);
        return e ? localCopy(e) : d;
      });
      for (const e of current) if (!seen.has(e.deal.id)) deals.push(localCopy(e));
      return { ...list, deals };
    },
    createDeal: (input) => remote.createDeal(input),
    deleteDeal: (id) => remote.deleteDeal(id),
    resetDeals: () => remote.resetDeals(),
    listComps: (region) => remote.listComps(region),
    saveComp: (comp) => remote.saveComp(comp),
    deleteComp: (id) => remote.deleteComp(id),
    getCostBook: (region) => remote.getCostBook(region),
    getMarketSettings: (region) => remote.getMarketSettings(region),
    getCompanySettings: () => remote.getCompanySettings(),
    saveCompanySettings: (settings) => remote.saveCompanySettings(settings),
    saveMarketSettings: (settings) => remote.saveMarketSettings(settings),
  };
}
