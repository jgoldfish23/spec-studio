import { CompSchema, DEFAULT_MARKET_SETTINGS, DEFAULT_RULES, MarketSettingsSchema } from "@engine";
import type { Comp, CostBookView, DealInputs, MarketSettings } from "@engine";
import {
  assertCompanySettingsReadBack,
  assertCompReadsBack,
  assertDealReadsBack,
  assertMarketSettingsReadBack,
  CompanySettingsSchema,
  firstProblem,
  readDeal,
} from "../readBack";
import { LEGACY_SAMPLE_COMP_IDS } from "../sample";
import { STARTER_COST_BOOK } from "../starterCostBook";
import { DataError } from "../types";
import type { CompanySettings, DealListResult, Repository, StoredDeal } from "../types";

/** Each key holds one JSON value: deals and comps are an object keyed by id, the settings are one object each (the company's, and one per region). */
export const DEALS_KEY = "spec-studio:v1:deals";
export const COMPS_KEY = "spec-studio:v1:comps";
export const COMPANY_SETTINGS_KEY = "spec-studio:company-settings";
export const marketSettingsKey = (region: string): string => `spec-studio:market-settings:${region}`;

const CONFLICT = "This deal was changed on another device or tab.";
const DELETED = "This deal was deleted on another device or tab.";
const SAVE_FAILED = "Couldn't save — browser storage is full or unavailable";

const defaultCompanySettings = (): CompanySettings => ({
  rules: structuredClone(DEFAULT_RULES),
  contingencyPct: 0.05,
});

/** What was stored under a key: the records it holds, or why it could not be read as records. */
type Store = { ok: true; records: Record<string, unknown> } | { ok: false; reason: string };

function readJson(storage: Storage, key: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    return { ok: false, reason: "could not be read (browser storage is unavailable)" };
  }
  if (text === null) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "is not valid JSON" };
  }
}

/** A missing key is an empty store. Anything but a plain object (not JSON, `null`, a list, a number) is unreadable. */
function readStore(storage: Storage, key: string): Store {
  const json = readJson(storage, key);
  if (!json.ok) return json;
  if (json.value === undefined) return { ok: true, records: {} };
  const { value } = json;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "is not an object keyed by id" };
  }
  return { ok: true, records: value as Record<string, unknown> };
}

const unreadableDeals = (reason: string): string => `The saved deal data ${reason}`;

/** The records without `id`. `fromEntries` defines own properties, so an id like `__proto__` is just a key. */
function without(records: Record<string, unknown>, id: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(records).filter(([key]) => key !== id));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Plan 2 stored the sample's comps as `comp-1`…`comp-8`. Comp ids are now UUIDs, and the sample is marked by
 * `source: "sample"`: those eight ids, and only those, get a new UUID and the mark, in the comps and in every deal's
 * `compSelections`, once. A store that cannot be read, a record of another shape, a write that fails: all are left as
 * they are (the read paths already report them). The deals are written first, so if the second write fails the comps
 * are still plain `comp-N` and the next open tries again.
 */
function upgradeLegacySampleIds(storage: Storage, newId: () => string): void {
  const legacy = new Set(LEGACY_SAMPLE_COMP_IDS);
  const isLegacy = (id: string): boolean => legacy.has(id);
  const renamed = new Map<string, string>();
  const rename = (id: string): string => {
    let target = renamed.get(id);
    if (target === undefined) {
      target = newId();
      renamed.set(id, target);
    }
    return target;
  };

  const comps = readStore(storage, COMPS_KEY);
  const deals = readStore(storage, DEALS_KEY);

  let nextDeals: Record<string, unknown> | null = null;
  if (deals.ok) {
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [id, record] of Object.entries(deals.records)) {
      const inputs = isRecord(record) ? record.inputs : undefined;
      const selections = isRecord(inputs) ? inputs.compSelections : undefined;
      if (!isRecord(record) || !isRecord(inputs) || !isRecord(selections) || !Object.keys(selections).some(isLegacy)) {
        next[id] = record;
        continue;
      }
      changed = true;
      const swapped: Record<string, unknown> = {};
      for (const [compId, chosen] of Object.entries(selections))
        swapped[isLegacy(compId) ? rename(compId) : compId] = chosen;
      next[id] = { ...record, inputs: { ...inputs, compSelections: swapped } };
    }
    if (changed) nextDeals = next;
  }

  let nextComps: Record<string, unknown> | null = null;
  if (comps.ok && Object.keys(comps.records).some(isLegacy)) {
    nextComps = {};
    for (const [id, record] of Object.entries(comps.records)) {
      if (!isLegacy(id)) nextComps[id] = record;
      else {
        const target = rename(id);
        nextComps[target] = isRecord(record) ? { ...record, id: target, source: "sample" } : record;
      }
    }
  }

  // Renaming ids for the deals happened before the comps' own, so both use one mapping; write in the safe order.
  try {
    if (nextDeals !== null) storage.setItem(DEALS_KEY, JSON.stringify(nextDeals));
    if (nextComps !== null) storage.setItem(COMPS_KEY, JSON.stringify(nextComps));
  } catch {
    // Left as it was; the next open tries again.
  }
}

