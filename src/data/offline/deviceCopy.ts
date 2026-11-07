import { CompSchema, CostBookViewSchema, MarketSettingsSchema } from "@engine";
import type { Comp, CostBookView, MarketSettings } from "@engine";
import { CompanySettingsSchema, readDeal } from "../readBack";
import type { CompanySettings, StoredDeal } from "../types";

const PREFIX = "spec-studio:cache:";
const VERSION = 1;

/**
 * The last good copy of one owner's reads, kept on this device so the app can open offline: the deals, and for each
 * region the comps, cost book and market settings, and the company settings. One key per read, each a versioned
 * document (`{ version: 1, … }`), under `spec-studio:cache:<scope>:<read>[:<region>]`, apart from the outbox, so a
 * small write (one deal) never rewrites a large one (the cost book).
 */
export interface DeviceCopy {
  /** The deals as last listed (and since saved), newest edit first; null when none were ever kept. */
  deals(): StoredDeal[] | null;
  deal(id: string): StoredDeal | undefined;
  /** A full list read: replaces the copy. */
  putDealList(deals: StoredDeal[]): void;
  /** A deal just saved or created: first in the list, replacing its old copy. */
  putDeal(deal: StoredDeal): void;
  /** A deal just read: replaces its old copy where it is, or joins the end. */
  refreshDeal(deal: StoredDeal): void;
  removeDeal(id: string): void;
  removeAllDeals(): void;
  comps(region: string): Comp[] | null;
  putComps(region: string, comps: Comp[]): void;
  /** A comp just saved: into its region's copy, if there is one (one comp alone is not that region's list). */
  putComp(comp: Comp): void;
  removeComp(id: string): void;
  costBook(region: string): CostBookView | null;
  putCostBook(region: string, costBook: CostBookView): void;
  marketSettings(region: string): MarketSettings | null;
  putMarketSettings(region: string, settings: MarketSettings): void;
  companySettings(): CompanySettings | null;
  putCompanySettings(settings: CompanySettings): void;
  /** Removes this owner's whole copy (on an explicit sign-out). Later writes are kept as usual. */
  forget(): void;
  /**
   * The owner's session ended: what is kept stays, and nothing more is written, so a read already on its way cannot
   * add to the copy (or bring a forgotten one back).
   */
  stop(): void;
  /**
   * Starts a read of `name` (`deals`, `comps:<region>`, `costBook:<region>`, `marketSettings:<region>`,
   * `companySettings`): the check returned stays true until that copy is written. A read that finishes after a newer
   * write must not keep its older answer.
   */
  since(name: string): () => boolean;
}

/** Anything with zod's `safeParse`, so each schema keeps its own type. */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const parsedBy =
  <T>(schema: Parser<T>) =>
  (value: unknown): T | null => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

const CompsSchema = {
  safeParse: (value: unknown) => CompSchema.array().safeParse(value),
} as Parser<Comp[]>;

function parseDeals(value: unknown): StoredDeal[] | null {
  if (!Array.isArray(value)) return null;
  const deals: StoredDeal[] = [];
  for (const raw of value) {
    const read = readDeal(raw);
    if (!read.ok) return null;
    deals.push(read.deal);
  }
  return deals;
}

/**
 * Removes every other owner's copy of reads from `storage`, for when `ownerId` signs in on this device: what someone
 * else last read here must not stay readable in the browser. Outboxes are not copies and are left alone: they hold
 * work, which waits for its own owner. Best effort.
 */
export function forgetOtherOwnersCopies(storage: Storage, ownerId: string): void {
  const own = `${PREFIX}${ownerId}:`;
  try {
    const others: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(PREFIX) && !key.startsWith(own)) others.push(key);
    }
    for (const key of others) storage.removeItem(key);
  } catch (error) {
    console.error("Another owner's copy of their data on this device could not be removed.", error);
  }
}

/**
 * The device copy of one owner's reads in `storage`. Reads check what they find against the same schemas the
 * repositories use: a copy that does not read back is ignored (and reported once), never thrown. Writes are best
 * effort: a full or blocked store is reported once, and the app goes on without a copy.
 */
