import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES } from "@engine";
import type { Comp, CostBookView, DealInputs, DefaultPrice, MarketSettings } from "@engine";
import { assertCompReadsBack, assertDealReadsBack } from "../readBack";
import { DataError } from "../types";
import type { CompanySettings, DealListResult, Repository, StoredDeal } from "../types";
import type { DefaultPriceRow } from "./mappers";
import {
  companySettingsFromRow,
  compFromRow,
  compToRow,
  dealFromRow,
  dealToRow,
  DEAL_SCHEMA_VERSION,
  defaultPriceFromRow,
  marketSettingsFromRow,
  priceBookEntryFromRow,
} from "./mappers";

/** Stands in for the id and timestamps a new deal does not have yet, so the rest of it can be checked before sending. */
const PENDING = { id: "pending", stamp: "1970-01-01T00:00:00.000Z" } as const;

/** Anything Supabase reports (a rejected row, a policy, a lost connection) is a `DataError` carrying its message. */
function failed(error: { message: string }, recordId?: string): DataError {
  return new DataError(error.message || "The request to the database failed", { recordId, cause: error });
}

/** A filter value for PostgREST's `or`, quoted so that a comma or parenthesis in it cannot change the filter. */
const quoted = (value: string): string => `"${value.replace(/["\\]/g, "\\$&")}"`;

const defaultPriceKey = (price: DefaultPrice): string => JSON.stringify([price.code, price.variant, price.tier]);

/**
 * The hosted build's repository: the same `Repository` the demo build keeps in localStorage, kept in Supabase for one
 * company. Row-level security already limits what the signed-in user can see, and every query also names the company,
 * so a mistake in a policy cannot widen it. Reads check what they find with the engine's schemas (a deal it cannot
 * read is a problem entry or a `DataError`, never a half-built value), and writes check the record first, so a save
 * never replaces a good record with one that would not read back.
 */