/**
 * The demo build's repository: deals, comps and settings in `storage` (the browser's `localStorage`), the cost book
 * and market settings from the engine's defaults. Every read checks what it finds, so a record that was edited by
 * hand or written by a different version shows up as a problem instead of reaching a screen. Every write is checked
 * the same way first, so a save never replaces a good record with one that would not read back. Every method returns
 * copies, so a caller can change what it gets without changing what is stored.
 */
export function createLocalRepository(
  storage: Storage,
  opts: { now?: () => string; newId?: () => string } = {},
): Repository {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  upgradeLegacySampleIds(storage, newId);

  /** Any failure to write (the quota, a blocked store) is the same story to the owner. */
  function write(key: string, records: Record<string, unknown>): void {
    const text = JSON.stringify(records);
    try {
      storage.setItem(key, text);
    } catch (cause) {
      throw new DataError(SAVE_FAILED, { kind: "failed", cause });
    }
  }

  /** The deals as raw records, ready to be written back. A store that cannot be read is never written over. */
  function dealRecords(): Record<string, unknown> {
    const store = readStore(storage, DEALS_KEY);
    if (!store.ok) throw new DataError(unreadableDeals(store.reason), { recordId: "*" });
    return store.records;
  }

  function putDeal(deal: StoredDeal): void {
    assertDealReadsBack(deal);
    write(DEALS_KEY, { ...dealRecords(), [deal.id]: deal });
  }

  /** Keys already reported as unreadable, so a bad value is logged once per repository and not on every read. */
  const reported = new Set<string>();
  function report(key: string, reason: string): void {
    if (reported.has(key)) return;
    reported.add(key);
    console.error(`Spec Studio: the saved settings under ${key} ${reason}; using the defaults instead.`);
  }

  /** The value stored under `key` if it reads back; undefined when nothing is stored or it cannot be read (reported once). */
  function readSetting<T>(key: string, parse: (value: unknown) => { ok: true; value: T } | { ok: false; reason: string }): T | undefined {
    const json = readJson(storage, key);
    if (!json.ok) {
      report(key, json.reason);
      return undefined;
    }
    if (json.value === undefined) return undefined;
    const parsed = parse(json.value);
    if (!parsed.ok) {
      report(key, `do not read back (${parsed.reason})`);
      return undefined;
    }
    return parsed.value;
  }

  return {
    async listDeals(): Promise<DealListResult> {
      const store = readStore(storage, DEALS_KEY);
      if (!store.ok) return { deals: [], problems: [{ id: "*", message: unreadableDeals(store.reason) }] };
      const deals: StoredDeal[] = [];
      const problems: DealListResult["problems"] = [];
      for (const [id, raw] of Object.entries(store.records)) {
        const read = readDeal(raw);
        if (read.ok) deals.push(read.deal);
        else problems.push({ id, message: read.message });
      }
      // Compared as instants, because a timestamp may carry an offset instead of Z. The sort is stable.
      deals.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      return { deals, problems };
    },

    async getDeal(id: string): Promise<StoredDeal | null> {
      const records = dealRecords();
      if (!Object.hasOwn(records, id)) return null;
      const read = readDeal(records[id]);
      if (!read.ok) {
        throw new DataError(`Deal ${id} is unreadable: ${read.message}`, { recordId: id, path: read.path });
      }
      return read.deal;
    },

    async createDeal(input: { name: string; inputs: DealInputs }): Promise<StoredDeal> {
      const stamp = now();
      const deal: StoredDeal = {
        id: newId(),
        name: input.name,
        status: "analyzing",
        inputs: structuredClone(input.inputs),
        createdAt: stamp,
        updatedAt: stamp,
      };
      putDeal(deal);
      return deal;
    },

    async saveDeal(deal: StoredDeal): Promise<StoredDeal> {
      assertDealReadsBack(deal);
      const records = dealRecords();
      if (!Object.hasOwn(records, deal.id)) throw new DataError(DELETED, { kind: "deleted", recordId: deal.id });
      const stored = records[deal.id];
      const storedStamp = isRecord(stored) ? stored.updatedAt : undefined;
      if (storedStamp !== deal.updatedAt) {
        throw new DataError(CONFLICT, {
          kind: "conflict",
          recordId: deal.id,
          storedUpdatedAt: typeof storedStamp === "string" ? storedStamp : undefined,
        });
      }
      const saved: StoredDeal = { ...structuredClone(deal), updatedAt: now() };
      putDeal(saved);
      return saved;
    },

    async deleteDeal(id: string): Promise<void> {
      // A store that cannot be read has nothing to delete from; `resetDeals` is the way out of that.
      const store = readStore(storage, DEALS_KEY);
      if (!store.ok || !Object.hasOwn(store.records, id)) return;
      write(DEALS_KEY, without(store.records, id));
    },

    async resetDeals(): Promise<void> {
      storage.removeItem(DEALS_KEY);
    },

    async listComps(region: string): Promise<Comp[]> {
      const store = readStore(storage, COMPS_KEY);
      if (!store.ok) return [];
      const comps: Comp[] = [];
      for (const raw of Object.values(store.records)) {
        const parsed = CompSchema.safeParse(raw);
        if (parsed.success && parsed.data.region === region) comps.push(parsed.data);
      }
      return comps;
    },

    async saveComp(comp: Comp): Promise<Comp> {
      const saved = structuredClone(comp);
      assertCompReadsBack(saved);
      // Unlike deals, comps have no screen to reset them, so a store that cannot be read is started over.
      const store = readStore(storage, COMPS_KEY);
      write(COMPS_KEY, { ...(store.ok ? store.records : {}), [saved.id]: saved });
      return saved;
    },

    async deleteComp(id: string): Promise<void> {
      const store = readStore(storage, COMPS_KEY);
      if (!store.ok || !Object.hasOwn(store.records, id)) return;
      write(COMPS_KEY, without(store.records, id));
    },

    async getCostBook(region: string): Promise<CostBookView> {
      return { defaults: structuredClone(STARTER_COST_BOOK.filter((price) => price.region === region)), priceBook: [] };
    },

    async getMarketSettings(region: string): Promise<MarketSettings> {
      const stored = readSetting(marketSettingsKey(region), (value) => {
        // The key decides the region, whatever the stored value says.
        const parsed = MarketSettingsSchema.safeParse(isRecord(value) ? { ...value, region } : value);
        return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: firstProblem(parsed.error).message };
      });
      return stored ?? { ...structuredClone(DEFAULT_MARKET_SETTINGS), region };
    },

    async getCompanySettings(): Promise<CompanySettings> {
      const stored = readSetting(COMPANY_SETTINGS_KEY, (value) => {
        const parsed = CompanySettingsSchema.safeParse(value);
        return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: firstProblem(parsed.error).message };
      });
      return stored ?? defaultCompanySettings();
    },

    async saveCompanySettings(settings: CompanySettings): Promise<CompanySettings> {
      const saved = structuredClone(settings);
      assertCompanySettingsReadBack(saved);
      write(COMPANY_SETTINGS_KEY, saved as unknown as Record<string, unknown>);
      return structuredClone(saved);
    },

    async saveMarketSettings(settings: MarketSettings): Promise<MarketSettings> {
      const saved = structuredClone(settings);
      assertMarketSettingsReadBack(saved);
      write(marketSettingsKey(saved.region), saved as unknown as Record<string, unknown>);
      return structuredClone(saved);
    },
  };
}
