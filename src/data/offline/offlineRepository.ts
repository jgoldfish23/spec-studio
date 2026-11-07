import type { Comp, CostBookView, MarketSettings } from "@engine";
import { DataError } from "../types";
import type { CompanySettings, DealListResult, Repository, StoredDeal } from "../types";
import { createDeviceCopy } from "./deviceCopy";

/**
 * How long a read waits for the server when the device holds a copy to show instead. One bar, or a session auth-js is
 * still trying to renew offline (up to 30 s), must not leave the owner looking at a blank screen: after this the copy
 * is shown, and the server's answer, if it comes, replaces it (`onRefreshed`).
 */
export const READ_GRACE_MS = 3_000;

/** A read that was answered from the device's copy, then got the server's answer after all. */
export type Refreshed =
  | { read: "deals"; value: DealListResult }
  | { read: "deal"; id: string; value: StoredDeal }
  | { read: "comps"; region: string; value: Comp[] }
  | { read: "costBook"; region: string; value: CostBookView }
  | { read: "marketSettings"; region: string; value: MarketSettings }
  | { read: "companySettings"; value: CompanySettings };

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
  /**
   * With `fromServer`, the server's deal only: never the outbox's copy nor the device copy, which are this owner's own
   * version (for "Load their version"). Fails as the server does.
   */
  getDeal(id: string, options?: { fromServer?: boolean }): Promise<StoredDeal | null>;
  pending(): PendingSave[];
  subscribe(listener: () => void): () => void;
  syncNow(): Promise<SyncResult>;
  /** Gives up the waiting save of a deal (the owner chose the server's version). */
  discardPending(dealId: string): void;
  /**
   * Writes (or replaces) the deal's outbox entry now and makes no network call; `syncNow` sends it later. For a page that
   * is closing while a save is still running. Saves are checked against the `updatedAt` the server had when the first
   * waiting edit began; with `rebase`, the deal's own `updatedAt` is that stamp from now on ("Keep mine": the owner's
   * version, on top of the server's version they were shown).
   */
  queue(deal: StoredDeal, options?: { rebase?: boolean }): void;
  /** Removes this owner's copy of reads from the device (on an explicit sign-out). The outbox stays: it holds work. */
  forgetDeviceCopy(): void;
  /** The owner's session ended: the copy stays as it is, and a read still on its way adds nothing to it. */
  stopDeviceCopy(): void;
  /**
   * Calls `listener` with the server's answer to a read that was answered from the device's copy (the server was slow,
   * or the browser said it was offline), so the screens can show it. Returns the unsubscribe.
   */
  onRefreshed(listener: (refreshed: Refreshed) => void): () => void;
}

export function isOfflineRepository(repository: Repository): repository is OfflineRepository {
  const candidate = repository as Partial<OfflineRepository>;
  return (
    typeof candidate.pending === "function" &&
    typeof candidate.subscribe === "function" &&
    typeof candidate.syncNow === "function" &&
    typeof candidate.discardPending === "function" &&
    typeof candidate.queue === "function"
  );
}

const OFFLINE = "Offline — your changes are saved on this device and will sync.";
const SIGNED_OUT = "Signed out — sign in to sync. Your changes are saved on this device.";
const LIST_NOTICE = "Showing what's saved on this device — can't reach the server.";

interface Entry {
  /** Monotonic: tells one queued save from the next, and orders the replay. */
  seq: number;
  queuedAt: string;
  /** The `updatedAt` the server had when the first unsynced edit began (or the one "Keep mine" was made on). */
  base: string;
  deal: StoredDeal;
  /** The repository instance (tab) that wrote the entry: seq numbers repeat between instances. */
  writer?: string;
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

const isOffline = (error: unknown): boolean => error instanceof DataError && error.kind === "offline";

/** The browser says it has no network at all. Its "online" means less: a network, not a server that answers. */
const browserOffline = (): boolean => globalThis.navigator?.onLine === false;

/** Makes the request now; a request that throws as it starts is a rejected promise like any other failure. */
const ask = <T>(request: () => Promise<T>): Promise<T> => new Promise<T>((resolve) => resolve(request()));

/** A write refused because the store is full, as each browser says it. */
const isQuotaError = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014);

/**
 * Wraps `remote` so every deal save lands in a per-user outbox in `storage` before the network call. The outbox is
 * best effort: if the browser refuses the write, the save still goes to the server.
 *
 * It also keeps a device copy of the owner's reads (`deviceCopy.ts`): each successful read, and what each successful
 * write returns, is kept, so a returning owner can open the app, a deal and its figures offline. The copy answers a
 * read when the server can't be reached (`DataError` `offline`), at once when the browser says it is offline, and when
 * the server has not answered within `READ_GRACE_MS`. Any other failure throws as before. A read the copy answered
 * still goes on: when the server answers, the copy keeps it and `onRefreshed` listeners hear it. For deals the outbox
 * still wins: an outbox copy overlays the copied deal and its row in the list.
 */
