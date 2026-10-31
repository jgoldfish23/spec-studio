import { z } from "zod";
import { DealInputsSchema } from "@engine";
import type { Comp, CostBookView, DealInputs, MarketSettings, Rules } from "@engine";

export const DEAL_STATUSES = ["analyzing", "bought", "building", "listed", "sold", "dropped"] as const;
export const DealStatusSchema = z.enum(DEAL_STATUSES);
/** Where a deal stands in its life, from first look to a sale or a pass. */
export type DealStatus = z.infer<typeof DealStatusSchema>;

/**
 * A deal as stored: the engine's inputs plus a name, a status and timestamps. The timestamps are ISO date-times;
 * an offset (`+00:00`) is accepted as well as `Z`, because Postgres writes one.
 */
export const StoredDealSchema = z.object({
  id: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  status: DealStatusSchema,
  inputs: DealInputsSchema,
  createdAt: z.iso.datetime({ offset: true, error: "Must be an ISO date-time" }),
  updatedAt: z.iso.datetime({ offset: true, error: "Must be an ISO date-time" }),
});
export type StoredDeal = z.infer<typeof StoredDealSchema>;

/** Company-wide settings every new deal starts from. */
export interface CompanySettings {
  rules: Rules;
  contingencyPct: number;
}

/** The deals that could be read, and one problem entry for each stored deal that could not. */
export interface DealListResult {
  deals: StoredDeal[];
  problems: { id: string; message: string }[];
}

/** A stored record that cannot be read: not valid JSON, or valid JSON that fails its schema. */
export class DataError extends Error {
  recordId?: string;
  path?: string;

  constructor(message: string, options: { recordId?: string; path?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DataError";
    this.recordId = options.recordId;
    this.path = options.path;
  }
}

/** Everything the screens read and write. The demo build keeps it in localStorage; the hosted build keeps it in Supabase. */
export interface Repository {
  listDeals(): Promise<DealListResult>;
  /** Null when there is no such deal; a `DataError` when one is stored but invalid. */
  getDeal(id: string): Promise<StoredDeal | null>;
  createDeal(input: { name: string; inputs: DealInputs }): Promise<StoredDeal>;
  /** Returns the deal with a fresh `updatedAt`. */
  saveDeal(deal: StoredDeal): Promise<StoredDeal>;
  deleteDeal(id: string): Promise<void>;
  /** Removes every deal: the way out of a store that cannot be read. */
  resetDeals(): Promise<void>;
  listComps(region: string): Promise<Comp[]>;
  /** Inserts the comp, or replaces the one with the same id. */
  saveComp(comp: Comp): Promise<Comp>;
  deleteComp(id: string): Promise<void>;
  getCostBook(region: string): Promise<CostBookView>;
  getMarketSettings(region: string): Promise<MarketSettings>;
  getCompanySettings(): Promise<CompanySettings>;
}
