import { z } from "zod";
import { CompSchema, DEFAULT_MARKET_SETTINGS, DEFAULT_RULES, DealInputsSchema, RulesSchema } from "@engine";
import type { Comp, CostBookView, DealInputs, MarketSettings } from "@engine";
import { STARTER_COST_BOOK } from "../starterCostBook";
import { DataError, StoredDealSchema } from "../types";
import type { CompanySettings, DealListResult, Repository, StoredDeal } from "../types";

/** Each key holds one JSON value: deals and comps are an object keyed by id, the settings are one object. */
export const DEALS_KEY = "spec-studio:v1:deals";
export const COMPS_KEY = "spec-studio:v1:comps";
export const SETTINGS_KEY = "spec-studio:v1:settings";

const SAVE_FAILED = "Couldn't save — browser storage is full or unavailable";

const CompanySettingsSchema = z.object({
  rules: RulesSchema,
  contingencyPct: DealInputsSchema.shape.contingencyPct,
});

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

type DealRead = { ok: true; deal: StoredDeal } | { ok: false; path: string; message: string };

/** Zod phrases every type error as "Invalid input: expected number, received string"; the prefix says nothing. */
const plain = (message: string): string => message.replace(/^Invalid input: /, "");

function readDeal(raw: unknown): DealRead {
  const parsed = StoredDealSchema.safeParse(raw);
  if (parsed.success) return { ok: true, deal: parsed.data };
  // The first problem is enough to find the record. A bad field inside `inputs` arrives from the schema's structural
  // check with its full path (`inputs.lot.priceCents`).
  const issue = parsed.error.issues[0];
  const path = (issue?.path ?? []).map(String).join(".");
  return { ok: false, path, message: `${path === "" ? "record" : path}: ${plain(issue?.message ?? "unreadable")}` };
}

/**
 * The demo build's repository: deals, comps and settings in `storage` (the browser's `localStorage`), the cost book
 * and market settings from the engine's defaults. Every read checks what it finds, so a record that was edited by
 * hand or written by a different version shows up as a problem instead of reaching a screen. Every method returns
 * copies, so a caller can change what it gets without changing what is stored.
 */
export function createLocalRepository(
  storage: Storage,
  opts: { now?: () => string; newId?: () => string } = {},
): Repository {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? (() => crypto.randomUUID());

  /** Any failure to write (the quota, a blocked store) is the same story to the owner. */
  function write(key: string, records: Record<string, unknown>): void {
    const text = JSON.stringify(records);
    try {
      storage.setItem(key, text);
    } catch (cause) {
      throw new DataError(SAVE_FAILED, { cause });
    }
  }

  /** The deals as raw records, ready to be written back. A store that cannot be read is never written over. */
  function dealRecords(): Record<string, unknown> {
    const store = readStore(storage, DEALS_KEY);
    if (!store.ok) throw new DataError(unreadableDeals(store.reason), { recordId: "*" });
    return store.records;
  }

  function putDeal(deal: StoredDeal): void {
    write(DEALS_KEY, { ...dealRecords(), [deal.id]: deal });
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
      return { ...structuredClone(DEFAULT_MARKET_SETTINGS), region };
    },

    async getCompanySettings(): Promise<CompanySettings> {
      const json = readJson(storage, SETTINGS_KEY);
      if (!json.ok) return defaultCompanySettings();
      const parsed = CompanySettingsSchema.safeParse(json.value);
      return parsed.success ? parsed.data : defaultCompanySettings();
    },
  };
}