export function createSupabaseRepository(client: SupabaseClient, companyId: string): Repository {
  return {
    async listDeals(): Promise<DealListResult> {
      const { data, error } = await client
        .from("deals")
        .select("*")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false });
      if (error) throw failed(error);
      const deals: StoredDeal[] = [];
      const problems: DealListResult["problems"] = [];
      for (const row of data ?? []) {
        try {
          deals.push(dealFromRow(row));
        } catch (cause) {
          if (!(cause instanceof DataError)) throw cause;
          problems.push({ id: cause.recordId ?? String(row?.id), message: cause.message });
        }
      }
      return { deals, problems };
    },

    async getDeal(id: string): Promise<StoredDeal | null> {
      const { data, error } = await client
        .from("deals")
        .select("*")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw failed(error, id);
      if (!data) return null;
      try {
        return dealFromRow(data);
      } catch (cause) {
        if (!(cause instanceof DataError)) throw cause;
        throw new DataError(`Deal ${id} is unreadable: ${cause.message}`, { recordId: id, path: cause.path, cause });
      }
    },

    async createDeal(input: { name: string; inputs: DealInputs }): Promise<StoredDeal> {
      assertDealReadsBack(
        {
          id: PENDING.id,
          name: input.name,
          status: "analyzing",
          inputs: input.inputs,
          createdAt: PENDING.stamp,
          updatedAt: PENDING.stamp,
        },
        null,
      );
      // The database assigns the id and both timestamps.
      const { data, error } = await client
        .from("deals")
        .insert({
          company_id: companyId,
          name: input.name,
          status: "analyzing",
          schema_version: DEAL_SCHEMA_VERSION,
          inputs: input.inputs,
        })
        .select()
        .single();
      if (error) throw failed(error);
      return dealFromRow(data);
    },

    async saveDeal(deal: StoredDeal): Promise<StoredDeal> {
      assertDealReadsBack(deal);
      const row = dealToRow(deal, companyId);
      // Only the columns the owner can change. The database stamps `updated_at` on every update, so what comes back
      // has a fresh one, and `created_at` stays as it was.
      const { data, error } = await client
        .from("deals")
        .upsert(
          {
            id: row.id,
            company_id: row.company_id,
            name: row.name,
            status: row.status,
            schema_version: row.schema_version,
            inputs: row.inputs,
          },
          { onConflict: "id" },
        )
        .select()
        .single();
      if (error) throw failed(error, deal.id);
      return dealFromRow(data);
    },

    async deleteDeal(id: string): Promise<void> {
      const { error } = await client.from("deals").delete().eq("id", id).eq("company_id", companyId);
      if (error) throw failed(error, id);
    },

    async resetDeals(): Promise<void> {
      const { error } = await client.from("deals").delete().eq("company_id", companyId);
      if (error) throw failed(error);
    },

    async listComps(region: string): Promise<Comp[]> {
      // Oldest first, so saving a comp does not move it in the list.
      const { data, error } = await client
        .from("comps")
        .select("*")
        .eq("company_id", companyId)
        .eq("region", region)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw failed(error);
      const comps: Comp[] = [];
      for (const row of data ?? []) {
        // Like the demo store, a comp that cannot be read is left out rather than failing the whole list. Trade-off: a
        // dropped comp shifts the comp-based price; surfacing comp problems is a Plan 3 follow-up (the interface has
        // no problems channel for comps).
        try {
          comps.push(compFromRow(row));
        } catch (cause) {
          if (!(cause instanceof DataError)) throw cause;
        }
      }
      return comps;
    },

    async saveComp(comp: Comp): Promise<Comp> {
      assertCompReadsBack(comp);
      const { data, error } = await client
        .from("comps")
        .upsert(compToRow(comp, companyId), { onConflict: "id" })
        .select()
        .single();
      if (error) throw failed(error, comp.id);
      return compFromRow(data);
    },

    async deleteComp(id: string): Promise<void> {
      const { error } = await client.from("comps").delete().eq("id", id).eq("company_id", companyId);
      if (error) throw failed(error, id);
    },

    async getCostBook(region: string): Promise<CostBookView> {
      const [defaults, priceBook] = await Promise.all([
        // Ordered by the whole key (the table's unique key, less the region), so the same data always comes back in
        // the same order.
        client
          .from("default_prices")
          .select("*")
          .eq("region", region)
          .or(`company_id.is.null,company_id.eq.${quoted(companyId)}`)
          .order("code")
          .order("variant")
          .order("tier")
          .order("company_id"),
        // A price book may repeat a key, so the id breaks the tie.
        client
          .from("price_book_entries")
          .select("*")
          .eq("company_id", companyId)
          .order("code")
          .order("variant")
          .order("tier")
          .order("id"),
      ]);
      if (defaults.error) throw failed(defaults.error);
      if (priceBook.error) throw failed(priceBook.error);

      // A company's own price replaces the global one with the same code, variant and tier.
      const rows: DefaultPriceRow[] = defaults.data ?? [];
      const byKey = new Map<string, DefaultPrice>();
      for (const row of [...rows.filter((r) => r.company_id === null), ...rows.filter((r) => r.company_id !== null)]) {
        const price = defaultPriceFromRow(row);
        byKey.set(defaultPriceKey(price), price);
      }
      return { defaults: [...byKey.values()], priceBook: (priceBook.data ?? []).map(priceBookEntryFromRow) };
    },

    async getMarketSettings(region: string): Promise<MarketSettings> {
      const { data, error } = await client
        .from("market_settings")
        .select("*")
        .eq("company_id", companyId)
        .eq("region", region)
        .maybeSingle();
      if (error) throw failed(error);
      if (!data) return { ...structuredClone(DEFAULT_MARKET_SETTINGS), region };
      return marketSettingsFromRow(data);
    },

    async getCompanySettings(): Promise<CompanySettings> {
      const { data, error } = await client.from("company_settings").select("*").eq("company_id", companyId).maybeSingle();
      if (error) throw failed(error);
      if (!data) return { rules: structuredClone(DEFAULT_RULES), contingencyPct: 0.05 };
      return companySettingsFromRow(data);
    },
  };
}