export function createDeviceCopy(storage: Storage, scope: string): DeviceCopy {
  const base = `${PREFIX}${scope}:`;
  const dealsKey = `${base}deals`;
  const compsKey = (region: string) => `${base}comps:${region}`;
  const costBookKey = (region: string) => `${base}costBook:${region}`;
  const marketKey = (region: string) => `${base}marketSettings:${region}`;
  const companyKey = `${base}companySettings`;
  let reportedRead = false;
  let reportedWrite = false;
  let stopped = false;
  /** Writes per key, for `since`. */
  const writes = new Map<string, number>();
  const bump = (key: string) => writes.set(key, (writes.get(key) ?? 0) + 1);

  function reportRead(error: unknown): void {
    if (reportedRead) return;
    reportedRead = true;
    console.error(
      "The copy of your data on this device could not be read; ignoring it.",
      error,
    );
  }

  function reportWrite(error: unknown): void {
    if (reportedWrite) return;
    reportedWrite = true;
    console.error(
      "The copy of your data on this device could not be saved; going on without it.",
      error,
    );
  }

  function read<T>(
    key: string,
    field: string,
    parse: (value: unknown) => T | null,
  ): T | null {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      const doc: unknown = JSON.parse(raw);
      if (
        typeof doc !== "object" ||
        doc === null ||
        (doc as { version?: unknown }).version !== VERSION
      ) {
        throw new Error(`${key} is not a version ${VERSION} copy`);
      }
      const value = parse((doc as Record<string, unknown>)[field]);
      if (value === null) throw new Error(`${key} does not read back`);
      return value;
    } catch (error) {
      reportRead(error);
      return null;
    }
  }

  function write(key: string, field: string, value: unknown): void {
    if (stopped) return;
    bump(key);
    try {
      storage.setItem(
        key,
        JSON.stringify({ version: VERSION, [field]: value }),
      );
    } catch (error) {
      reportWrite(error);
      // The older value would now be stale: better no copy than a wrong one.
      try {
        storage.removeItem(key);
      } catch {
        // Nothing more can be done with this store; reads will fail on it too.
      }
    }
  }

  /** This owner's keys whose name starts `base` + `start`. */
  function keysStarting(start: string): string[] {
    const found: string[] = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null && key.startsWith(base + start)) found.push(key);
      }
    } catch (error) {
      reportRead(error);
    }
    return found;
  }

  const deals = () => read(dealsKey, "deals", parseDeals);
  const putDealList = (list: StoredDeal[]) => write(dealsKey, "deals", list);
  const comps = (region: string) =>
    read(compsKey(region), "comps", parsedBy(CompsSchema));
  const putComps = (region: string, list: Comp[]) =>
    write(compsKey(region), "comps", list);

  return {
    deals,
    deal: (id) => deals()?.find((d) => d.id === id),
    putDealList,
    putDeal(deal) {
      putDealList([deal, ...(deals() ?? []).filter((d) => d.id !== deal.id)]);
    },
    refreshDeal(deal) {
      const list = deals() ?? [];
      const at = list.findIndex((d) => d.id === deal.id);
      putDealList(
        at === -1 ? [...list, deal] : list.map((d, i) => (i === at ? deal : d)),
      );
    },
    removeDeal(id) {
      const list = deals();
      if (list?.some((d) => d.id === id))
        putDealList(list.filter((d) => d.id !== id));
    },
    removeAllDeals: () => putDealList([]),
    comps,
    putComps,
    putComp(comp) {
      const list = comps(comp.region);
      if (list === null) return;
      const at = list.findIndex((c) => c.id === comp.id);
      putComps(
        comp.region,
        at === -1 ? [...list, comp] : list.map((c, i) => (i === at ? comp : c)),
      );
    },
    removeComp(id) {
      for (const key of keysStarting("comps:")) {
        const region = key.slice(compsKey("").length);
        const list = comps(region);
        if (list?.some((c) => c.id === id))
          putComps(
            region,
            list.filter((c) => c.id !== id),
          );
      }
    },
    costBook: (region) =>
      read(
        costBookKey(region),
        "costBook",
        parsedBy(CostBookViewSchema as Parser<CostBookView>),
      ),
    putCostBook: (region, costBook) =>
      write(costBookKey(region), "costBook", costBook),
    marketSettings: (region) =>
      read(
        marketKey(region),
        "marketSettings",
        parsedBy(MarketSettingsSchema as Parser<MarketSettings>),
      ),
    putMarketSettings: (region, settings) =>
      write(marketKey(region), "marketSettings", settings),
    companySettings: () =>
      read(
        companyKey,
        "companySettings",
        parsedBy(CompanySettingsSchema as Parser<CompanySettings>),
      ),
    putCompanySettings: (settings) =>
      write(companyKey, "companySettings", settings),
    forget() {
      for (const key of keysStarting("")) {
        bump(key);
        try {
          storage.removeItem(key);
        } catch (error) {
          reportWrite(error);
        }
      }
    },
    stop() {
      stopped = true;
    },
    since(name) {
      const key = base + name;
      const at = writes.get(key) ?? 0;
      return () => (writes.get(key) ?? 0) === at;
    },
  };
}