export function createOfflineRepository(remote: Repository, storage: Storage, scope: string): OfflineRepository {
  const key = `spec-studio:outbox:${scope}`;
  const listeners = new Set<() => void>();
  const refreshListeners = new Set<(refreshed: Refreshed) => void>();
  let reportedUnreadable = false;
  let reportedWrite = false;
  // The device copy reports its own refused writes, once, apart from the outbox's.
  const copy = createDeviceCopy(storage, scope);
  let reportedListener = false;
  /** Tells this instance's entries from another tab's: another tab's entry is not ours to rebase. */
  const writer = crypto.randomUUID();
  const isSame = (a: Entry, b: Entry) => a.seq === b.seq && a.deal.id === b.deal.id && a.writer === b.writer;
  /** Per deal, the last stamp this instance saw the server give: a save made from `from` is really based on `to`. */
  const advanced = new Map<string, { from: string; to: string }>();
  /** Deals a sync run is sending right now, and the gate that opens when that send is done. */
  const replaying = new Map<string, Promise<string | null>>();
  let lastSeq = 0;
  let lastQueuedMs = 0;
  let running: Promise<SyncResult> | null = null;
  /** Deals with a save in flight from `saveDeal`, which a sync run leaves to it. */
  const inFlight = new Map<string, number>();

  function read(): Entry[] {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      if (!reportedUnreadable) {
        reportedUnreadable = true;
        console.error("The offline outbox could not be read; treating it as empty.", error);
      }
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
    const save = () => {
      if (entries.length === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify({ version: 1, entries }));
    };
    try {
      save();
    } catch (error) {
      if (!isQuotaError(error)) return reportWrite(error);
      // The outbox holds work not saved anywhere else; the copy of reads can be fetched again. Make room, try once more.
      copy.forget();
      try {
        save();
      } catch (again) {
        reportWrite(again);
      }
    }
  }

  function reportWrite(error: unknown): void {
    if (reportedWrite) return;
    reportedWrite = true;
    console.error("The offline outbox could not be written; edits are only sent to the server.", error);
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        if (!reportedListener) {
          reportedListener = true;
          console.error("An offline outbox listener threw.", error);
        }
      }
    }
  }

  function refreshed(value: Refreshed): void {
    for (const listener of [...refreshListeners]) {
      try {
        listener(value);
      } catch (error) {
        if (!reportedListener) {
          reportedListener = true;
          console.error("An offline outbox listener threw.", error);
        }
      }
    }
  }

  /** Applies `change` to the stored entries and writes them back. */
  function update(change: (entries: Entry[]) => Entry[]): void {
    write(change(read()));
    notify();
  }

  function succeeded(entry: Entry, saved: StoredDeal): void {
    copy.putDeal(saved);
    advanced.set(entry.deal.id, { from: entry.base, to: saved.updatedAt });
    update((entries) =>
      entries.flatMap((e) => {
        if (e.deal.id !== entry.deal.id) return [e];
        if (isSame(e, entry)) return [];
        // A newer save of ours is waiting: the server now holds `saved`, so that is what it is based on.
        if (e.writer !== writer) return [e];
        return [{ ...e, base: saved.updatedAt }];
      }),
    );
  }

  function failed(entry: Entry, error: unknown): void {
    if (error instanceof DataError && (error.kind === "conflict" || error.kind === "deleted")) {
      const problem = error.kind;
      // The server no longer has a deleted deal: neither does the copy of reads, so it does not list it offline.
      if (problem === "deleted") copy.removeDeal(entry.deal.id);
      update((entries) => entries.map((e) => (isSame(e, entry) ? { ...e, problem } : e)));
    }
  }

  const toPending = (e: Entry): PendingSave => ({
    dealId: e.deal.id,
    dealName: e.deal.name,
    queuedAt: e.queuedAt,
    ...(e.problem ? { problem: e.problem } : {}),
  });
  const localCopy = (e: Entry): StoredDeal => ({ ...e.deal, updatedAt: e.base });

  /**
   * `deals` with each outbox copy in place of its row. A list from the server is the whole truth about which deals
   * exist, so an outbox entry for a deal it does not have is left out: that deal was deleted, and the entry waits for
   * the owner's choice (the header names it, and the deal opens from the outbox). The device's copy may be missing a
   * deal, so the outbox's other deals follow its list, except one the server already refused as deleted.
   */
  function withOutbox(deals: StoredDeal[], entries: Entry[], from: "server" | "device"): StoredDeal[] {
    if (entries.length === 0) return deals;
    const byId = new Map(entries.map((e) => [e.deal.id, e]));
    const seen = new Set<string>();
    const merged = deals.map((d) => {
      const e = byId.get(d.id);
      if (e) seen.add(d.id);
      return e ? localCopy(e) : d;
    });
    if (from === "device") {
      for (const e of entries) if (!seen.has(e.deal.id) && e.problem !== "deleted") merged.push(localCopy(e));
    }
    return merged;
  }

  /**
   * The server's answer, or the device's (`copied`, undefined when there is none) when the server can't be reached,
   * when the browser says it is offline, or when the server has not answered within `READ_GRACE_MS`. A server answer
   * that comes after the copy answered goes to `late`.
   */
  function raced<T>(server: Promise<T>, copied: () => T | undefined, late: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let answered = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const fromCopy = (): boolean => {
        const value = copied();
        if (value === undefined) return false;
        answered = true;
        resolve(value);
        return true;
      };
      server.then(
        (value) => {
          clearTimeout(grace);
          if (answered) return late(value);
          answered = true;
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(grace);
          if (answered || (isOffline(error) && fromCopy())) return;
          answered = true;
          reject(error);
        },
      );
      // With no copy, the read waits for the server however long it takes: there is nothing else to show.
      if (browserOffline()) fromCopy();
      else grace = setTimeout(() => void (answered || fromCopy()), READ_GRACE_MS);
    });
  }

  /**
   * Reads from the server and keeps what it says, unless the copy (`name`) was written while the read was out: that is
   * newer. The copy answers instead as `raced` says; a late answer it keeps is passed on as `refresh` makes it.
   */
  function readThrough<T>(
    name: string,
    read: () => Promise<T>,
    keep: (value: T) => void,
    copied: () => T | null,
    refresh: (value: T) => Refreshed,
  ): Promise<T> {
    const current = copy.since(name);
    let fresh = false;
    const server = ask(read).then((value) => {
      fresh = current();
      if (fresh) keep(value);
      return value;
    });
    return raced(
      server,
      () => copied() ?? undefined,
      (value) => {
        if (fresh) refreshed(refresh(value));
      },
    );
  }

  /**
   * Writes the deal's entry, replacing any older one, on the older one's base (the edits are one change to the server's
   * version), or with `rebase` on the deal's own `updatedAt`. Synchronous, so a closing page keeps the edit.
   */
  function enqueue(deal: StoredDeal, options?: { rebase?: boolean }): Entry {
    const entries = read();
    const previous = entries.find((e) => e.deal.id === deal.id);
    const stamp = advanced.get(deal.id);
    lastSeq = Math.max(lastSeq, ...entries.map((e) => e.seq)) + 1;
    lastQueuedMs = Math.max(Date.now(), lastQueuedMs + 1);
    const entry: Entry = {
      seq: lastSeq,
      queuedAt: new Date(lastQueuedMs).toISOString(),
      base: options?.rebase
        ? deal.updatedAt
        : (previous?.base ?? (stamp && deal.updatedAt === stamp.from ? stamp.to : deal.updatedAt)),
      deal,
      writer,
    };
    write([...entries.filter((e) => e.deal.id !== deal.id), entry]);
    notify();
    return entry;
  }

  async function saveDeal(deal: StoredDeal): Promise<StoredDeal> {
    const queued = enqueue(deal);
    let entry = queued;
    inFlight.set(deal.id, queued.seq);
    try {
      const gate = replaying.get(deal.id);
      if (gate) {
        // A sync run is sending the older edit of this deal: let it land, so this one is based on what it wrote.
        await gate;
        const current = read().find((e) => e.deal.id === deal.id);
        if (!current) return { ...deal, updatedAt: (await gate) ?? deal.updatedAt };
        if (!isSame(current, queued)) return { ...deal, updatedAt: current.base };
        entry = current;
      }
      const saved = await remote.saveDeal({ ...deal, updatedAt: entry.base });
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
      if (inFlight.get(deal.id) === queued.seq) inFlight.delete(deal.id);
    }
  }

  async function run(): Promise<SyncResult> {
    let synced = 0;
    let stoppedOffline = false;
    for (const listed of read()) {
      // Look again: the entry may have been replaced or discarded since the run began.
      const entry = read().find((e) => isSame(e, listed));
      if (!entry || entry.problem || inFlight.has(entry.deal.id)) continue;
      let open!: (stamp: string | null) => void;
      let landed: string | null = null;
      replaying.set(entry.deal.id, new Promise<string | null>((resolve) => (open = resolve)));
      try {
        const saved = await remote.saveDeal({ ...entry.deal, updatedAt: entry.base });
        succeeded(entry, saved);
        landed = saved.updatedAt;
        synced += 1;
      } catch (error) {
        failed(entry, error);
        if (error instanceof DataError && (error.kind === "offline" || error.kind === "signedOut")) {
          stoppedOffline = true;
          break;
        }
      } finally {
        replaying.delete(entry.deal.id);
        open(landed);
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
      advanced.delete(dealId);
      if (!read().some((e) => e.deal.id === dealId)) return;
      update((entries) => entries.filter((e) => e.deal.id !== dealId));
    },
    queue(deal, options) {
      enqueue(deal, options);
    },
    forgetDeviceCopy: () => copy.forget(),
    stopDeviceCopy: () => copy.stop(),
    onRefreshed(listener) {
      refreshListeners.add(listener);
      return () => void refreshListeners.delete(listener);
    },
    saveDeal,
    async getDeal(id, options) {
      const entry = options?.fromServer ? undefined : read().find((e) => e.deal.id === id);
      if (entry) return localCopy(entry);
      const current = copy.since("deals");
      let fresh = false;
      const server = ask(() => remote.getDeal(id)).then((found) => {
        fresh = current();
        if (fresh) {
          if (found) copy.refreshDeal(found);
          else copy.removeDeal(id);
        }
        return found;
      });
      // "Load their version": the server's deal or its failure, never this device's.
      if (options?.fromServer) return server;
      return raced(
        server,
        () => copy.deal(id),
        (found) => {
          // A deal the server no longer has is left on screen: the owner may be editing it, and the next save says
          // it was deleted, with the choice to keep it as a new deal. An edit waiting in the outbox is the owner's own.
          if (fresh && found && !read().some((e) => e.deal.id === id)) refreshed({ read: "deal", id, value: found });
        },
      );
    },
    listDeals(): Promise<DealListResult> {
      const copyUnchanged = copy.since("deals");
      let fresh = false;
      const server = ask(() => remote.listDeals()).then((list) => {
        fresh = copyUnchanged();
        if (fresh) copy.putDealList(list.deals);
        // Read the outbox after the list: a save may have been queued while the list was on its way.
        const current = read();
        return current.length === 0 ? list : { ...list, deals: withOutbox(list.deals, current, "server") };
      });
      const fromDevice = (): DealListResult | undefined => {
        const entries = read();
        const copied = copy.deals();
        if (copied === null && entries.length === 0) return undefined;
        return { deals: withOutbox(copied ?? [], entries, "device"), problems: [], notice: LIST_NOTICE };
      };
      return raced(server, fromDevice, (value) => {
        if (fresh) refreshed({ read: "deals", value });
      });
    },
    async createDeal(input) {
      const created = await remote.createDeal(input);
      copy.putDeal(created);
      return created;
    },
    async deleteDeal(id) {
      await remote.deleteDeal(id);
      copy.removeDeal(id);
      advanced.delete(id);
      if (read().some((e) => e.deal.id === id)) update((entries) => entries.filter((e) => e.deal.id !== id));
    },
    async resetDeals() {
      await remote.resetDeals();
      copy.removeAllDeals();
      advanced.clear();
      update(() => []);
    },
    listComps: (region) =>
      readThrough(
        `comps:${region}`,
        () => remote.listComps(region),
        (comps) => copy.putComps(region, comps),
        () => copy.comps(region),
        (value) => ({ read: "comps", region, value }),
      ),
    async saveComp(comp) {
      const saved = await remote.saveComp(comp);
      copy.putComp(saved);
      return saved;
    },
    async deleteComp(id) {
      await remote.deleteComp(id);
      copy.removeComp(id);
    },
    getCostBook: (region) =>
      readThrough(
        `costBook:${region}`,
        () => remote.getCostBook(region),
        (book) => copy.putCostBook(region, book),
        () => copy.costBook(region),
        (value) => ({ read: "costBook", region, value }),
      ),
    getMarketSettings: (region) =>
      readThrough(
        `marketSettings:${region}`,
        () => remote.getMarketSettings(region),
        (settings) => copy.putMarketSettings(region, settings),
        () => copy.marketSettings(region),
        (value) => ({ read: "marketSettings", region, value }),
      ),
    getCompanySettings: () =>
      readThrough(
        "companySettings",
        () => remote.getCompanySettings(),
        (settings) => copy.putCompanySettings(settings),
        () => copy.companySettings(),
        (value) => ({ read: "companySettings", value }),
      ),
    async saveCompanySettings(settings) {
      const saved = await remote.saveCompanySettings(settings);
      copy.putCompanySettings(saved);
      return saved;
    },
    async saveMarketSettings(settings) {
      const saved = await remote.saveMarketSettings(settings);
      copy.putMarketSettings(saved.region, saved);
      return saved;
    },
  };
}
