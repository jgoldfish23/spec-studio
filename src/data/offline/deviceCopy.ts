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
  /** Removes this owner's whole copy. Nothing is kept after, so a read already on its way cannot bring it back. */
  forget(): void;
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
 * The device copy of one owner's reads in `storage`. Reads check what they find against the same schemas the
 * repositories use: a copy that does not read back is ignored (and reported once), never thrown. Writes are best
 * effort: a full or blocked store is reported once, and the app goes on without a copy.
 */
export function createDeviceCopy(
  storage: Storage,
  scope: string,
  /** Reports a refused write instead of reporting it here: the outbox shares one report for a store that is full. */
  options: { reportWrite?: (error: unknown) => void } = {},
): DeviceCopy {
  const base = `${PREFIX}${scope}:`;
  const dealsKey = `${base}deals`;
  const compsKey = (region: string) => `${base}comps:${region}`;
  const costBookKey = (region: string) => `${base}costBook:${region}`;
  const marketKey = (region: string) => `${base}marketSettings:${region}`;
  const companyKey = `${base}companySettings`;
  let reportedRead = false;
  let reportedWrite = false;
  let forgotten = false;

  function reportRead(error: unknown): void {
    if (reportedRead) return;
    reportedRead = true;
    console.error(
      "The copy of your data on this device could not be read; ignoring it.",
      error,
    );
  }

  function reportWrite(error: unknown): void {
    if (options.reportWrite) return options.reportWrite(error);
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
    if (forgotten) return;
    try {
      storage.setItem(
        key,
        JSON.stringify({ version: VERSION, [field]: value }),
      );
    } catch (error) {
      reportWrite(error);
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
      forgotten = true;
      for (const key of keysStarting("")) {
        try {
          storage.removeItem(key);
        } catch (error) {
          reportWrite(error);
        }
      }
    },
  };
}
